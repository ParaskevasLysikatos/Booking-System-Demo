"""A Django email backend for Brevo's HTTP API - the backup provider (TICKET-047).

Brevo was TICKET-030's first provider (git history: 3b57bb0) and was replaced
by the Gmail API because Brevo has to rewrite a @gmail.com sender to its own
`...@brevosend.com` address (Gmail's anti-spoofing rules). As a *fallback*
that's fine: the Reply-To stays the owner's Gmail, so replies still reach
the owner. It is used only by GmailWithBrevoFallbackBackend
(notifications/backends.py) when Gmail's login is dead, and for the owner's
"the Gmail token needs renewing" email (notifications/gmail_health.py).

Why HTTP, not SMTP: Render's free web services block outbound SMTP ports.
One POST per email:

    POST https://api.brevo.com/v3/smtp/email
    api-key: xkeysib-...
    {"sender": {...}, "to": [...], "subject": ..., "htmlContent": ..., "textContent": ...}
    -> 201 {"messageId": "<...>"}

Only the standard library is used (urllib), so no new package. Any Django
EmailMessage / EmailMultiAlternatives works: the plain body becomes
`textContent`, an attached text/html alternative becomes `htmlContent`.

After a successful send, `message.provider_message_id` holds Brevo's
messageId and `message.email_provider` is "brevo". On failure an
EmailSendError is raised (unless fail_silently) with `refused=True` when
Brevo answered with a 4xx (a wrong key, an unverified sender - retrying the
same email won't help until that's fixed) and `refused=False` when the
outcome is unknown (network error, timeout, 5xx, 429). The API key is never
part of an error message.
"""
import json
import urllib.error
import urllib.request
from email.utils import getaddresses, parseaddr

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

from .errors import EmailSendError

# Standard headers Brevo rejects in its `headers` field (they have their own fields).
_STANDARD_HEADERS = {"reply-to", "from", "to", "cc", "bcc", "subject"}


def _address(value):
    name, email = parseaddr(value)
    result = {"email": email}
    if name:
        result["name"] = name
    return result


def _addresses(values):
    return [_address(f"{name} <{email}>" if name else email)
            for name, email in getaddresses(values or []) if email]


def _error_text(exc):
    """Brevo's error body is {"code": "...", "message": "..."}; fall back to
    the HTTP reason. Never includes the API key."""
    try:
        data = json.loads(exc.read() or b"{}")
        text = data.get("message") or data.get("code")
    except (ValueError, AttributeError, OSError):
        text = None
    return (str(text or exc.reason or "error")).strip()


class BrevoEmailBackend(BaseEmailBackend):
    provider_name = "brevo"

    def __init__(self, fail_silently=False, api_key=None, api_url=None, timeout=None, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.api_key = api_key if api_key is not None else settings.BREVO_API_KEY
        self.api_url = api_url or settings.BREVO_API_URL
        self.timeout = timeout or settings.EMAIL_TIMEOUT

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages or []:
            try:
                message.provider_message_id = self._send(message)
                message.email_provider = self.provider_name
                sent += 1
            except EmailSendError:
                if not self.fail_silently:
                    raise
        return sent

    def payload(self, message):
        """The JSON body for one message (public so tests can check it)."""
        body = {
            "sender": _address(message.from_email or settings.DEFAULT_FROM_EMAIL),
            "to": _addresses(message.to),
            "subject": message.subject,
        }
        if message.cc:
            body["cc"] = _addresses(message.cc)
        if message.bcc:
            body["bcc"] = _addresses(message.bcc)
        if message.reply_to:
            body["replyTo"] = _address(message.reply_to[0])

        html = next((content for content, mimetype in getattr(message, "alternatives", [])
                     if mimetype == "text/html"), None)
        if message.content_subtype == "html":
            html = html or message.body
        elif message.body:
            body["textContent"] = message.body
        if html:
            body["htmlContent"] = html
        if "textContent" not in body and "htmlContent" not in body:
            body["textContent"] = " "  # Brevo needs some content

        headers = {k: str(v) for k, v in (message.extra_headers or {}).items()
                   if k.lower() not in _STANDARD_HEADERS}
        if headers:
            body["headers"] = headers
        return body

    def _send(self, message):
        if not self.api_key:
            raise EmailSendError("BREVO_API_KEY isn't set.")
        if not message.recipients():
            raise EmailSendError("The email has no recipients.")
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(self.payload(message)).encode("utf-8"),
            method="POST",
            headers={
                "api-key": self.api_key,
                "accept": "application/json",
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raise EmailSendError(f"Brevo answered {exc.code}: {_error_text(exc)}", status=exc.code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise EmailSendError(f"Couldn't reach Brevo: {getattr(exc, 'reason', exc)}") from exc
        try:
            return str(json.loads(raw or b"{}").get("messageId", ""))
        except (ValueError, AttributeError):
            return ""
