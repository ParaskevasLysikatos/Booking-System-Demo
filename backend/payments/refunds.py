"""Refunds on cancellation (TICKET-040).

The rule: cancelling a *paid* booking always refunds the full amount -
guests can only cancel before the 48h deadline (TICKET-015), admins any
time. Money that arrives for a booking that was already cancelled is
refunded the same way.

Two halves, like checkout:

  request_refund(payment)  - inside the transaction that cancels the booking
                             (row locked): records the refund as `pending`.
                             The cancellation never waits on Stripe and is
                             never rolled back because of it.
  send_refund(booking_id)  - after that transaction has committed, with no
                             DB lock held while talking to Stripe: creates the
                             Stripe Refund with the idempotency key
                             "booking-<id>-refund-<attempt>".

Stripe's answer to the request is *not* taken as "refunded": the webhook
(`refund.updated` / `refund.failed` / `charge.refunded`, handle_refund_event)
confirms it, or `manage.py sync_refunds` asks Stripe when a webhook was missed.
A refund that couldn't be sent is marked `failed` - an admin can retry it
("Refund now") and the retry can never refund twice:

  - outcome unknown (Stripe unreachable, a 5xx, 409, 429) -> same attempt
    number, so the retry repeats the identical request with the same key (if
    Stripe did create the refund the first time, it just returns it);
  - Stripe refused the request (a 4xx, e.g. missing permission, or an agent
    key waiting for human approval) -> attempt + 1: nothing was created, and
    Stripe would only replay its stored refusal for the old key;
  - Stripe created the refund but reports it `failed` (e.g. the card was
    closed) -> attempt + 1, a genuinely new refund next time.
  Either way a *full* refund can only ever succeed once per payment at Stripe.
"""
import logging
from decimal import Decimal

import stripe
from django.db import transaction
from django.utils import timezone

from bookings.models import Booking

from .models import Payment
from .stripe_client import PaymentsDisabled, get_client

logger = logging.getLogger(__name__)

Refund = Payment.RefundStatus


def refund_key(payment):
    return f"booking-{payment.booking_id}-refund-{payment.refund_attempt}"


def request_refund(payment, now=None):
    """Mark a paid payment's refund as pending. Call with the payment row
    locked, in the transaction that cancels the booking. Returns True if a
    refund now needs sending (then call send_refund() after commit)."""
    if payment.status != Payment.Status.PAID:
        return False  # nothing was charged
    if payment.refund_status in (Refund.PENDING, Refund.REFUNDED):
        return False  # already on its way / done - never twice
    payment.refund_status = Refund.PENDING
    payment.refund_amount = payment.amount  # always the full amount
    payment.refund_requested_at = now or timezone.now()
    payment.refund_failure_reason = ""
    payment.stripe_refund_id = ""  # a previous, Stripe-failed attempt's id isn't this one
    payment.save(update_fields=[
        "refund_status", "refund_amount", "refund_requested_at",
        "refund_failure_reason", "stripe_refund_id", "updated_at",
    ])
    return True


def refund_params(payment):
    """Built only from stored values, so any repeat is the identical request.
    No `amount`: Stripe refunds the whole PaymentIntent."""
    return {
        "payment_intent": payment.stripe_payment_intent_id,
        "reason": "requested_by_customer",
        "metadata": {
            "booking_id": str(payment.booking_id),
            "payment_id": str(payment.pk),
            # lets a webhook recognise this refund before its id is stored
            "refund_attempt": str(payment.refund_attempt),
        },
    }


def _locked(booking_id):
    """Lock the booking, then its payment (None if it has none) - the same
    lock order as checkout and the webhook."""
    booking = Booking.objects.select_for_update(of=("self",)).get(pk=booking_id)
    return booking, Payment.objects.select_for_update().filter(booking_id=booking_id).first()


def _locked_payment(booking_id):
    return _locked(booking_id)[1]


def _fail(booking_id, reason, next_attempt=False):
    with transaction.atomic():
        payment = _locked_payment(booking_id)
        if payment.refund_status != Refund.PENDING:
            return payment  # the webhook settled it meanwhile
        payment.refund_status = Refund.FAILED
        payment.refund_failure_reason = reason[:255]
        fields = ["refund_status", "refund_failure_reason", "updated_at"]
        if next_attempt:
            payment.refund_attempt += 1
            fields.append("refund_attempt")
        payment.save(update_fields=fields)
        return payment


def _refused(exc):
    """A 4xx answer means Stripe rejected the request - no refund was made,
    and Stripe stores that answer under the idempotency key, so a retry needs
    the next attempt number. Unknown outcomes (5xx, 409 "request in
    progress", 429 rate limit) keep the same key so a retry can never refund
    twice."""
    status = getattr(exc, "http_status", None)
    return status is not None and 400 <= status < 500 and status not in (409, 429)


def send_refund(booking_id):
    """Ask Stripe to refund a `pending` refund that hasn't been sent yet.
    Never raises - problems are recorded on the payment as `failed`."""
    with transaction.atomic():
        payment = _locked_payment(booking_id)
        if payment.refund_status != Refund.PENDING or payment.stripe_refund_id:
            return payment  # nothing to send, or already sent (the webhook will settle it)
        if not payment.stripe_payment_intent_id:
            reason = "No Stripe payment is recorded for this booking."
            payment = None
        else:
            reason = None
            params, key = refund_params(payment), refund_key(payment)
    if reason:
        return _fail(booking_id, reason)

    try:
        refund = get_client().v1.refunds.create(params=params, options={"idempotency_key": key})
    except PaymentsDisabled:
        return _fail(booking_id, "Online payments are switched off, so Stripe can't be reached.")
    except stripe.PermissionError as exc:
        # Stripe refused: no refund exists, and Stripe would replay this same
        # answer for the same idempotency key - so the next try uses a new one.
        if getattr(exc, "code", None) == "approval_required":
            logger.error("Stripe is holding the refund for booking %s for human approval (agent key)", booking_id)
            reason = ("Stripe is holding this refund for human approval - the Stripe key is an agent key. "
                      "Use a normal restricted key (or approve it in the Stripe Dashboard)")
        else:
            logger.error("Stripe key may not create refunds (booking %s)", booking_id)
            reason = "The Stripe key isn't allowed to create refunds (it needs 'Charges and Refunds: Write')"
        return _fail(booking_id, reason, next_attempt=True)
    except stripe.APIConnectionError:
        # We don't know if Stripe got it: the retry must repeat the same key.
        logger.exception("Couldn't reach Stripe to refund booking %s", booking_id)
        return _fail(booking_id, "Couldn't reach Stripe")
    except stripe.StripeError as exc:
        if _refused(exc):  # a clear answer from Stripe - no traceback needed
            logger.error("Stripe refused the refund for booking %s: %s", booking_id, exc)
        else:
            logger.exception("Stripe error while refunding booking %s", booking_id)
        # Admin-only text (guests just see "the host is arranging your refund").
        return _fail(booking_id, (getattr(exc, "user_message", None) or "Stripe refused the refund").rstrip("."),
                     next_attempt=_refused(exc))

    with transaction.atomic():
        payment = _locked_payment(booking_id)
        if payment.refund_status not in (Refund.PENDING, Refund.REFUNDED) or payment.stripe_refund_id:
            return payment  # settled by the webhook in the meantime
        payment.stripe_refund_id = refund.id  # (also when charge.refunded already marked it refunded)
        payment.save(update_fields=["stripe_refund_id", "updated_at"])
        if payment.refund_status == Refund.REFUNDED:
            return payment
    if refund.status in ("failed", "canceled"):
        return _fail(booking_id, getattr(refund, "failure_reason", None) or f"Stripe reported the refund as {refund.status}.",
                     next_attempt=True)
    return payment  # pending / succeeded: the webhook marks it refunded


def send_refund_after_cancel(booking_id):
    """send_refund() for callers whose own work is already committed (the
    cancel, the webhook): even an unexpected error must not turn their
    success into a 500. The refund then stays `pending` without a Stripe id
    - "Refund now" or `manage.py sync_refunds` sends it."""
    try:
        return send_refund(booking_id)
    except Exception:
        logger.exception("Couldn't send the refund for booking %s - left pending for a retry", booking_id)
        return None


def refund_after_commit(booking_id):
    """For code already inside a transaction (e.g. the webhook): send the
    refund once that transaction has committed."""
    transaction.on_commit(lambda: send_refund_after_cancel(booking_id))


# --------------------------------------------------------------------------
# Step 2: "Refund now" (admin), and what Stripe tells us about refunds
# (webhook events, or fetched by `manage.py sync_refunds`).
# --------------------------------------------------------------------------

class RefundNotAllowed(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code, self.detail = code, detail


def refund_blocker(booking, payment):
    """Why "Refund now" can't run for this booking - (code, message) - or
    None if it can. Allowed for a cancelled, paid booking whose refund was
    never started (e.g. cancelled before refunds existed), failed, or is
    pending but was never sent (the send was interrupted)."""
    if payment is None or payment.status != Payment.Status.PAID:
        return "not_paid", "This booking wasn't paid online, so there's nothing to refund."
    if booking.status != Booking.Status.CANCELLED:
        return "not_cancelled", "Only cancelled bookings are refunded - cancel the booking first."
    if payment.refund_status == Refund.REFUNDED:
        return "already_refunded", "This booking has already been refunded."
    if payment.refund_status == Refund.PENDING and payment.stripe_refund_id:
        return "refund_in_progress", "A refund is already on its way - Stripe will confirm it."
    return None


def can_refund_now(booking, payment):
    return refund_blocker(booking, payment) is None


def refund_now(booking_id):
    """Start (or retry) the refund of a cancelled, paid booking. Raises
    RefundNotAllowed; otherwise returns the payment after sending - its
    refund is then `pending`, or `failed` again with a new reason. Retrying
    reuses the idempotency key unless Stripe itself failed the last refund,
    so it can never refund twice."""
    with transaction.atomic():
        booking, payment = _locked(booking_id)
        problem = refund_blocker(booking, payment)
        if problem:
            raise RefundNotAllowed(*problem)
        if payment.refund_status != Refund.PENDING:
            request_refund(payment)
    return send_refund(booking_id)


def _amount(cents, fallback):
    if cents is None:
        return fallback
    return (Decimal(cents) / 100).quantize(Decimal("0.01"))


def _id(value):
    if isinstance(value, dict):  # expanded object
        value = value.get("id")
    return value or ""


def _is_ours(payment, refund):
    """Is this Stripe refund the one this app sent for the current attempt?"""
    if payment.stripe_refund_id:
        return refund.get("id") == payment.stripe_refund_id
    meta = refund.get("metadata") or {}
    return (
        payment.refund_status in (Refund.PENDING, Refund.REFUNDED)
        and meta.get("payment_id") == str(payment.pk)
        and meta.get("refund_attempt") == str(payment.refund_attempt)
    )


def _mark_refunded(payment, amount_cents=None, refund_id=""):
    if payment.refund_status == Refund.REFUNDED:
        return False
    now = timezone.now()
    payment.refund_status = Refund.REFUNDED
    payment.refund_amount = _amount(amount_cents, payment.amount)
    payment.refund_requested_at = payment.refund_requested_at or now
    payment.refunded_at = now
    payment.refund_failure_reason = ""
    if refund_id and not payment.stripe_refund_id:
        payment.stripe_refund_id = refund_id
    payment.save(update_fields=[
        "refund_status", "refund_amount", "refund_requested_at", "refunded_at",
        "refund_failure_reason", "stripe_refund_id", "updated_at",
    ])
    return True


def _mark_failed_by_stripe(payment, refund):
    """Stripe created the refund but it failed (possibly even after it had
    succeeded, e.g. the card was closed). The next try must be a new refund,
    so the attempt goes up."""
    payment.refund_status = Refund.FAILED
    payment.refund_failure_reason = (
        refund.get("failure_reason") or f"Stripe reported the refund as {refund.get('status')}."
    )[:255]
    payment.refunded_at = None
    payment.refund_attempt += 1
    if refund.get("id") and not payment.stripe_refund_id:
        payment.stripe_refund_id = refund["id"]
    payment.save(update_fields=[
        "refund_status", "refund_failure_reason", "refunded_at", "refund_attempt",
        "stripe_refund_id", "updated_at",
    ])


def apply_refund_state(booking, payment, refund):
    """A Refund object (a plain dict) from Stripe - via `refund.updated` /
    `refund.failed`, or fetched - applied to our locked rows. Safe to run
    twice. Returns True if anything changed."""
    status = refund.get("status")
    if not _is_ours(payment, refund):
        if status in ("failed", "canceled") and payment.refund_status == Refund.REFUNDED \
                and not payment.stripe_refund_id:
            # A refund made outside the app (Stripe Dashboard), which we
            # recorded from charge.refunded, failed after all.
            _mark_failed_by_stripe(payment, refund)
            return True
        logger.info("Ignoring refund %s for booking %s (not the current one)", refund.get("id"), booking.pk)
        return False
    if status == "succeeded":
        return _mark_refunded(payment, refund.get("amount"), refund.get("id", ""))
    if status in ("failed", "canceled"):
        if payment.refund_status not in (Refund.PENDING, Refund.REFUNDED):
            return False  # already recorded as failed
        _mark_failed_by_stripe(payment, refund)
        return True
    if not payment.stripe_refund_id and refund.get("id"):
        payment.stripe_refund_id = refund["id"]
        payment.save(update_fields=["stripe_refund_id", "updated_at"])
    return False  # pending / requires_action: not settled yet


def apply_charge_refunded(booking, payment, charge):
    """`charge.refunded`: sent for every refund of the charge - ours, and
    ones made by hand in the Stripe Dashboard."""
    if not charge.get("refunded"):
        logger.warning(
            "Booking %s: a partial refund of %s cents was made at Stripe - not tracked here "
            "(this app only makes full refunds)", booking.pk, charge.get("amount_refunded"),
        )
        return False
    if payment.refund_status == Refund.FAILED and payment.stripe_refund_id:
        # Stripe already told us our refund failed; this event is older
        # than that (events can arrive out of order).
        return False
    was = payment.refund_status
    changed = _mark_refunded(payment, charge.get("amount_refunded"))
    if changed and was in (Refund.NONE, Refund.FAILED):
        logger.warning("Booking %s was refunded outside the app (Stripe Dashboard) - recorded", booking.pk)
        if booking.status != Booking.Status.CANCELLED:
            logger.warning("Booking %s is refunded but still %s - cancel it if the stay is off",
                           booking.pk, booking.status)
    return changed


REFUND_EVENTS = {"refund.updated", "refund.failed", "charge.refunded"}


def lock_for_payment_intent(payment_intent_id):
    if not payment_intent_id:
        return None
    booking_id = (
        Payment.objects.filter(stripe_payment_intent_id=payment_intent_id)
        .values_list("booking_id", flat=True)
        .first()
    )
    if booking_id is None:
        return None
    return _locked(booking_id)


def handle_refund_event(event):
    """Runs inside the webhook's transaction (see payments/views.py)."""
    obj = event["data"]["object"]
    found = lock_for_payment_intent(_id(obj.get("payment_intent")))
    if found is None:
        # Not one of ours - e.g. a payment made by the other copy of the app
        # (local vs Render share one Stripe sandbox).
        logger.info("Ignoring %s for unknown PaymentIntent %s", event["type"], _id(obj.get("payment_intent")))
        return
    booking, payment = found
    if event["type"] == "charge.refunded":
        apply_charge_refunded(booking, payment, obj)
    else:
        apply_refund_state(booking, payment, obj)


def sync_refund(booking_id):
    """For a refund that was sent but never confirmed (a missed webhook):
    ask Stripe for its current state and apply it. Raises StripeError /
    PaymentsDisabled. Returns True if anything changed."""
    with transaction.atomic():
        payment = _locked_payment(booking_id)
        if payment is None or payment.refund_status != Refund.PENDING or not payment.stripe_refund_id:
            return False
        refund_id = payment.stripe_refund_id
    refund = get_client().v1.refunds.retrieve(refund_id).to_dict()
    with transaction.atomic():
        booking, payment = _locked(booking_id)
        return apply_refund_state(booking, payment, refund)
