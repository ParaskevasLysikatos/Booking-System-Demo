from rest_framework import serializers

from bookings.models import Booking

from .models import Payment
from .stripe_client import payments_enabled


def payment_summary(booking, request=None):
    """The `payment` block in every booking response (null when the booking
    doesn't take online payment). Needs the booking's payment preloaded
    (select_related("payment")) to avoid a query per row."""
    try:
        payment = booking.payment
    except Payment.DoesNotExist:
        return None
    user = getattr(request, "user", None)
    return {
        "status": payment.status,
        "amount": serializers.DecimalField(max_digits=10, decimal_places=2).to_representation(payment.amount),
        "currency": payment.currency,
        "expires_at": serializers.DateTimeField().to_representation(payment.expires_at),
        "paid_at": serializers.DateTimeField().to_representation(payment.paid_at) if payment.paid_at else None,
        # Whether *the caller* can pay right now - only the booking's own guest,
        # while the booking is pending and the hold hasn't run out.
        "can_pay": bool(
            payments_enabled()
            and user is not None
            and booking.guest_id == user.pk
            and booking.status == Booking.Status.PENDING
            and payment.is_holding()
        ),
    }
