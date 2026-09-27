"""A Django email backend for Brevo's HTTP API (TICKET-030).

Why not SMTP: Render's free web services block outbound SMTP ports, so on
Render the email has to go out over HTTPS. Brevo's transactional API is one
POST per email:

    POST https://api.brevo.com/v3/smtp/email
    api-key: xkeysib-...
    {"sender": {...}, "to": [...], "subject": ..., "htmlContent": ..., "textContent": ...}
    -> 201 {"messageId": "<...>"}

Only the standard library is used (urllib), so no new package. Any Django
EmailMessage / EmailMultiAlternatives works: the plain body becomes
`textContent`, an attached text/html alternative becomes `htmlContent`.

After a successful send, `message.provider_message_id` holds Brevo's
messageId. On failure a BrevoError is raised (unless fail_silently) with
`refused=True` when Brevo answered with a 4xx (e.g. a wrong key or an
unverified sender - retrying the same email won't help until that's fixed)
and `refused=False` when the outcome is unknown (network error, timeout, 5xx).
"""
import json
import urllib.error
import urllib.request
from email.utils import getaddresses, parseaddr

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class BrevoError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status

    @property
    def refused(self):
        return self.status is not None and 400 <= self.status < 500 and self.status != 429


def _address(value):
    name, email = parseaddr(value)
    result = {"email": email}
    if name:
        result["name"] = name
    return result


def _addresses(values):
    return [_address(f"{name} <{email}>" if name else email)
            for name, email in getaddresses(values or []) if email]


class BrevoEmailBackend(BaseEmailBackend):
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
                sent += 1
            except BrevoError:
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

        # Non-standard headers only (Brevo rejects standard ones). Our outbox
        # sets Idempotency-Key; Brevo doesn't document de-duplicating on it,
        # so the real "never twice" guard is the outbox itself.
        headers = {k: str(v) for k, v in (message.extra_headers or {}).items()
                   if k.lower() not in {"reply-to", "from", "to", "cc", "bcc", "subject"}}
        if headers:
            body["headers"] = headers
        tags = getattr(message, "tags", None)
        if tags:
            body["tags"] = list(tags)
        return body

    def _send(self, message):
        if not self.api_key:
            raise BrevoError("BREVO_API_KEY isn't set.")
        if not message.to and not message.cc and not message.bcc:
            raise BrevoError("The email has no recipients.")
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
            raise BrevoError(f"Brevo answered {exc.code}: {_error_text(exc)}", status=exc.code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise BrevoError(f"Couldn't reach Brevo: {reason}") from exc
        try:
            return str(json.loads(raw or b"{}").get("messageId", ""))
        except (ValueError, AttributeError):
            return ""


def _error_text(exc):
    """Brevo's error body is {"code": "...", "message": "..."}; fall back to
    the HTTP reason. Never includes the API key."""
    try:
        data = json.loads(exc.read() or b"{}")
        text = data.get("message") or data.get("code")
    except (ValueError, AttributeError, OSError):
        text = None
    return (text or exc.reason or "error").strip()
