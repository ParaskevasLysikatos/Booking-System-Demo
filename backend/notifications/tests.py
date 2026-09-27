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
from .messages import money, short_range
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


# --- Step 2: the emails and when they're sent ---------------------------------

from django.urls import reverse  # noqa: E402
from rest_framework.test import APITestCase  # noqa: E402

from payments.models import Payment  # noqa: E402
from payments.tests import (  # noqa: E402
    PAYMENTS_ON, WEBHOOK_SECRET, CheckoutFixtures, WebhookFixtures, checkout_url, session_event, stale,
)

EMAILS = dict(BOOKING_ALERT_EMAILS=["owner@example.com"], DEFAULT_FROM_EMAIL="Booking Demo <owner@example.com>",
              FRONTEND_URL="http://localhost:4200")


class EmailFlowMixin:
    """Runs on_commit callbacks, like a real request (TestCase otherwise
    never commits, so nothing would be sent)."""

    def call(self, fn, *args, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            return fn(*args, **kwargs)

    def book(self, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            return self.book_via_api(**kwargs)

    def patch_status(self, booking, new_status, as_user=None):
        if as_user is not None:
            self.client.force_authenticate(as_user)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.patch(reverse("booking-detail", args=[booking.pk]), {"status": new_status},
                                     format="json")

    def sent(self):
        return [(m.to, m.subject) for m in mail.outbox]

    def kinds(self, booking):
        return dict(BookingEmail.objects.filter(booking=booking).values_list("kind", "status"))

    def email(self, kind):
        return next(m for m in mail.outbox if m.tags == [kind])


@override_settings(**EMAILS, PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY="")
class EmailsWithoutPaymentsTests(EmailFlowMixin, CheckoutFixtures, APITestCase):
    def test_booking_sends_received(self):
        """EMAIL-14: a new booking -> "received" to the guest, nothing charged (payments off)."""
        booking, _ = self.book()
        self.assertEqual(self.kinds(booking), {"booking_received": "sent"})
        msg = self.email("booking_received")
        self.assertEqual(msg.to, ["guest@example.com"])
        self.assertEqual(msg.from_email, "Booking Demo <owner@example.com>")
        self.assertEqual(msg.reply_to, ["Booking Demo <owner@example.com>"])
        self.assertEqual(msg.subject,
                         f"Booking #{booking.pk} received - Loft, {short_range(booking.check_in, booking.check_out)}")
        self.assertIn("pending until the host confirms it", msg.body)
        self.assertIn("Nothing has been charged", msg.body)
        self.assertNotIn("Pay now", msg.body)
        html = msg.alternatives[0][0]
        self.assertIn("View my bookings", html)
        self.assertIn("https://img.test/c.jpg", html)

    def test_admin_confirm_sends_confirmed_and_the_alert(self):
        """EMAIL-15: pending -> confirmed by an admin: guest confirmation + owner alert."""
        booking, _ = self.book()
        mail.outbox.clear()
        res = self.patch_status(booking, "confirmed", as_user=self.admin)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["guest@example.com", "owner@example.com"])
        guest = self.email("booking_confirmed")
        self.assertIn("You're all set", guest.body)
        self.assertIn("check-in is from 15:00", guest.body)
        self.assertIn("You can cancel from My bookings until", guest.body)
        self.assertNotIn("payment of", guest.body)  # nothing was paid online
        alert = self.email("admin_new_booking")
        self.assertIn("guest@example.com", alert.body)
        self.assertIn("No online payment", alert.body)
        self.assertIn("http://localhost:4200/admin/bookings", alert.body)

    def test_guest_cancel(self):
        """EMAIL-16: the guest cancels -> "as you requested", nothing charged."""
        booking, _ = self.book()
        res = self.patch_status(booking, "cancelled")
        self.assertEqual(res.status_code, 200, res.data)
        row = BookingEmail.objects.get(booking=booking, kind=Kind.BOOKING_CANCELLED)
        self.assertEqual((row.status, row.reason), ("sent", "guest"))
        msg = self.email("booking_cancelled")
        self.assertIn("as you requested", msg.body)
        self.assertIn("Nothing was charged.", msg.body)

    def test_admin_cancel_is_the_host(self):
        """EMAIL-17: an admin cancels a guest's booking -> "the host has cancelled"."""
        booking, _ = self.book()
        self.patch_status(booking, "confirmed", as_user=self.admin)
        mail.outbox.clear()
        self.patch_status(booking, "cancelled", as_user=self.admin)
        self.assertEqual(BookingEmail.objects.get(booking=booking, kind=Kind.BOOKING_CANCELLED).reason, "host")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("the host has cancelled", self.email("booking_cancelled").body)

    def test_refused_change_sends_nothing(self):
        """EMAIL-18: a status change that's refused (400) records no email."""
        booking, _ = self.book()
        self.patch_status(booking, "cancelled")
        mail.outbox.clear()
        res = self.patch_status(booking, "cancelled")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(BookingEmail.objects.filter(booking=booking).count(), 2)

    def test_a_broken_mail_provider_never_breaks_booking(self):
        """EMAIL-19: the provider is down -> the booking is still created (201), the email is `failed`."""
        with mock.patch("django.core.mail.message.EmailMessage.send", side_effect=BrevoError("Couldn't reach Brevo")):
            booking, res = self.book()
        self.assertEqual(res.status_code, 201)
        row = BookingEmail.objects.get(booking=booking)
        self.assertEqual((row.status, row.last_error), ("failed", "Couldn't reach Brevo"))

    def test_seeded_bookings_send_nothing(self):
        """EMAIL-20: bookings created outside the API (seed script, Django Admin) don't email anyone."""
        make_booking(email="seeded@example.com")
        self.assertFalse(BookingEmail.objects.exists())

    def test_html_escapes_user_content(self):
        """EMAIL-31: property titles etc. are escaped in the HTML version."""
        self.prop.title = "Loft <script>alert(1)</script>"
        self.prop.save()
        booking, _ = self.book()
        html = self.email("booking_received").alternatives[0][0]
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("<script>", self.email("booking_received").body)  # plain text isn't HTML


@override_settings(**{**PAYMENTS_ON, **EMAILS})
class EmailsWithPaymentsTests(EmailFlowMixin, CheckoutFixtures, APITestCase):
    def test_received_has_pay_now_and_the_hold(self):
        """EMAIL-21: payments on -> "complete your payment" with Pay now and the hold's end time."""
        booking, _ = self.book()
        payment = Payment.objects.get(booking=booking)
        msg = self.email("booking_received")
        self.assertEqual(msg.subject, f"Complete your payment - booking #{booking.pk}, Loft")
        pay_by = timezone.localtime(payment.expires_at).strftime("%H:%M")
        self.assertIn(f"held for you until {pay_by}", msg.body)
        self.assertIn(f"http://localhost:4200/bookings/{booking.pk}/payment", msg.body)
        self.assertIn(">Pay now</a>", msg.alternatives[0][0])

    def test_expired_hold_released_by_the_next_booking(self):
        """EMAIL-22: a stale hold settled when someone else books -> "we didn't receive your payment"."""
        booking, _ = self.book()
        stale(booking)
        self.client.force_authenticate(self.other)
        today = timezone.localdate()
        with self.captureOnCommitCallbacks(execute=True):
            res = self.client.post(reverse("booking-list"), {
                "property": self.prop.id, "check_in": (today + timedelta(days=10)).isoformat(),
                "check_out": (today + timedelta(days=13)).isoformat(), "guests": 1,
            }, format="json")
        self.assertEqual(res.status_code, 201)
        row = BookingEmail.objects.get(booking=booking, kind=Kind.BOOKING_CANCELLED)
        self.assertEqual((row.status, row.reason), ("sent", "payment_expired"))
        msg = next(m for m in mail.outbox if m.tags == ["booking_cancelled"])
        self.assertIn("we didn't receive your payment within 30 minutes", msg.body)
        self.assertIn(f"Book again: http://localhost:4200/listings/{self.prop.pk}", msg.body)
        self.assertIn("Nothing was charged.", msg.body)


@override_settings(**{**PAYMENTS_ON, **EMAILS, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class EmailsFromWebhookTests(EmailFlowMixin, WebhookFixtures, APITestCase):
    def setUp(self):
        with self.captureOnCommitCallbacks(execute=True):
            super().setUp()
        mail.outbox.clear()

    def test_paid_sends_confirmed_once_even_if_stripe_repeats(self):
        """EMAIL-23: payment webhook -> confirmed + alert; the same event again (or a second
        "paid" event) sends nothing more."""
        event = session_event("checkout.session.completed", "cs_test_123")
        self.call(self.deliver, event)
        self.assertEqual(self.state(), ("confirmed", "paid"))
        self.assertEqual(sorted(m.tags[0] for m in mail.outbox), ["admin_new_booking", "booking_confirmed"])
        guest = self.email("booking_confirmed")
        self.assertIn("We've received your payment of €240.15", guest.body)
        self.assertIn("and get a full refund of €240.15", guest.body)
        self.assertIn("Paid online - €240.15", self.email("admin_new_booking").body)

        self.call(self.deliver, event)  # Stripe retries the same event
        self.call(self.deliver, session_event("checkout.session.async_payment_succeeded", "cs_test_123",
                                              event_id="evt_other"))
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(BookingEmail.objects.filter(booking=self.booking).count(), 3)  # received, confirmed, alert

    def test_expired_session_sends_cancelled(self):
        """EMAIL-24: the "expired" webhook -> cancelled, dates released."""
        self.call(self.deliver, session_event("checkout.session.expired", "cs_test_123",
                                              status="expired", payment_status="unpaid"))
        self.assertEqual(self.kinds(self.booking)["booking_cancelled"], "sent")
        self.assertEqual(BookingEmail.objects.get(booking=self.booking, kind=Kind.BOOKING_CANCELLED).reason,
                         "payment_expired")

    def test_failed_payment_sends_cancelled(self):
        """EMAIL-32: a delayed payment that fails -> "your payment didn't go through"."""
        self.call(self.deliver, session_event("checkout.session.completed", "cs_test_123", payment_status="unpaid"))
        self.call(self.deliver, session_event("checkout.session.async_payment_failed", "cs_test_123",
                                              payment_status="unpaid"))
        self.assertIn("your payment didn't go through", self.email("booking_cancelled").body)

    def test_cancel_after_paying_mentions_the_refund(self):
        """EMAIL-25: a paid booking cancelled by the guest -> "A full refund of €X is on its way"."""
        self.call(self.deliver, session_event("checkout.session.completed", "cs_test_123"))
        mail.outbox.clear()
        res = self.patch_status(self.booking, "cancelled")
        self.assertEqual(res.status_code, 200, res.data)
        msg = self.email("booking_cancelled")
        self.assertIn("A full refund of €240.15 is on its way", msg.body)
        self.assertIn("A full refund of €240.15 is on its way", msg.alternatives[0][0])

    def test_received_is_skipped_if_already_confirmed_before_it_went_out(self):
        """EMAIL-26: the "received" email failed, then the booking was paid -> a retry skips it
        (no "complete your payment" after paying)."""
        row = BookingEmail.objects.get(booking=self.booking, kind=Kind.BOOKING_RECEIVED)
        BookingEmail.objects.filter(pk=row.pk).update(status=Status.FAILED)
        self.call(self.deliver, session_event("checkout.session.completed", "cs_test_123"))
        self.assertEqual(send_email(row.pk).status, Status.SKIPPED)
        self.assertNotIn("booking_received", [m.tags[0] for m in mail.outbox])


class FormattingTests(SimpleTestCase):
    def test_money_and_date_ranges_match_the_app(self):
        from datetime import date
        self.assertEqual(money(Decimal("240.00")), "€240")
        self.assertEqual(money(Decimal("95.5")), "€95.50")
        self.assertEqual(money(Decimal("1234.00")), "€1,234")
        self.assertEqual(short_range(date(2027, 3, 10), date(2027, 3, 13)), "10–13 Mar")
        self.assertEqual(short_range(date(2027, 2, 28), date(2027, 3, 3)), "28 Feb – 3 Mar")
        self.assertEqual(short_range(date(2026, 12, 30), date(2027, 1, 2)), "30 Dec 2026 – 2 Jan 2027")


# --- Step 3: retrying (command + Django Admin) --------------------------------

from io import StringIO  # noqa: E402

from django.core.management import call_command  # noqa: E402


@override_settings(**EMAILS)
class RetryTests(TestCase):
    def setUp(self):
        self.booking = make_booking()

    def row(self, kind=Kind.BOOKING_RECEIVED, status=Status.FAILED, attempts=1, booking=None, **extra):
        return BookingEmail.objects.create(booking=booking or self.booking, kind=kind, status=status,
                                           attempts=attempts, recipients="guest@example.com", **extra)

    def run_command(self, *args):
        out, err = StringIO(), StringIO()
        call_command("send_pending_emails", *args, stdout=out, stderr=err)
        return out.getvalue(), err.getvalue()

    def test_command_sends_waiting_emails_and_reports(self):
        """EMAIL-27: send_pending_emails sends pending + failed, skips out-of-date, leaves sent alone."""
        failed = self.row()
        pending = self.row(kind=Kind.BOOKING_CANCELLED, status=Status.PENDING, attempts=0,
                           booking=make_booking(email="b@example.com", status=Booking.Status.CANCELLED),
                           reason="host")
        outdated = self.row(kind=Kind.BOOKING_CONFIRMED)  # the booking is still pending
        done = self.row(kind=Kind.ADMIN_NEW_BOOKING, status=Status.SENT)
        out, err = self.run_command()
        self.assertIn("Sent 2, failed 0, skipped 1.", out)
        self.assertEqual(err, "")
        statuses = {r.pk: r.status for r in BookingEmail.objects.all()}
        self.assertEqual(statuses, {failed.pk: "sent", pending.pk: "sent", outdated.pk: "skipped", done.pk: "sent"})
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.run_command()[0], "Sent 0, failed 0, skipped 0.\n")  # nothing left

    def test_command_reports_failures_and_respects_max_attempts(self):
        """EMAIL-28: still failing -> listed on stderr with the reason; after 5 attempts left for an admin."""
        row = self.row(attempts=4)
        with mock.patch("django.core.mail.message.EmailMessage.send",
                        side_effect=BrevoError("Brevo answered 400: sender not verified", 400)):
            out, err = self.run_command()
        self.assertIn("failed 1", out)
        self.assertIn("sender not verified", err)
        row.refresh_from_db()
        self.assertEqual(row.attempts, 5)
        self.assertIn("0 email(s) would be tried.", self.run_command("--dry-run")[0])
        self.assertIn("1 email(s) would be tried.", self.run_command("--dry-run", "--max-attempts", "0")[0])
        self.assertEqual(len(mail.outbox), 0)

    def test_dry_run_sends_nothing(self):
        self.row()
        out, _ = self.run_command("--dry-run")
        self.assertIn("booking_received booking", out)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(BookingEmail.objects.get().status, Status.FAILED)


@override_settings(**EMAILS)
class OutboxAdminTests(TestCase):
    def setUp(self):
        self.booking = make_booking()
        self.admin = User.objects.create_superuser("root", "root@example.com", "S3cure-Booking-Pass!")
        self.client.force_login(self.admin)
        self.url = reverse("admin:notifications_bookingemail_changelist")

    def test_list_and_booking_inline_are_read_only(self):
        """EMAIL-29: the outbox list and the Booking page's inline show the emails; nothing is editable."""
        row = BookingEmail.objects.create(booking=self.booking, kind=Kind.BOOKING_RECEIVED,
                                          recipients="guest@example.com", status=Status.FAILED,
                                          last_error="Brevo answered 401: Key not found")
        res = self.client.get(self.url)
        self.assertContains(res, "Key not found")
        res = self.client.get(reverse("admin:bookings_booking_change", args=[self.booking.pk]))
        self.assertContains(res, "Key not found")
        res = self.client.post(reverse("admin:notifications_bookingemail_change", args=[row.pk]),
                               {"status": "sent"})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.client.get(reverse("admin:notifications_bookingemail_add")).status_code, 403)

    def test_retry_action(self):
        """EMAIL-30: "Retry sending" sends failed ones and never re-sends a sent one."""
        failed = BookingEmail.objects.create(booking=self.booking, kind=Kind.BOOKING_RECEIVED,
                                             recipients="guest@example.com", status=Status.FAILED, attempts=6)
        sent = BookingEmail.objects.create(booking=self.booking, kind=Kind.ADMIN_NEW_BOOKING,
                                           recipients="owner@example.com", status=Status.SENT, attempts=1)
        res = self.client.post(self.url, {"action": "retry_sending", "_selected_action": [failed.pk, sent.pk]},
                               follow=True)
        self.assertContains(res, "Emails: 1 already sent, 1 sent.")
        failed.refresh_from_db()
        self.assertEqual((failed.status, failed.attempts), ("sent", 7))
        self.assertEqual(len(mail.outbox), 1)
