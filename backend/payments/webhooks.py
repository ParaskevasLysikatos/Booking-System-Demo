"""What each Stripe webhook event does to our data (TICKET-029 step 3).

This - not the browser coming back from Stripe - is what confirms a booking:
a guest can pay and then lose their connection before the success page
loads, and a success page can be opened by anyone. Only an event signed by
Stripe proves the money moved.

    checkout.session.completed, payment_status=paid  -> payment paid, booking confirmed
    checkout.session.completed, payment_status=unpaid -> payment processing (a delayed
                                                        method, e.g. SEPA; the hold stops
                                                        expiring, the dates stay held)
    checkout.session.async_payment_succeeded         -> payment paid, booking confirmed
    checkout.session.async_payment_failed            -> payment failed, booking cancelled
    checkout.session.expired                         -> payment expired, booking cancelled
                                                        (the dates are free again)

Every handler runs inside the caller's transaction, with the booking and
payment rows locked in the same order as the checkout endpoint (booking,
then payment), and is safe to run twice (it checks the current state
first) - on top of the StripeEvent de-duplication in the view.
"""
import logging

from django.utils import timezone

from bookings.models import Booking

from .models import Payment

logger = logging.getLogger(__name__)

HANDLED_EVENTS = {
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
}


def handle_event(event):
    session = event["data"]["object"]
    found = _lock_for_session(session.get("id"))
    if found is None:
        # Not one of ours: an attempt that was never shown to anyone, or -
        # since one Stripe sandbox serves both - a session made by the other
        # copy of the app (local vs Render). Nothing to do.
        logger.info("Ignoring %s for unknown Checkout Session %s", event["type"], session.get("id"))
        return
    booking, payment = found
    kind = event["type"]
    if kind == "checkout.session.completed":
        if session.get("payment_status") == "paid":
            _paid(booking, payment, session)
        else:
            _processing(payment, session)
    elif kind == "checkout.session.async_payment_succeeded":
        _paid(booking, payment, session)
    elif kind == "checkout.session.async_payment_failed":
        _release(booking, payment, Payment.Status.FAILED)
    elif kind == "checkout.session.expired":
        _release(booking, payment, Payment.Status.EXPIRED)


def _lock_for_session(session_id):
    if not session_id:
        return None
    booking_id = (
        Payment.objects.filter(stripe_checkout_session_id=session_id)
        .values_list("booking_id", flat=True)
        .first()
    )
    if booking_id is None:
        return None
    booking = Booking.objects.select_for_update(of=("self",)).get(pk=booking_id)
    payment = Payment.objects.select_for_update().get(booking=booking)
    return booking, payment


def _payment_intent_id(session):
    pi = session.get("payment_intent")
    if isinstance(pi, dict):  # expanded object
        pi = pi.get("id")
    return pi or ""


def _paid(booking, payment, session):
    if payment.status == Payment.Status.PAID:
        return  # already handled
    payment.status = Payment.Status.PAID
    payment.paid_at = timezone.now()
    payment.stripe_payment_intent_id = _payment_intent_id(session) or payment.stripe_payment_intent_id
    payment.save(update_fields=["status", "paid_at", "stripe_payment_intent_id", "updated_at"])

    amount, currency = session.get("amount_total"), (session.get("currency") or "").lower()
    if amount != payment.amount_cents or currency != payment.currency:
        # Can't happen - the amount is set server-side - but never confirm
        # a booking for a different amount than it costs.
        logger.error(
            "Booking %s: Stripe charged %s %s, expected %s %s - left pending for an admin",
            booking.pk, amount, currency, payment.amount_cents, payment.currency,
        )
        return
    if booking.status == Booking.Status.PENDING:
        booking.status = Booking.Status.CONFIRMED
        booking.save(update_fields=["status"])
    elif booking.status == Booking.Status.CANCELLED:
        # Paid for a booking that was cancelled meanwhile (e.g. while a
        # delayed payment was processing). The booking stays cancelled;
        # the money has to go back - that's TICKET-040's refund flow.
        logger.warning("Booking %s was paid after being cancelled - needs a refund (TICKET-040)", booking.pk)
    # CONFIRMED already (an admin confirmed it by hand): just recorded as paid.


def _processing(payment, session):
    if payment.status != Payment.Status.OPEN:
        return
    payment.status = Payment.Status.PROCESSING
    payment.stripe_payment_intent_id = _payment_intent_id(session) or payment.stripe_payment_intent_id
    payment.save(update_fields=["status", "stripe_payment_intent_id", "updated_at"])


def _release(booking, payment, new_status):
    """Payment didn't happen: record why, and free the dates if the booking
    was still waiting for it. A booking an admin already confirmed by hand
    is left alone - their decision wins."""
    if payment.status in (Payment.Status.PAID, Payment.Status.EXPIRED, Payment.Status.FAILED):
        return
    payment.status = new_status
    payment.save(update_fields=["status", "updated_at"])
    if booking.status == Booking.Status.PENDING:
        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=["status"])
