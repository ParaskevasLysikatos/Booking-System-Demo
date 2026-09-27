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
(`refund.updated` / `refund.failed` / `charge.refunded`, step 2) confirms it.
A refund that couldn't be sent is marked `failed` - an admin can retry it
("Refund now") and the retry can never refund twice:

  - Stripe unreachable / refused the request -> same attempt number, so the
    retry repeats the identical request with the same key (if Stripe did
    create the refund the first time, it just returns it);
  - Stripe created the refund but reports it `failed` (e.g. the card was
    closed) -> attempt + 1, a genuinely new refund next time.
"""
import logging

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
        "metadata": {"booking_id": str(payment.booking_id), "payment_id": str(payment.pk)},
    }


def _locked_payment(booking_id):
    Booking.objects.select_for_update(of=("self",)).get(pk=booking_id)  # same lock order as checkout/webhook
    return Payment.objects.select_for_update().get(booking_id=booking_id)


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
    except stripe.PermissionError:
        logger.error("Stripe key may not create refunds (booking %s)", booking_id)
        return _fail(booking_id, "The Stripe key isn't allowed to create refunds "
                                 "(it needs 'Charges and Refunds: Write').")
    except stripe.APIConnectionError:
        logger.exception("Couldn't reach Stripe to refund booking %s", booking_id)
        return _fail(booking_id, "Couldn't reach Stripe.")
    except stripe.StripeError as exc:
        logger.exception("Stripe refused the refund for booking %s", booking_id)
        # Admin-only text (guests just see "the host is arranging your refund").
        return _fail(booking_id, getattr(exc, "user_message", None) or "Stripe refused the refund.")

    with transaction.atomic():
        payment = _locked_payment(booking_id)
        if payment.refund_status != Refund.PENDING:
            return payment  # settled by the webhook in the meantime
        payment.stripe_refund_id = refund.id
        payment.save(update_fields=["stripe_refund_id", "updated_at"])
    if refund.status in ("failed", "canceled"):
        return _fail(booking_id, getattr(refund, "failure_reason", None) or f"Stripe reported the refund as {refund.status}.",
                     next_attempt=True)
    return payment  # pending / succeeded: the webhook marks it refunded


def refund_after_commit(booking_id):
    """For code already inside a transaction (e.g. the webhook): send the
    refund once that transaction has committed."""
    transaction.on_commit(lambda: send_refund(booking_id))
