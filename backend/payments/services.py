"""Checkout logic (TICKET-029 step 2).

start_hold()     - called inside the booking-creation transaction: creates the
                   `open` Payment that holds the dates while the guest pays.
start_checkout() - POST /api/bookings/{id}/checkout/: returns the booking's
                   Stripe Checkout page, creating the session the first time.

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
