import json
import urllib.error
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from bookings.models import Booking
from listings.models import Property

from .backends import BrevoEmailBackend, BrevoError
from .checks import email_settings_check
from .models import BookingEmail
from .outbox import due_for_retry, enqueue, send_email

User = get_user_model()
Kind = BookingEmail.Kind
Status = BookingEmail.Status


def make_booking(email="guest@example.com", status=Booking.Status.PENDING):
    guest = User.objects.create_user(f"guest-{User.objects.count()}", email, "S3cure-Booking-Pass!")
    prop = Property.objects.create(
        title="Sea View Loft", location="Thessaloniki", price_per_night=Decimal("80.00"), capacity=3
    )
    today = timezone.localdate()
    return Booking.objects.create(
        property=prop, guest=guest, check_in=today + timedelta(days=10),
        check_out=today + timedelta(days=13), total_price=Decimal("240.00"), status=status,
    )


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def http_error(code, body=b'{"code": "unauthorized", "message": "Key not found"}'):
    return urllib.error.HTTPError("https://api.brevo.com/v3/smtp/email", code, "Error", {}, BytesIO(body))


# --- Brevo backend ------------------------------------------------------------

@override_settings(BREVO_API_KEY="xkeysib-test", DEFAULT_FROM_EMAIL="Booking Demo <owner@example.com>")
class BrevoBackendTests(SimpleTestCase):
    def message(self, **extra):
        msg = EmailMultiAlternatives(
            subject="Booking confirmed", body="Plain text", to=["Guest One <guest@example.com>"],
            headers={"Idempotency-Key": "booking-1-booking_confirmed"}, **extra,
        )
        msg.attach_alternative("<p>HTML</p>", "text/html")
        msg.tags = ["booking_confirmed"]
        return msg

    def test_payload_maps_the_message(self):
        """EMAIL-01: sender with name, recipients, subject, text + HTML, custom header, tag."""
        payload = BrevoEmailBackend().payload(self.message(reply_to=["help@example.com"]))
        self.assertEqual(payload["sender"], {"email": "owner@example.com", "name": "Booking Demo"})
        self.assertEqual(payload["to"], [{"email": "guest@example.com", "name": "Guest One"}])
        self.assertEqual(payload["subject"], "Booking confirmed")
        self.assertEqual(payload["textContent"], "Plain text")
        self.assertEqual(payload["htmlContent"], "<p>HTML</p>")
        self.assertEqual(payload["replyTo"], {"email": "help@example.com"})
        self.assertEqual(payload["headers"], {"Idempotency-Key": "booking-1-booking_confirmed"})
        self.assertEqual(payload["tags"], ["booking_confirmed"])

    def test_sends_one_post_and_keeps_the_message_id(self):
        """EMAIL-02: a 201 from Brevo = sent; its messageId is kept on the message."""
        msg = self.message()
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse(b'{"messageId": "<abc@brevo>"}')) as post:
            sent = BrevoEmailBackend().send_messages([msg])
        self.assertEqual(sent, 1)
        self.assertEqual(msg.provider_message_id, "<abc@brevo>")
        request = post.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(request.get_header("Api-key"), "xkeysib-test")
        self.assertEqual(json.loads(request.data)["subject"], "Booking confirmed")
        self.assertEqual(post.call_args.kwargs["timeout"], 10)

    def test_a_4xx_is_a_refusal_without_the_key_in_the_error(self):
        """EMAIL-03: Brevo said no (bad key, unverified sender) -> refused, readable reason."""
        with mock.patch("urllib.request.urlopen", side_effect=http_error(401)):
            with self.assertRaises(BrevoError) as ctx:
                BrevoEmailBackend().send_messages([self.message()])
        self.assertTrue(ctx.exception.refused)
        self.assertIn("401", str(ctx.exception))
        self.assertIn("Key not found", str(ctx.exception))
        self.assertNotIn("xkeysib-test", str(ctx.exception))

    def test_network_errors_and_5xx_are_unknown_outcomes(self):
        """EMAIL-04: couldn't reach Brevo / a 5xx / a 429 -> not a refusal (worth retrying)."""
        for error in (urllib.error.URLError("timed out"), http_error(503, b""), http_error(429, b"")):
            with self.subTest(error=error), mock.patch("urllib.request.urlopen", side_effect=error):
                with self.assertRaises(BrevoError) as ctx:
                    BrevoEmailBackend().send_messages([self.message()])
                self.assertFalse(ctx.exception.refused)

    def test_fail_silently_and_missing_key(self):
        with mock.patch("urllib.request.urlopen", side_effect=http_error(401)):
            self.assertEqual(BrevoEmailBackend(fail_silently=True).send_messages([self.message()]), 0)
        with self.assertRaises(BrevoError):
            BrevoEmailBackend(api_key="").send_messages([self.message()])

    def test_html_only_and_empty_messages(self):
        html = EmailMultiAlternatives(subject="S", body="<b>hi</b>", to=["a@example.com"])
        html.content_subtype = "html"
        payload = BrevoEmailBackend().payload(html)
        self.assertEqual(payload["htmlContent"], "<b>hi</b>")
        self.assertNotIn("textContent", payload)
        empty = EmailMultiAlternatives(subject="S", body="", to=["a@example.com"])
        self.assertEqual(BrevoEmailBackend().payload(empty)["textContent"], " ")


# --- Settings checks ----------------------------------------------------------

class EmailSettingsCheckTests(SimpleTestCase):
    def ids(self, **settings):
        with override_settings(**settings):
            return [p.id for p in email_settings_check()]

    def test_console_and_a_complete_brevo_setup_are_fine(self):
        """EMAIL-05"""
        self.assertEqual(self.ids(EMAIL_PROVIDER="console"), [])
        self.assertEqual(self.ids(EMAIL_PROVIDER="brevo", BREVO_API_KEY="xkeysib-x",
                                  DEFAULT_FROM_EMAIL="Demo <owner@gmail.com>",
                                  BOOKING_ALERT_EMAILS=["owner@gmail.com"]), [])

    def test_warnings_never_errors(self):
        """EMAIL-06: a mis-set email setting warns but never stops a deploy."""
        self.assertEqual(self.ids(EMAIL_PROVIDER="carrier-pigeon"), ["notifications.W001"])
        self.assertEqual(self.ids(EMAIL_PROVIDER="brevo", BREVO_API_KEY="",
                                  DEFAULT_FROM_EMAIL="Demo <bookings@example.com>"),
                         ["notifications.W002", "notifications.W003"])
        self.assertEqual(self.ids(BOOKING_ALERT_EMAILS=["not-an-email"]), ["notifications.W004"])
        with override_settings(EMAIL_PROVIDER="carrier-pigeon"):
            self.assertTrue(all(p.level < 40 for p in email_settings_check()))


# --- Outbox -------------------------------------------------------------------

@override_settings(BOOKING_ALERT_EMAILS=["owner@example.com"], DEFAULT_FROM_EMAIL="Demo <owner@example.com>")
class OutboxTests(TestCase):
    def setUp(self):
        self.booking = make_booking()

    def enqueue(self, kind=Kind.BOOKING_RECEIVED, booking=None):
        with self.captureOnCommitCallbacks(execute=True):
            with transaction.atomic():
                return enqueue(booking or self.booking, kind)

    def test_recorded_then_sent_after_commit(self):
        """EMAIL-07: the row is created in the transaction; the email goes out after the commit."""
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            with transaction.atomic():
                row = enqueue(self.booking, Kind.BOOKING_RECEIVED)
                self.assertEqual(len(mail.outbox), 0)  # not inside the transaction
        self.assertEqual(row.status, Status.PENDING)
        self.assertEqual(len(callbacks), 1)
        callbacks[0]()
        row.refresh_from_db()
        self.assertEqual(row.status, Status.SENT)
        self.assertEqual(row.attempts, 1)
        self.assertIsNotNone(row.sent_at)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["guest@example.com"])
        self.assertEqual(mail.outbox[0].extra_headers["Idempotency-Key"], f"booking-{self.booking.pk}-booking_received")

    def test_rolled_back_change_sends_nothing(self):
        """EMAIL-08: no email for a change that didn't happen."""
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    enqueue(self.booking, Kind.BOOKING_RECEIVED)
                    raise RuntimeError("booking change failed")
            except RuntimeError:
                pass
        self.assertFalse(BookingEmail.objects.exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_at_most_one_per_booking_and_kind(self):
        """EMAIL-09: a repeated webhook / double confirm can't send twice."""
        self.booking.status = Booking.Status.CONFIRMED
        self.booking.save()
        self.assertIsNotNone(self.enqueue(Kind.BOOKING_CONFIRMED))
        self.assertIsNone(self.enqueue(Kind.BOOKING_CONFIRMED))
        self.assertEqual(BookingEmail.objects.filter(kind=Kind.BOOKING_CONFIRMED).count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        # and sending the same row again is a no-op
        send_email(BookingEmail.objects.get().pk)
        self.assertEqual(len(mail.outbox), 1)

    def test_no_recipient_no_row(self):
        """EMAIL-10: a guest without an email / no admin alert list -> nothing recorded."""
        self.assertIsNone(self.enqueue(booking=make_booking(email="")))
        with override_settings(BOOKING_ALERT_EMAILS=[]):
            self.assertIsNone(self.enqueue(Kind.ADMIN_NEW_BOOKING))
        self.assertFalse(BookingEmail.objects.exists())

    def test_admin_alert_goes_to_the_alert_list(self):
        self.booking.status = Booking.Status.CONFIRMED
        self.booking.save()
        with override_settings(BOOKING_ALERT_EMAILS=["owner@example.com", "partner@example.com"]):
            row = self.enqueue(Kind.ADMIN_NEW_BOOKING)
        self.assertEqual(row.recipient_list, ["owner@example.com", "partner@example.com"])
        self.assertEqual(mail.outbox[0].to, ["owner@example.com", "partner@example.com"])

    def test_a_failed_send_is_recorded_not_raised_and_can_be_retried(self):
        """EMAIL-11: the provider fails -> `failed` + reason, the booking is untouched; a retry sends it."""
        with mock.patch("django.core.mail.message.EmailMessage.send", side_effect=BrevoError("Brevo answered 401: Key not found", 401)):
            row = self.enqueue()
        row.refresh_from_db()
        self.assertEqual(row.status, Status.FAILED)
        self.assertEqual(row.last_error, "Brevo answered 401: Key not found")
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.Status.PENDING)
        self.assertEqual(due_for_retry(), [row.pk])

        row = send_email(row.pk)
        self.assertEqual(row.status, Status.SENT)
        self.assertEqual(row.attempts, 2)
        self.assertEqual(row.last_error, "")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(due_for_retry(), [])

    def test_out_of_date_email_is_skipped(self):
        """EMAIL-12: a retried "booking received" for a booking that is confirmed by now isn't sent."""
        with mock.patch("django.core.mail.message.EmailMessage.send", side_effect=OSError("down")):
            row = self.enqueue()
        self.booking.status = Booking.Status.CONFIRMED
        self.booking.save()
        row = send_email(row.pk)
        self.assertEqual(row.status, Status.SKIPPED)
        self.assertIn("confirmed", row.last_error)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(due_for_retry(), [])

    def test_a_row_being_sent_is_left_alone_until_stale(self):
        """EMAIL-13: two senders never send the same row; a stuck one is retried later."""
        row = BookingEmail.objects.create(
            booking=self.booking, kind=Kind.BOOKING_RECEIVED, recipients="guest@example.com",
            status=Status.SENDING, attempts=1, sending_started_at=timezone.now(),
        )
        self.assertEqual(send_email(row.pk).status, Status.SENDING)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(due_for_retry(), [])

        later = timezone.now() + timedelta(minutes=11)
        self.assertEqual(due_for_retry(now=later), [row.pk])
        row = send_email(row.pk, now=later)
        self.assertEqual(row.status, Status.SENT)
        self.assertEqual(row.attempts, 2)
        self.assertEqual(len(mail.outbox), 1)

    def test_due_for_retry_respects_max_attempts(self):
        row = BookingEmail.objects.create(
            booking=self.booking, kind=Kind.BOOKING_RECEIVED, recipients="guest@example.com",
            status=Status.FAILED, attempts=5,
        )
        self.assertEqual(due_for_retry(max_attempts=5), [])
        self.assertEqual(due_for_retry(max_attempts=6), [row.pk])
        self.assertEqual(due_for_retry(), [row.pk])

    def test_db_constraint_backstops_duplicates(self):
        from django.db import IntegrityError
        BookingEmail.objects.create(booking=self.booking, kind=Kind.BOOKING_RECEIVED, recipients="a@example.com")
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingEmail.objects.create(booking=self.booking, kind=Kind.BOOKING_RECEIVED, recipients="a@example.com")
