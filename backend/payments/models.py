from decimal import Decimal

from django.db import models
from django.utils import timezone


class Payment(models.Model):
    """The Stripe Checkout payment for one Booking (TICKET-029).

    One per booking, ever: the Checkout Session is created with an
    idempotency key derived from the booking id, so a double click or a
    network retry gets the same session back instead of a second charge.
    A booking only exists here once its row has been committed (so it
    already passed the no-overlap exclusion constraint) - payment never
    starts for a booking that lost the race.

    The status is driven by Stripe's webhook, never by the browser coming
    back to the success page:

        open ──completed + paid──────────────▶ paid        (booking -> confirmed)
          │ └─completed, payment pending──▶ processing ─succeeded─▶ paid
          │                                          └─failed───▶ failed (booking -> cancelled)
          └─session expired unpaid─────────────▶ expired     (booking -> cancelled, dates freed)
    """

    class Status(models.TextChoices):
        OPEN = "open", "Awaiting payment"  # Checkout Session open, dates held
        PROCESSING = "processing", "Processing"  # paid by a delayed method (e.g. SEPA), not settled yet
        PAID = "paid", "Paid"
        EXPIRED = "expired", "Expired"  # session ran out unpaid
        FAILED = "failed", "Failed"  # delayed payment failed

    booking = models.OneToOneField(
        "bookings.Booking",
        on_delete=models.CASCADE,
        related_name="payment",
        help_text="CASCADE: follows the booking (and its guest) - Stripe keeps the real payment record either way.",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Booking.total_price at checkout time (a snapshot - what Stripe was asked to charge).",
    )
    currency = models.CharField(max_length=3, default="eur")
    stripe_checkout_session_id = models.CharField(max_length=255, unique=True)
    checkout_url = models.TextField(
        help_text="Stripe-hosted payment page; valid until expires_at, so 'Pay now' can reuse it.",
    )
    stripe_payment_intent_id = models.CharField(
        max_length=255,
        blank=True,
        help_text="Filled in from the webhook once the guest pays; TICKET-040 refunds against it.",
    )
    expires_at = models.DateTimeField(help_text="When the Checkout Session - and the date hold - ends.")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="payment_amount_positive"),
        ]

    def __str__(self):
        return f"Payment for booking #{self.booking_id}: {self.amount} {self.currency.upper()} ({self.status})"

    @property
    def amount_cents(self):
        """Stripe wants the smallest currency unit as an integer. amount has
        exactly 2 decimal places, so this is exact - no float rounding."""
        return self.to_cents(self.amount)

    def is_holding(self, now=None):
        """True while the guest can still pay and the dates are held for them."""
        return self.status == self.Status.OPEN and (now or timezone.now()) < self.expires_at

    @staticmethod
    def to_cents(amount: Decimal) -> int:
        """Euros (a 2-decimal Decimal, like Booking.total_price) -> integer cents."""
        return int((Decimal(amount) * 100).to_integral_value())


class StripeEvent(models.Model):
    """Every Stripe webhook event we've handled, keyed by Stripe's event id.

    Stripe delivers events *at least* once, so the same event can arrive
    twice. The webhook inserts this row in the same transaction as the
    booking/payment update it makes: a duplicate hits the primary key and
    is skipped, and if handling fails the whole transaction (this row
    included) rolls back, so Stripe's retry gets a clean second attempt.
    """

    event_id = models.CharField(max_length=255, primary_key=True)
    type = models.CharField(max_length=100)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self):
        return f"{self.event_id} ({self.type})"
