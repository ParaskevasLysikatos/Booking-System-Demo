"""TICKET-047: Brevo as the backup email provider - the Brevo backend, which
provider sent each outbox email, the Gmail -> Brevo fallback and the
"Gmail token needs renewing" alert.

(Only helper functions are imported from tests.py - importing its TestCase
classes would run them twice.)
"""
import json
from contextlib import nullcontext
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


# --- Gmail -> Brevo fallback (step 2) -------------------------------------------

FALLBACK = "notifications.backends.GmailWithBrevoFallbackBackend"
INVALID_GRANT = b'{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}'
SECRETS = ("csecret", "1//refresh", "xkeysib-secret")


def gmail_http_error(code, body=INVALID_GRANT):
    return http_error(code, body)


@override_settings(**{**GMAIL, **BREVO})
class FallbackBackendTests(SimpleTestCase):
    def setUp(self):
        GmailApiEmailBackend.forget_token()
        self.addCleanup(GmailApiEmailBackend.forget_token)

    def send(self, *answers, message=None, **kwargs):
        from .backends import GmailWithBrevoFallbackBackend

        msg = message or booking_message()
        with mock.patch("urllib.request.urlopen", side_effect=list(answers)) as post, \
                (self.assertLogs("notifications.backends", "ERROR") if kwargs.pop("logs", False) else nullcontext()):
            sent = GmailWithBrevoFallbackBackend(**kwargs).send_messages([msg])
        return sent, msg, [c.args[0].full_url for c in post.call_args_list]

    def test_gmail_works_brevo_not_called(self):
        """PROV-06: a working Gmail sends it - Brevo is never called."""
        sent, msg, urls = self.send(token_answer(), sent_answer("g1"))
        self.assertEqual((sent, msg.email_provider, msg.provider_message_id), (1, "gmail", "g1"))
        self.assertNotIn("https://api.brevo.com/v3/smtp/email", urls)

    def test_expired_refresh_token_goes_through_brevo(self):
        """PROV-07: invalid_grant -> the same message through Brevo; Gmail's send is never tried."""
        sent, msg, urls = self.send(gmail_http_error(400), brevo_answer("<b1@brevo>"), logs=True)
        self.assertEqual((sent, msg.email_provider, msg.provider_message_id), (1, "brevo", "<b1@brevo>"))
        self.assertEqual(urls, ["https://oauth2.googleapis.com/token", "https://api.brevo.com/v3/smtp/email"])

    def test_the_brevo_copy_is_the_same_email(self):
        with mock.patch("urllib.request.urlopen", side_effect=[gmail_http_error(400), brevo_answer()]) as post, \
                self.assertLogs("notifications.backends", "ERROR") as logs:
            from .backends import GmailWithBrevoFallbackBackend
            GmailWithBrevoFallbackBackend().send_messages([booking_message()])
        body = json.loads(post.call_args_list[1].args[0].data)
        self.assertEqual(body["to"], [{"email": "guest@example.com", "name": "Guest One"}])
        self.assertEqual(body["replyTo"]["email"], "owner@gmail.com")
        self.assertEqual((body["textContent"], body["htmlContent"]), ("Plain text", "<p>HTML</p>"))
        self.assertIn("booking-1-booking_confirmed", logs.output[0])
        self.assertIn("invalid_grant", logs.output[0])
        for secret in SECRETS:
            self.assertNotIn(secret, logs.output[0])

    def test_dead_login_variants_fall_back(self):
        """PROV-08: a wrong client (401 invalid_client) and a 401 even with a fresh access token."""
        sent, msg, _ = self.send(http_error(401), brevo_answer(), logs=True)
        self.assertEqual(msg.email_provider, "brevo")
        GmailApiEmailBackend.forget_token()
        unauthorized = b'{"error": {"code": 401, "message": "Invalid Credentials"}}'
        sent, msg, urls = self.send(token_answer("a"), http_error(401, unauthorized), token_answer("b"),
                                    http_error(401, unauthorized), brevo_answer(), logs=True)
        self.assertEqual((sent, msg.email_provider), (1, "brevo"))
        self.assertEqual(urls.count("https://gmail.googleapis.com/gmail/v1/users/me/messages/send"), 2)

    def test_token_service_unreachable_falls_back(self):
        """PROV-09: network / 5xx / 429 while getting the token -> nothing was sent -> Brevo."""
        for error in (urllib.error.URLError("timed out"), http_error(503, b""), http_error(429, b"")):
            GmailApiEmailBackend.forget_token()
            with self.subTest(error=error):
                sent, msg, _ = self.send(error, brevo_answer(), logs=True)
                self.assertEqual((sent, msg.email_provider), (1, "brevo"))

    def test_a_failed_send_itself_does_not_fall_back(self):
        """PROV-10: Gmail refusing this message, or a 5xx / timeout on the send (it may have gone
        out) -> raised as before, Brevo never called (no duplicate emails)."""
        refused = http_error(400, b'{"error": {"code": 400, "message": "Invalid To header"}}')
        for error in (refused, http_error(503, b""), urllib.error.URLError("timed out")):
            GmailApiEmailBackend.forget_token()
            with self.subTest(error=error):
                with self.assertRaises(EmailSendError) as ctx:
                    self.send(token_answer(), error)
                self.assertNotIn("Brevo", str(ctx.exception))

    def test_brevo_failing_too_names_both(self):
        """PROV-11: both fail -> one error with both reasons, Brevo's status, no secrets."""
        with self.assertRaises(EmailSendError) as ctx:
            self.send(gmail_http_error(400), brevo_error(401), logs=True)
        text = str(ctx.exception)
        self.assertIn("invalid_grant", text)
        self.assertIn("Brevo fallback: Brevo answered 401: Key not found", text)
        self.assertEqual(ctx.exception.status, 401)
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        sent, _, _ = self.send(gmail_http_error(400), brevo_error(401), logs=True, fail_silently=True)
        self.assertEqual(sent, 0)


class FallbackOutboxTests(TestCase):
    @override_settings(EMAIL_BACKEND=FALLBACK, **{**GMAIL, **BREVO})
    def test_outbox_records_brevo(self):
        """PROV-12: through the outbox - `sent`, provider brevo, Brevo's id, no error kept."""
        GmailApiEmailBackend.forget_token()
        self.addCleanup(GmailApiEmailBackend.forget_token)
        row = BookingEmail.objects.create(booking=make_booking(), kind=Kind.BOOKING_RECEIVED,
                                          recipients="guest@example.com")
        with mock.patch("urllib.request.urlopen", side_effect=[gmail_http_error(400), brevo_answer("<b2@brevo>")]), \
                self.assertLogs("notifications.backends", "ERROR"):
            row = send_email(row.pk)
        self.assertEqual((row.status, row.provider, row.provider_message_id, row.last_error),
                         (Status.SENT, Provider.BREVO, "<b2@brevo>", ""))


class FallbackSettingsTests(SimpleTestCase):
    """PROV-13: which backend the settings pick (read in a fresh process - settings are computed at import)."""

    def backend(self, **env):
        import os
        import subprocess
        import sys

        from django.conf import settings

        clean = {k: v for k, v in os.environ.items()
                 if not k.startswith(("EMAIL_", "GMAIL_", "BREVO_"))}
        clean.update(env)
        out = subprocess.run(
            [sys.executable, "-c", "import django; django.setup(); from django.conf import settings; "
                                   "print(settings.EMAIL_BACKEND)"],
            cwd=settings.BASE_DIR, env={**clean, "DJANGO_SETTINGS_MODULE": "config.settings"},
            capture_output=True, text=True, check=True)
        return out.stdout.strip().rsplit(".", 1)[-1]

    def test_backend_choice(self):
        gmail = dict(EMAIL_PROVIDER="gmail", GMAIL_CLIENT_ID="c", GMAIL_CLIENT_SECRET="s", GMAIL_REFRESH_TOKEN="r")
        self.assertEqual(self.backend(**gmail), "GmailApiEmailBackend")  # no fallback = today's behaviour
        self.assertEqual(self.backend(**gmail, EMAIL_FALLBACK_PROVIDER="brevo"), "GmailApiEmailBackend")  # no key
        self.assertEqual(self.backend(**gmail, EMAIL_FALLBACK_PROVIDER="brevo", BREVO_API_KEY="k"),
                         "GmailWithBrevoFallbackBackend")
        self.assertEqual(self.backend(EMAIL_PROVIDER="smtp", EMAIL_FALLBACK_PROVIDER="brevo", BREVO_API_KEY="k"),
                         "EmailBackend")  # only Gmail is backed up


class FallbackChecksTests(SimpleTestCase):
    def ids(self, **settings):
        from .checks import email_settings_check

        base = dict(EMAIL_PROVIDER="gmail", GMAIL_CLIENT_ID="c", GMAIL_CLIENT_SECRET="s", GMAIL_REFRESH_TOKEN="r",
                    DEFAULT_FROM_EMAIL="Demo <owner@gmail.com>", BOOKING_ALERT_EMAILS=[],
                    EMAIL_FALLBACK_PROVIDER="brevo", BREVO_API_KEY="k")
        with override_settings(**{**base, **settings}):
            return [p.id for p in email_settings_check()]

    def test_fallback_warnings(self):
        """PROV-14: a complete setup is fine; a fallback that can't work warns (never an error)."""
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.ids(EMAIL_FALLBACK_PROVIDER=""), [])
        self.assertEqual(self.ids(EMAIL_FALLBACK_PROVIDER="sendgrid"), ["notifications.W005"])
        self.assertEqual(self.ids(BREVO_API_KEY=""), ["notifications.W006"])
        self.assertEqual(self.ids(EMAIL_PROVIDER="smtp"), ["notifications.W007"])
