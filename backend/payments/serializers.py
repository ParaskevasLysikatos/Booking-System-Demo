from rest_framework import serializers

from bookings.models import Booking

from .models import Payment
from .refunds import can_refund_now
from .stripe_client import payments_enabled


def refund_summary(payment, is_admin=False):
    if payment.refund_status == Payment.RefundStatus.NONE:
        return None
    dt = serializers.DateTimeField()
    summary = {
        "status": payment.refund_status,
        "amount": serializers.DecimalField(max_digits=10, decimal_places=2).to_representation(payment.refund_amount)
        if payment.refund_amount is not None else None,
        "requested_at": dt.to_representation(payment.refund_requested_at) if payment.refund_requested_at else None,
        "refunded_at": dt.to_representation(payment.refunded_at) if payment.refunded_at else None,
    }
    if is_admin:
        # Why it failed is for the host to act on ("Refund now"); guests just
        # see that the host is arranging it.
        summary["failure_reason"] = payment.refund_failure_reason or None
    return summary


def payment_summary(booking, request=None, is_admin=False):
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
        "refund": refund_summary(payment, is_admin),  # TICKET-040; null = no refund
        # Admins only: whether "Refund now" is offered (cancelled + paid, and
        # the refund never started, failed, or was never sent).
        "can_refund": bool(is_admin and can_refund_now(booking, payment)),
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
