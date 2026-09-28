"""The email outbox (TICKET-030): record in the transaction, send after commit.

    enqueue(booking, kind)   - call inside the transaction that changes the
                               booking. Creates the BookingEmail row (at most
                               one per booking + kind) and schedules the send
                               for after the commit.
    send_email(email_id)     - claims the row (locked, briefly), renders and
                               sends it with no DB lock held, then records
                               `sent` / `failed`. Never raises.

Like the refunds (TICKET-040), nothing that talks to the outside world runs
inside the booking's transaction: a slow or broken mail provider can't hold
row locks, and can't turn a successful booking change into an error.

Retrying (`manage.py send_pending_emails`, the Django Admin action) calls
send_email() again - it picks up `pending` and `failed` rows, and `sending`
rows that have been stuck for EMAIL_SENDING_STALE_MINUTES (e.g. the server
restarted mid-send). A row already `sent` is never sent again. The one case
that *can* produce a duplicate is a timeout after the provider actually
accepted the email (the outcome is unknown, so it's recorded as failed and a
retry sends it again) - a duplicate email is the lesser evil than none.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.permissions import is_app_admin
from bookings.models import Booking

from .models import BookingEmail

logger = logging.getLogger(__name__)

Kind = BookingEmail.Kind
Status = BookingEmail.Status

# An email only makes sense while the booking is still in the state it
# reports. Checked again right before sending, so a retry never sends e.g.
# "we've received your booking - pay within 30 minutes" for a booking that
# has since been confirmed or cancelled.
STILL_RELEVANT = {
    Kind.BOOKING_RECEIVED: Booking.Status.PENDING,
    Kind.BOOKING_CONFIRMED: Booking.Status.CONFIRMED,
    Kind.BOOKING_CANCELLED: Booking.Status.CANCELLED,
    Kind.ADMIN_NEW_BOOKING: Booking.Status.CONFIRMED,
}


def recipients_for(booking, kind):
    """Who gets `kind` for `booking`.

    - The owner alert: BOOKING_ALERT_EMAILS.
    - Guest emails: the guest's own address - except when the "guest" is an
      admin account (role admin, e.g. the demo admin booking a stay): an
      admin's login email isn't treated as a real inbox (the demo admin's is
      admin_demo@example.com), so their mail goes to BOOKING_ALERT_EMAILS,
      the owner's real address from the environment. With that list empty
      it falls back to the account's own email.
    """
    alert_list = list(settings.BOOKING_ALERT_EMAILS)
    if kind == Kind.ADMIN_NEW_BOOKING:
        return alert_list
    if alert_list and is_app_admin(booking.guest):
        return alert_list
    email = (booking.guest.email or "").strip()
    return [email] if email else []


def enqueue(booking, kind, reason=""):
    """Record `kind` for `booking` and send it once the current transaction
    commits (immediately when there's no transaction). Returns the new row,
    or None when nothing was recorded: no recipients (e.g. an account
    without an email, or no BOOKING_ALERT_EMAILS), or this booking already
    has this email (a repeated webhook, a double confirm)."""
    recipients = recipients_for(booking, kind)
    if not recipients:
        return None
    if BookingEmail.objects.filter(booking=booking, kind=kind).exists():
        return None
    try:
        with transaction.atomic():  # a savepoint: a lost race mustn't break the caller's transaction
            row = BookingEmail.objects.create(booking=booking, kind=kind, reason=reason,
                                              recipients=",".join(recipients))
    except IntegrityError:
        return None  # created by a simultaneous request - that one sends it
    transaction.on_commit(lambda: send_email_safely(row.pk))
    return row


# --- What each booking change sends (called by bookings/views.py and the
# payments webhook / stale-hold code, inside their transactions) ------------

Reason = BookingEmail.Reason


def booking_received(booking):
    """A new (pending) booking: "we've got it" to the guest - with Pay now
    and the hold's end time when payments are on."""
    return enqueue(booking, Kind.BOOKING_RECEIVED)


def booking_confirmed(booking):
    """pending -> confirmed (paid, or confirmed by an admin): the guest's
    confirmation + the owner's alert."""
    enqueue(booking, Kind.BOOKING_CONFIRMED)
    enqueue(booking, Kind.ADMIN_NEW_BOOKING)


def booking_cancelled(booking, reason):
    """-> cancelled, for any reason (see BookingEmail.Reason)."""
    return enqueue(booking, Kind.BOOKING_CANCELLED, reason=reason)


def reason_for_payment_status(payment_status):
    """Why a booking was released by the payments code, from the payment's
    new status (expired -> the time ran out, failed -> the payment failed)."""
    from payments.models import Payment

    return {
        Payment.Status.EXPIRED: Reason.PAYMENT_EXPIRED,
        Payment.Status.FAILED: Reason.PAYMENT_FAILED,
    }.get(payment_status, Reason.HOST)


def _stale(row, now):
    minutes = settings.EMAIL_SENDING_STALE_MINUTES
    return row.sending_started_at is None or row.sending_started_at <= now - timedelta(minutes=minutes)


def _claim(email_id, now):
    """Lock the row and move it to `sending` if it may be sent now. Returns
    the row if the caller should send it, else None."""
    with transaction.atomic():
        row = (BookingEmail.objects.select_for_update(of=("self",))
               .select_related("booking").filter(pk=email_id).first())
        if row is None or row.status in (Status.SENT, Status.SKIPPED):
            return None
        if row.status == Status.SENDING and not _stale(row, now):
            return None  # someone else is sending it right now
        if row.booking.status != STILL_RELEVANT[row.kind]:
            row.status = Status.SKIPPED
            row.last_error = f"Not sent: the booking is {row.booking.status} now."
            row.save(update_fields=["status", "last_error", "updated_at"])
            return None
        row.status = Status.SENDING
        row.attempts += 1
        row.sending_started_at = now
        row.save(update_fields=["status", "attempts", "sending_started_at", "updated_at"])
        return row


def _record(email_id, **fields):
    with transaction.atomic():
        row = BookingEmail.objects.select_for_update().get(pk=email_id)
        for name, value in fields.items():
            setattr(row, name, value)
        row.save(update_fields=[*fields, "updated_at"])
        return row


def send_email(email_id, now=None):
    """Send one outbox email if it's due. Never raises: a failure is
    recorded on the row (`failed` + last_error). Returns the row."""
    now = now or timezone.now()
    row = _claim(email_id, now)
    if row is None:
        return BookingEmail.objects.filter(pk=email_id).first()

    from .messages import build_message  # the templates (kept separate from the mechanics)

    try:
        message = build_message(row)
        message.send(fail_silently=False)
    except Exception as exc:  # any provider / template error - recorded, never raised
        refused = getattr(exc, "refused", False)
        log = logger.error if refused else logger.exception
        log("Couldn't send %s email for booking %s: %s", row.kind, row.booking_id, exc)
        return _record(email_id, status=Status.FAILED, last_error=str(exc)[:500] or exc.__class__.__name__)
    return _record(
        email_id,
        status=Status.SENT,
        sent_at=timezone.now(),
        last_error="",
        provider_message_id=str(getattr(message, "provider_message_id", "") or "")[:255],
    )


def send_email_safely(email_id):
    """send_email() for after-commit callbacks: even an unexpected error (e.g.
    the database went away) must not turn the caller's committed success into
    a 500. The row then stays pending/sending for a retry."""
    try:
        return send_email(email_id)
    except Exception:
        logger.exception("Couldn't send outbox email %s - left for a retry", email_id)
        return None


def due_for_retry(now=None, max_attempts=None):
    """Rows the retry command should try: pending, failed and stuck-sending,
    oldest first. `max_attempts` leaves out rows that already failed that
    often (an admin can still retry them by hand)."""
    now = now or timezone.now()
    stale_before = now - timedelta(minutes=settings.EMAIL_SENDING_STALE_MINUTES)
    rows = BookingEmail.objects.filter(status__in=[Status.PENDING, Status.FAILED]) | BookingEmail.objects.filter(
        status=Status.SENDING, sending_started_at__lte=stale_before)
    if max_attempts:
        rows = rows.filter(attempts__lt=max_attempts)
    return list(rows.order_by("created_at", "id").values_list("pk", flat=True))
