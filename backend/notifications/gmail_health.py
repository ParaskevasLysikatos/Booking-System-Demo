"""Telling the owner that the Gmail token needs renewing (TICKET-047).

GmailWithBrevoFallbackBackend calls:

    gmail_failed(error)  - Gmail's login failed and the email went through
                           Brevo. When the login is *dead* (GmailLoginError
                           with dead=True - an expired / revoked refresh
                           token, a wrong client), the GmailHealth row
                           records it, and the owner (BOOKING_ALERT_EMAILS)
                           gets one email through Brevo - at most once every
                           ALERT_EVERY while Gmail stays broken. A token
                           service that just couldn't be reached is only
                           logged (the backend's error line) - no alert.
    gmail_worked()       - Gmail sent an email: clears the row, so the next
                           breakage alerts straight away.

The "once a day" is decided under a row lock, so two processes can't both
send it, and it lives in the database, so a restart doesn't send it again.
If the alert can't be sent, the claim is undone (the next fallback tries
again). Nothing here ever raises into the email send that called it.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMessage
from django.db import IntegrityError, transaction
from django.utils import timezone

from .brevo import BrevoEmailBackend
from .models import GmailHealth

logger = logging.getLogger(__name__)

ALERT_EVERY = timedelta(hours=24)
SUBJECT = "Action needed: renew the Gmail token for booking emails"


def gmail_failed(error, now=None):
    """Record a dead Gmail login and alert the owner if due. Never raises."""
    if not getattr(error, "dead", False):
        return
    try:
        _gmail_failed(error, now or timezone.now())
    except Exception:
        logger.exception("Couldn't record the Gmail login failure")


def gmail_worked():
    """Gmail sent an email - clear any recorded failure. Never raises."""
    try:
        if GmailHealth.objects.filter(pk=1, failing_since__isnull=False).update(
                failing_since=None, last_error="", alerted_at=None, updated_at=timezone.now()):
            logger.info("Gmail sends again - the Brevo fallback is no longer used.")
    except Exception:
        logger.exception("Couldn't record that Gmail works again")


def _row_for_update():
    try:
        with transaction.atomic():
            GmailHealth.objects.get_or_create(pk=1)
    except IntegrityError:
        pass  # created by a simultaneous request
    return GmailHealth.objects.select_for_update().get(pk=1)


def _gmail_failed(error, now):
    with transaction.atomic():
        row = _row_for_update()
        previous_alert = row.alerted_at
        row.failing_since = row.failing_since or now
        row.last_error = str(error)[:500]
        due = previous_alert is None or previous_alert <= now - ALERT_EVERY
        if due:
            row.alerted_at = now  # claimed - a second process now sees "not due"
        row.save()
    if not due:
        return
    if not _send_alert(row):
        # Not sent: give the claim back so the next fallback tries again.
        GmailHealth.objects.filter(pk=1, alerted_at=now).update(alerted_at=previous_alert)


def _send_alert(row):
    recipients = list(settings.BOOKING_ALERT_EMAILS)
    if not recipients:
        logger.error("The Gmail token needs renewing (%s) - no BOOKING_ALERT_EMAILS to tell.", row.last_error)
        return True  # nobody to tell - don't keep trying
    message = EmailMessage(subject=SUBJECT, body=alert_body(row), from_email=settings.DEFAULT_FROM_EMAIL,
                           to=recipients, reply_to=[settings.DEFAULT_FROM_EMAIL])
    try:
        BrevoEmailBackend().send_messages([message])
    except Exception as exc:
        logger.error("Couldn't email the owner that the Gmail token needs renewing: %s", exc)
        return False
    logger.warning("Told %s that the Gmail token needs renewing.", ", ".join(recipients))
    return True


def alert_body(row):
    since = timezone.localtime(row.failing_since).strftime("%d %b %Y, %H:%M")
    return f"""Hello,

The Booking System Demo can't send emails through Gmail any more: Google no
longer accepts its login (the Gmail refresh token has expired or was revoked).

  Failing since: {since}
  Google's answer: {row.last_error}

Nothing is lost: booking emails are going out through Brevo instead (guests
see a ...@brevosend.com sender; replies still come to you). To send as your
Gmail again, renew the token:

  1. docker compose exec backend python manage.py gmail_authorize
  2. Sign in with the Gmail that sends the emails, allow "Send email on your
     behalf", paste the browser address back into the terminal.
  3. Put the printed GMAIL_REFRESH_TOKEN into .env, and on Render
     (booking-demo-api -> Environment), then redeploy.

Details: the README section "Gmail token: renew it, or make it permanent".

You'll get this email at most once a day until Gmail sends again.

- Booking System Demo
"""
