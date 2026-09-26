import stripe
from django.core.management.base import BaseCommand
from django.utils import timezone

from payments.models import Payment
from payments.services import sync_stale_hold
from payments.stripe_client import PaymentsDisabled


class Command(BaseCommand):
    help = (
        "Settle payment holds whose time ran out but whose Stripe webhook never "
        "arrived (TICKET-029): asks Stripe what really happened for each one, then "
        "confirms it (paid) or cancels it and frees the dates (not paid). Safe to run "
        "any time; bookings are also settled on their own when someone tries to book "
        "the same dates."
    )

    def handle(self, *args, **options):
        stale = Payment.objects.filter(
            status=Payment.Status.OPEN, expires_at__lte=timezone.now()
        ).values_list("booking_id", flat=True)
        changed = failed = 0
        for booking_id in list(stale):
            try:
                changed += sync_stale_hold(booking_id)
            except (stripe.StripeError, PaymentsDisabled) as exc:
                failed += 1
                self.stderr.write(f"Booking {booking_id}: couldn't ask Stripe ({exc.__class__.__name__})")
        self.stdout.write(self.style.SUCCESS(f"Settled {changed} stale hold(s); {failed} couldn't be checked."))
