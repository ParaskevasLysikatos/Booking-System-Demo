"""TICKET-047: Brevo as the backup email provider - the Brevo backend, which
provider sent each outbox email, the Gmail -> Brevo fallback and the
"Gmail token needs renewing" alert.

(Only helper functions are imported from tests.py - importing its TestCase
classes would run them twice.)
"""
import json
import urllib.error
from io import BytesIO
from unittest import mock

from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.test import SimpleTestCase, TestCase, override_settings

from .backends import GmailApiEmailBackend
from .brevo import BrevoEmailBackend
from .errors import EmailSendError
from .models import BookingEmail
from .outbox import send_email
from .tests import GMAIL, FakeResponse, http_error, make_booking, sent_answer, token_answer

Kind = BookingEmail.Kind
Status = BookingEmail.Status
Provider = BookingEmail.Provider

BREVO = dict(BREVO_API_KEY="xkeysib-secret", BREVO_API_URL="https://api.brevo.com/v3/smtp/email",
             DEFAULT_FROM_EMAIL="Booking Demo <owner@gmail.com>")


def brevo_answer(message_id="<abc@smtp-relay.mailin.fr>"):
    return FakeResponse(json.dumps({"messageId": message_id}).encode())


def brevo_error(code, body=b'{"code": "unauthorized", "message": "Key not found"}'):
    return urllib.error.HTTPError("https://api.brevo.com/v3/smtp/email", code, "Error", {}, BytesIO(body))


def booking_message(**extra):
    """Shaped like notifications.messages.build_message()'s output."""
    msg = EmailMultiAlternatives(
        subject="Booking confirmed", body="Plain text", from_email="Booking Demo <owner@gmail.com>",
        to=["Guest One <guest@example.com>"], reply_to=["Booking Demo <owner@gmail.com>"],
        headers={"X-Booking-Email": "booking-1-booking_confirmed"}, **extra,
    )
    msg.attach_alternative("<p>HTML</p>", "text/html")
    return msg


# --- Brevo backend (step 1) ----------------------------------------------------

@override_settings(**BREVO)
class BrevoBackendTests(SimpleTestCase):
    def test_payload_maps_the_message(self):
        """PROV-01: sender with name, recipient, subject, text + HTML, Reply-To = the owner, our header."""
        payload = BrevoEmailBackend().payload(booking_message())
        self.assertEqual(payload["sender"], {"email": "owner@gmail.com", "name": "Booking Demo"})
        self.assertEqual(payload["to"], [{"email": "guest@example.com", "name": "Guest One"}])
        self.assertEqual(payload["subject"], "Booking confirmed")
        self.assertEqual(payload["textContent"], "Plain text")
        self.assertEqual(payload["htmlContent"], "<p>HTML</p>")
        self.assertEqual(payload["replyTo"], {"email": "owner@gmail.com", "name": "Booking Demo"})
        self.assertEqual(payload["headers"], {"X-Booking-Email": "booking-1-booking_confirmed"})

    def test_sends_one_post_and_keeps_the_message_id(self):
        """PROV-02: a 201 from Brevo = sent; its messageId and the provider are kept on the message."""
        msg = booking_message()
        with mock.patch("urllib.request.urlopen", return_value=brevo_answer()) as post:
            self.assertEqual(BrevoEmailBackend().send_messages([msg]), 1)
        self.assertEqual(msg.provider_message_id, "<abc@smtp-relay.mailin.fr>")
        self.assertEqual(msg.email_provider, "brevo")
        request = post.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(request.get_header("Api-key"), "xkeysib-secret")
        self.assertEqual(json.loads(request.data)["subject"], "Booking confirmed")
        self.assertEqual(post.call_args.kwargs["timeout"], 10)

    def test_a_4xx_is_a_refusal_without_the_key_in_the_error(self):
        """PROV-03: Brevo said no (bad key, unverified sender) -> refused, readable reason, no key."""
        with mock.patch("urllib.request.urlopen", side_effect=brevo_error(401)):
            with self.assertRaises(EmailSendError) as ctx:
                BrevoEmailBackend().send_messages([booking_message()])
        self.assertTrue(ctx.exception.refused)
        self.assertEqual(str(ctx.exception), "Brevo answered 401: Key not found")
        self.assertNotIn("xkeysib-secret", str(ctx.exception))

    def test_network_errors_and_5xx_are_unknown_outcomes(self):
        """PROV-04: couldn't reach Brevo / a 5xx / a 429 -> not a refusal (worth retrying)."""
        for error in (urllib.error.URLError("timed out"), brevo_error(503, b""), brevo_error(429, b"")):
            with self.subTest(error=error), mock.patch("urllib.request.urlopen", side_effect=error):
                with self.assertRaises(EmailSendError) as ctx:
                    BrevoEmailBackend().send_messages([booking_message()])
                self.assertFalse(ctx.exception.refused)

    def test_fail_silently_missing_key_and_no_recipients(self):
        with mock.patch("urllib.request.urlopen", side_effect=brevo_error(401)):
            self.assertEqual(BrevoEmailBackend(fail_silently=True).send_messages([booking_message()]), 0)
        with mock.patch("urllib.request.urlopen") as post:
            with self.assertRaisesMessage(EmailSendError, "BREVO_API_KEY isn't set."):
                BrevoEmailBackend(api_key="").send_messages([booking_message()])
            with self.assertRaisesMessage(EmailSendError, "no recipients"):
                BrevoEmailBackend().send_messages([EmailMultiAlternatives(subject="S", body="b")])
        post.assert_not_called()

    def test_html_only_and_empty_messages(self):
        html = EmailMultiAlternatives(subject="S", body="<b>hi</b>", to=["a@example.com"])
        html.content_subtype = "html"
        payload = BrevoEmailBackend().payload(html)
        self.assertEqual(payload["htmlContent"], "<b>hi</b>")
        self.assertNotIn("textContent", payload)
        empty = EmailMultiAlternatives(subject="S", body="", to=["a@example.com"])
        self.assertEqual(BrevoEmailBackend().payload(empty)["textContent"], " ")


# --- Which provider sent each outbox email (step 1) -----------------------------

class OutboxProviderTests(TestCase):
    def setUp(self):
        self.row = BookingEmail.objects.create(booking=make_booking(), kind=Kind.BOOKING_RECEIVED,
                                               recipients="guest@example.com")

    def test_gmail_is_recorded(self):
        """PROV-05: sent through the Gmail API -> provider gmail + Gmail's id."""
        GmailApiEmailBackend.forget_token()
        self.addCleanup(GmailApiEmailBackend.forget_token)
        with override_settings(EMAIL_BACKEND="notifications.backends.GmailApiEmailBackend", **GMAIL), \
                mock.patch("urllib.request.urlopen", side_effect=[token_answer(), sent_answer("18f0abc")]):
            row = send_email(self.row.pk)
        self.assertEqual((row.status, row.provider, row.provider_message_id), (Status.SENT, Provider.GMAIL, "18f0abc"))

    def test_brevo_is_recorded(self):
        with override_settings(EMAIL_BACKEND="notifications.brevo.BrevoEmailBackend", **BREVO), \
                mock.patch("urllib.request.urlopen", return_value=brevo_answer("<b1@brevo>")):
            row = send_email(self.row.pk)
        self.assertEqual((row.status, row.provider, row.provider_message_id), (Status.SENT, Provider.BREVO, "<b1@brevo>"))

    def test_console_and_smtp_are_named_after_the_backend(self):
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"), \
                mock.patch("sys.stdout"):
            self.assertEqual(send_email(self.row.pk).provider, Provider.CONSOLE)
        other = BookingEmail.objects.create(booking=self.row.booking, kind=Kind.BOOKING_CANCELLED,
                                            recipients="guest@example.com")
        self.row.booking.status = self.row.booking.Status.CANCELLED
        self.row.booking.save()
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"), \
                mock.patch("django.core.mail.backends.smtp.EmailBackend.send_messages", return_value=1):
            self.assertEqual(send_email(other.pk).provider, Provider.SMTP)

    def test_failed_and_unknown_backends_leave_it_empty(self):
        """The tests' in-memory backend isn't a provider; a failed send records no provider."""
        with mock.patch("django.core.mail.message.EmailMessage.send", side_effect=EmailSendError("down")):
            row = send_email(self.row.pk)
        self.assertEqual((row.status, row.provider), (Status.FAILED, ""))
        row = send_email(self.row.pk)
        self.assertEqual((row.status, row.provider), (Status.SENT, ""))
        self.assertEqual(len(mail.outbox), 1)
