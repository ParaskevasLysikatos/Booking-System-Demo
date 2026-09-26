"""Checkout logic (TICKET-029 step 2).

start_hold()     - called inside the booking-creation transaction: creates the
                   `open` Payment that holds the dates while the guest pays.
start_checkout() - POST /api/bookings/{id}/checkout/: returns the booking's
                   Stripe Checkout page, creating the session the first time.
sync_stale_hold() / release_stale_holds()
                 - (step 4) a hold whose time ran out but whose "expired"
                   webhook never arrived: ask Stripe what really happened
                   before touching it, never guess.
close_checkout_for_status_change()
                 - (step 4) before a booking is cancelled or confirmed by
                   hand, close its open payment page at Stripe so it can't
                   take money any more.

The Stripe call is made *outside* any database transaction, so no row lock is
held while waiting on the network:

  1. lock the booking + payment, check it's payable, and fix the exact
     request (params + idempotency key) from stored values only; commit
  2. call Stripe
  3. lock again and record the session - unless the booking was cancelled in
     the meantime, in which case the new session is expired straight away

Because the request in (1) depends only on stored values, repeating it (a
double click, a retry after a lost response, the SDK's own network retries)
sends Stripe the identical request with the same idempotency key, and Stripe
answers with the session it already created instead of making a second one.
"""
import logging
from datetime import datetime, timedelta, timezone as dt_timezone

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from bookings.models import Booking

from .models import Payment
from .stripe_client import PaymentsDisabled, get_client
from .webhooks import apply_session_state

logger = logging.getLogger(__name__)

# Stripe only accepts expires_at 30 min .. 24 h after the session is created.
STRIPE_MIN_SESSION = timedelta(minutes=30)
STRIPE_MAX_SESSION = timedelta(hours=24)
# Extra minutes on top of the hold, so a first attempt that failed can still
# be retried with the *identical* request (same expires_at) for a little
# while and still be >= 30 minutes away when it reaches Stripe.
RETRY_SLACK = timedelta(minutes=2)
# Tags our sessions in the Stripe Dashboard (fixed 8-letter suffix, per
# Stripe's integration_identifier guidance).
INTEGRATION_IDENTIFIER = "booking-demo-checkout-qhzrnvtb"


class CheckoutError(Exception):
    def __init__(self, detail, code, http_status=409):
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.http_status = http_status


def hold_expiry(now=None):
    now = now or timezone.now()
    hold = timedelta(minutes=settings.STRIPE_CHECKOUT_HOLD_MINUTES) + RETRY_SLACK
    return now + min(hold, STRIPE_MAX_SESSION - timedelta(minutes=1))


def start_hold(booking):
    """Create the `open` Payment for a booking that was just inserted.
    Must run in the same transaction as the booking insert."""
    return Payment.objects.create(
        booking=booking,
        amount=booking.total_price,
        currency=settings.PAYMENTS_CURRENCY,
        expires_at=hold_expiry(),
    )


def idempotency_key(payment):
    return f"booking-{payment.booking_id}-checkout-{payment.checkout_attempt}"


def session_params(booking, payment):
    """Built only from stored values - see the module docstring. Deliberately
    no payment_method_types: Stripe's dynamic payment methods decide what to
    offer (managed in the Dashboard)."""
    prop = booking.property
    nights = booking.get_nights()
    guests = booking.guests
    params = {
        "mode": "payment",
        "line_items": [{
            "quantity": 1,
            "price_data": {
                "currency": payment.currency,
                "unit_amount": payment.amount_cents,
                "product_data": {
                    "name": f"{prop.title} - {nights} night{'s' if nights != 1 else ''}",
                    "description": (
                        f"{booking.check_in:%a %d %b %Y} to {booking.check_out:%a %d %b %Y}, "
                        f"{guests} guest{'s' if guests != 1 else ''}, {prop.location}"
                    ),
                },
            },
        }],
        "client_reference_id": str(booking.pk),
        "metadata": {"booking_id": str(booking.pk), "payment_id": str(payment.pk)},
        "payment_intent_data": {
            "description": f"Booking #{booking.pk}",
            "metadata": {"booking_id": str(booking.pk)},
        },
        "expires_at": int(payment.expires_at.timestamp()),
        "success_url": f"{settings.FRONTEND_URL}/bookings/{booking.pk}/payment?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.FRONTEND_URL}/bookings/{booking.pk}/payment?cancelled=1",
        "integration_identifier": INTEGRATION_IDENTIFIER,
        # Always charge in euros: no Adaptive Pricing (local-currency
        # conversion) whatever the Dashboard default is, so the amount and
        # currency the webhook checks are exactly what we asked for.
        "adaptive_pricing": {"enabled": False},
    }
    if booking.guest.email:
        params["customer_email"] = booking.guest.email
    return params


def check_payable(booking, payment, now=None):
    if payment is None:
        raise CheckoutError("This booking doesn't take online payment.", "payment_not_required")
    if booking.status == Booking.Status.CONFIRMED:
        raise CheckoutError("This booking is already confirmed.", "already_confirmed")
    if booking.status == Booking.Status.CANCELLED:
        raise CheckoutError("This booking was cancelled.", "booking_cancelled")
    if payment.status in (Payment.Status.PAID, Payment.Status.PROCESSING):
        raise CheckoutError("This booking has already been paid.", "already_paid")
    if not payment.is_holding(now):
        raise CheckoutError(
            "The time to pay for this booking has run out, so the dates were released. "
            "Please book again.",
            "payment_window_closed",
        )


def _locked(booking_id):
    booking = (
        Booking.objects.select_for_update(of=("self",))
        .select_related("property", "guest")
        .get(pk=booking_id)
    )
    payment = Payment.objects.select_for_update().filter(booking=booking).first()
    return booking, payment


def start_checkout(booking_id):
    """Return the booking's Payment with a usable checkout_url, creating the
    Stripe Checkout Session if there isn't one yet. Raises CheckoutError."""
    # A hold that ran out without its webhook: find out what really happened
    # first (the guest may even have paid at the last second), so the answer
    # below is the true one - "already confirmed" rather than "time ran out".
    try:
        sync_stale_hold(booking_id)
    except (stripe.StripeError, PaymentsDisabled):
        logger.warning("Couldn't check stale hold of booking %s with Stripe", booking_id, exc_info=True)
    # 1) Decide - under lock - exactly what to send.
    with transaction.atomic():
        booking, payment = _locked(booking_id)
        now = timezone.now()
        check_payable(booking, payment, now)
        if payment.stripe_checkout_session_id:
            return payment  # "Pay now": the existing page is still valid
        if payment.expires_at - now < STRIPE_MIN_SESSION + timedelta(seconds=30):
            # An earlier attempt never produced a session, and repeating its
            # request now would be refused (expires_at must be >= 30 min away).
            # Start a fresh attempt: new key, new expiry. The earlier attempt
            # - if Stripe did create it - was never shown to anyone, so it
            # can't be paid, and it expires on its own.
            payment.checkout_attempt += 1
            payment.expires_at = hold_expiry(now)
            payment.save(update_fields=["checkout_attempt", "expires_at", "updated_at"])
        attempt = payment.checkout_attempt
        params = session_params(booking, payment)
        key = idempotency_key(payment)

    # 2) Ask Stripe (no DB locks held).
    try:
        session = get_client().v1.checkout.sessions.create(
            params=params, options={"idempotency_key": key}
        )
    except PaymentsDisabled:
        raise CheckoutError("Online payment is switched off right now.", "payments_disabled", 503)
    except stripe.IdempotencyError:
        # The same request is still being processed (a parallel double click).
        raise CheckoutError(
            "Your payment page is still being prepared. Please try again in a moment.",
            "checkout_in_progress",
        )
    except stripe.StripeError:
        logger.exception("Stripe Checkout Session create failed for booking %s", booking_id)
        raise CheckoutError(
            "We couldn't reach the payment provider. Please try again.",
            "payment_provider_error",
            502,
        )

    # 3) Record it.
    with transaction.atomic():
        booking, payment = _locked(booking_id)
        if not payment.stripe_checkout_session_id and payment.checkout_attempt == attempt:
            payment.stripe_checkout_session_id = session.id
            payment.checkout_url = session.url
            payment.expires_at = datetime.fromtimestamp(session.expires_at, tz=dt_timezone.utc)
            payment.save(update_fields=[
                "stripe_checkout_session_id", "checkout_url", "expires_at", "updated_at",
            ])
        cancelled = booking.status == Booking.Status.CANCELLED

    if cancelled:
        # Cancelled while we were talking to Stripe: nobody has seen this
        # page yet - close it so it can never be paid.
        expire_session_quietly(session.id)
        raise CheckoutError("This booking was cancelled.", "booking_cancelled")
    if payment.stripe_checkout_session_id != session.id:
        # A parallel request stored a different session first; keep that one.
        expire_session_quietly(session.id)
    return payment


def expire_session_quietly(session_id):
    try:
        get_client().v1.checkout.sessions.expire(session_id)
    except (stripe.StripeError, PaymentsDisabled):
        # Best effort: it expires on its own anyway, and the webhook ignores
        # sessions that aren't the booking's recorded one.
        logger.warning("Couldn't expire Stripe Checkout Session %s", session_id, exc_info=True)


# --------------------------------------------------------------------------
# Step 4: stale holds, and closing the payment page before a status change
# --------------------------------------------------------------------------

def fetch_closed_session(session_id):
    """Make sure a Checkout Session can't take money any more, and return its
    final state (as a plain dict). An open session is expired; one that is
    already complete or expired can't be, so it's fetched instead."""
    client = get_client()
    try:
        session = client.v1.checkout.sessions.expire(session_id)
    except stripe.InvalidRequestError:
        session = client.v1.checkout.sessions.retrieve(session_id)
    return session.to_dict()


def sync_stale_hold(booking_id):
    """Settle a hold that is still `open` although its time has run out -
    i.e. the "expired" (or "completed") webhook never reached us.

    Never guesses: if the guest went to checkout, Stripe is asked first, and
    what it says is applied exactly as the webhook would have (paid ->
    confirmed, expired -> cancelled and the dates freed). A hold that never
    got a Checkout Session can't have been paid, so it's released directly.
    Raises stripe.StripeError / PaymentsDisabled if Stripe can't be asked -
    then nothing is changed. Returns True if it changed anything.
    """
    payment = Payment.objects.filter(booking_id=booking_id).first()
    if payment is None or payment.status != Payment.Status.OPEN or payment.is_holding():
        return False
    session = None
    if payment.stripe_checkout_session_id:
        session = fetch_closed_session(payment.stripe_checkout_session_id)  # no DB lock held
    with transaction.atomic():
        booking, payment = _locked(booking_id)
        if payment.status != Payment.Status.OPEN:
            return False  # the webhook got there in the meantime
        if session is not None:
            apply_session_state(booking, payment, session)
        else:
            _release_unpaid(booking, payment, Payment.Status.EXPIRED)
    return True


def release_stale_holds(prop, check_in, check_out, limit=5):
    """Before booking these dates: settle expired holds that block them, so a
    missed webhook doesn't keep dates blocked. If Stripe can't be reached the
    hold is left alone and the normal overlap check answers 409."""
    stale = (
        Booking.objects.overlapping(prop, check_in, check_out)
        .filter(status=Booking.Status.PENDING, payment__status=Payment.Status.OPEN,
                payment__expires_at__lte=timezone.now())
        .values_list("pk", flat=True)[:limit]
    )
    for booking_id in list(stale):
        try:
            sync_stale_hold(booking_id)
        except (stripe.StripeError, PaymentsDisabled):
            logger.warning("Couldn't check stale hold of booking %s with Stripe", booking_id, exc_info=True)


def _release_unpaid(booking, payment, payment_status):
    payment.status = payment_status
    payment.save(update_fields=["status", "updated_at"])
    if booking.status == Booking.Status.PENDING:
        booking.status = Booking.Status.CANCELLED
        booking.save(update_fields=["status"])


def close_checkout_for_status_change(booking_id):
    """Call before cancelling a booking or confirming it by hand (outside any
    transaction). Makes sure its payment page can't take money any more.

    Returns the Checkout Session id it closed (or None if there was nothing
    to close). Raises CheckoutError when the change must not go ahead:
      - the guest's payment just went through (the booking is now confirmed)
      - a delayed payment is still processing at the bank
      - Stripe can't be reached (then the page might still take money)
    """
    payment = Payment.objects.filter(booking_id=booking_id).first()
    if payment is None:
        return None
    if payment.status == Payment.Status.PROCESSING:
        raise CheckoutError(
            "A payment for this booking is still being processed by the bank. "
            "Please try again once it has gone through or failed.",
            "payment_processing",
        )
    if payment.status != Payment.Status.OPEN or not payment.stripe_checkout_session_id:
        return None
    session_id = payment.stripe_checkout_session_id
    try:
        session = fetch_closed_session(session_id)
    except PaymentsDisabled:
        # Payments were switched off after this page was made: we can't reach
        # Stripe at all, so there's nothing we can close. Go ahead.
        logger.warning("Payments are off; couldn't close Checkout Session %s", session_id)
        return session_id
    except stripe.StripeError:
        logger.exception("Couldn't close Checkout Session %s", session_id)
        raise CheckoutError(
            "We couldn't reach the payment provider to close this booking's payment page. "
            "Please try again.",
            "payment_provider_error",
            502,
        )
    if session.get("status") == "complete":
        # Too late to close: the guest paid (or started a delayed payment)
        # a moment ago. Record it now instead of waiting for the webhook.
        with transaction.atomic():
            booking, payment = _locked(booking_id)
            apply_session_state(booking, payment, session)
        if session.get("payment_status") == "paid":
            raise CheckoutError(
                "The payment for this booking has just gone through, so it's now confirmed. "
                "Please refresh.",
                "payment_completed",
            )
        raise CheckoutError(
            "A payment for this booking is now being processed by the bank. "
            "Please try again once it has gone through or failed.",
            "payment_processing",
        )
    return session_id
