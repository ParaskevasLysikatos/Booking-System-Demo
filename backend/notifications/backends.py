"""A Django email backend for the Gmail API (TICKET-030).

Why the Gmail API: Render's free web services block outbound SMTP ports, so
on Render the email has to go out over HTTPS - and sending through Google
itself means the sender really is the owner's Gmail address (a third-party
service such as Brevo has to replace a @gmail.com sender with its own
address, because of Gmail's anti-spoofing rules). Every email also shows up
in that Gmail's "Sent" folder.

How: OAuth 2.0 with a long-lived *refresh token* for the one Gmail account
(created once with `manage.py gmail_authorize`, scope `gmail.send` only):

    POST https://oauth2.googleapis.com/token             (refresh token -> access token, ~1 hour)
    POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
         Authorization: Bearer <access token>
         {"raw": "<the whole MIME message, base64url>"}
    -> 200 {"id": "...", "threadId": "..."}

Only the standard library is used (urllib), so no new package. The message
is Django's own MIME output (`EmailMessage.message()`), so text + HTML
alternatives, Reply-To etc. are exactly what Django builds. The access token
is cached per process until shortly before it expires; a 401 from Gmail
drops it and retries once with a fresh one.

After a successful send, `message.provider_message_id` holds Gmail's message
id and `message.email_provider` is "gmail". On failure an EmailSendError
(notifications/errors.py) is raised (unless fail_silently) with
`refused=True` when Google answered with a 4xx (e.g. the refresh token was
revoked - retrying won't help until it's replaced) and `refused=False` when
the outcome is unknown (network error, timeout, 5xx, 429). When the failure
is Gmail's *login* (nothing was sent), it's a GmailLoginError - see
GmailWithBrevoFallbackBackend at the end of this file (TICKET-047).
"""
import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

from .brevo import BrevoEmailBackend
from .errors import EmailSendError, GmailLoginError

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPE = "https://www.googleapis.com/auth/gmail.send"


def _error_text(exc):
    """Google's error bodies: {"error": "invalid_grant", "error_description": ...}
    (OAuth) or {"error": {"code": 403, "message": ...}} (Gmail). Never
    includes a secret."""
    try:
        data = json.loads(exc.read() or b"{}")
    except (ValueError, OSError):
        data = {}
    error = data.get("error")
    if isinstance(error, dict):
        text = error.get("message") or error.get("status")
    else:
        text = " - ".join(t for t in (error, data.get("error_description")) if t)
    return (text or exc.reason or "error").strip()


def post(url, *, data=None, json_body=None, headers=None, timeout=10):
    """POST and return the decoded JSON answer, or raise EmailSendError."""
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers = {**(headers or {}), "content-type": "application/json"}
    else:
        body = urllib.parse.urlencode(data or {}).encode("utf-8")
        headers = {**(headers or {}), "content-type": "application/x-www-form-urlencoded"}
    request = urllib.request.Request(url, data=body, method="POST", headers={"accept": "application/json", **headers})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise EmailSendError(f"Google answered {exc.code}: {_error_text(exc)}", status=exc.code) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise EmailSendError(f"Couldn't reach Google: {getattr(exc, 'reason', exc)}") from exc
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        return {}


class GmailApiEmailBackend(BaseEmailBackend):
    provider_name = "gmail"
    _lock = threading.Lock()
    _token = None  # (access_token, expires_at monotonic) - shared by the process

    def __init__(self, fail_silently=False, timeout=None, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.client_id = settings.GMAIL_CLIENT_ID
        self.client_secret = settings.GMAIL_CLIENT_SECRET
        self.refresh_token = settings.GMAIL_REFRESH_TOKEN
        self.timeout = timeout or settings.EMAIL_TIMEOUT

    # --- access token ---------------------------------------------------------

    def access_token(self, force=False):
        with self._lock:
            cached = GmailApiEmailBackend._token
            if not force and cached and cached[1] > time.monotonic():
                return cached[0]
            if not (self.client_id and self.client_secret and self.refresh_token):
                raise GmailLoginError("The Gmail API isn't configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / "
                                      "GMAIL_REFRESH_TOKEN).", dead=True)
            try:
                answer = post(TOKEN_URL, timeout=self.timeout, data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": self.refresh_token,
                    "grant_type": "refresh_token",
                })
            except EmailSendError as exc:
                # Nothing has been sent yet, whatever went wrong here (TICKET-047).
                # A 4xx (invalid_grant, invalid_client ...) = the login is dead;
                # network / 5xx / 429 = Google's token service is unreachable.
                if "invalid_grant" in str(exc):
                    raise GmailLoginError(
                        f"{exc} - the Gmail refresh token was revoked or has expired; "
                        "run `manage.py gmail_authorize` again and update GMAIL_REFRESH_TOKEN.",
                        status=exc.status, dead=True,
                    ) from exc
                raise GmailLoginError(str(exc), status=exc.status, dead=exc.refused) from exc
            token = answer.get("access_token")
            if not token:
                raise GmailLoginError("Google returned no access token.")
            # a minute of margin so a token never expires mid-request
            GmailApiEmailBackend._token = (token, time.monotonic() + int(answer.get("expires_in", 3600)) - 60)
            return token

    @classmethod
    def forget_token(cls):
        with cls._lock:
            cls._token = None

    # --- sending --------------------------------------------------------------

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

    @staticmethod
    def raw(message):
        """The whole MIME message, base64url - what the Gmail API expects."""
        return base64.urlsafe_b64encode(message.message().as_bytes()).decode("ascii")

    def _send(self, message):
        if not message.recipients():
            raise EmailSendError("The email has no recipients.")
        body = {"raw": self.raw(message)}
        for attempt in (1, 2):
            token = self.access_token(force=attempt == 2)
            try:
                answer = post(SEND_URL, json_body=body, timeout=self.timeout,
                              headers={"authorization": f"Bearer {token}"})
                return str(answer.get("id", ""))
            except EmailSendError as exc:
                if exc.status == 401 and attempt == 1:
                    continue  # the cached access token went stale - get a fresh one once
                if exc.status == 401:
                    # Refused even with a brand-new access token: the login is
                    # dead (e.g. the gmail.send permission was withdrawn).
                    raise GmailLoginError(f"{exc} (even with a fresh access token)", status=401, dead=True) from exc
                raise


class GmailWithBrevoFallbackBackend(BaseEmailBackend):
    """Gmail first; Brevo when Gmail can't log in (TICKET-047).

    Used when EMAIL_PROVIDER=gmail, EMAIL_FALLBACK_PROVIDER=brevo and
    BREVO_API_KEY is set (config/settings.py). Per message:

      - Gmail sends it -> done (`email_provider` "gmail").
      - Gmail's *login* fails (GmailLoginError: `invalid_grant` / a dead
        client, a 401 even with a fresh access token, or Google's token
        service unreachable) -> nothing was sent, so the same message goes
        through Brevo (`email_provider` "brevo"). Logged as an error.
      - Any other Gmail failure - Gmail refusing this one message, or a
        network error / 5xx / timeout on the *send* itself, where Gmail may
        already have sent it - is raised as it is: the outbox records
        `failed` and the normal retry tries Gmail again. Falling back there
        could email the guest twice.

    If Brevo fails too, one EmailSendError names both reasons (Brevo's
    status decides whether it's worth retrying). No secret is ever part of a
    message.
    """

    def __init__(self, fail_silently=False, timeout=None, **kwargs):
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.gmail = GmailApiEmailBackend(timeout=timeout)
        self.brevo = BrevoEmailBackend(timeout=timeout)

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages or []:
            try:
                sent += self._send(message)
            except EmailSendError:
                if not self.fail_silently:
                    raise
        return sent

    def _send(self, message):
        try:
            return self.gmail.send_messages([message])
        except GmailLoginError as gmail_error:
            logger.error("Gmail can't log in (%s) - sending %r through Brevo instead.",
                         gmail_error, message.extra_headers.get("X-Booking-Email", message.subject))
            try:
                return self.brevo.send_messages([message])
            except EmailSendError as brevo_error:
                raise EmailSendError(f"{gmail_error} | Brevo fallback: {brevo_error}",
                                     status=brevo_error.status) from brevo_error
