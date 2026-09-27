import stripe
from django.core.management.base import BaseCommand

from bookings.models import Booking
from payments.models import Payment
from payments.refunds import RefundNotAllowed, refund_now, send_refund, sync_refund
from payments.stripe_client import PaymentsDisabled

Refund = Payment.RefundStatus


class Command(BaseCommand):
    help = (
        "Bring refunds up to date (TICKET-040): sends pending refunds that were never "
        "sent, asks Stripe about sent ones whose webhook never arrived, and retries "
        "failed ones (like the admin's Refund now - it can never refund twice). "
        "--backlog also refunds cancelled, paid bookings whose refund never started "
        "(e.g. cancelled before refunds existed). Safe to run any time."
    )

    def add_arguments(self, parser):
        parser.add_argument("--no-retry", action="store_true",
                            help="Don't retry failed refunds; only send and sync pending ones.")
        parser.add_argument("--backlog", action="store_true",
                            help="Also refund cancelled, paid bookings that have no refund yet.")

    def handle(self, *args, **options):
        counts = {"sent": 0, "synced": 0, "retried": 0, "backlog": 0, "errors": 0}

        pending = Payment.objects.filter(refund_status=Refund.PENDING)
        for booking_id in list(pending.filter(stripe_refund_id="").values_list("booking_id", flat=True)):
            payment = send_refund(booking_id)  # never raises
            counts["sent" if payment.refund_status == Refund.PENDING else "errors"] += 1
        for booking_id in list(pending.exclude(stripe_refund_id="").values_list("booking_id", flat=True)):
            try:
                counts["synced"] += sync_refund(booking_id)
            except (stripe.StripeError, PaymentsDisabled) as exc:
                counts["errors"] += 1
                self.stderr.write(f"Booking {booking_id}: couldn't ask Stripe ({exc.__class__.__name__})")

        todo = []
        if not options["no_retry"]:
            todo += [("retried", pk) for pk in Payment.objects.filter(refund_status=Refund.FAILED)
                     .values_list("booking_id", flat=True)]
        if options["backlog"]:
            todo += [("backlog", pk) for pk in Payment.objects.filter(
                refund_status=Refund.NONE, status=Payment.Status.PAID,
                booking__status=Booking.Status.CANCELLED,
            ).values_list("booking_id", flat=True)]
        for kind, booking_id in todo:
            try:
                payment = refund_now(booking_id)
            except RefundNotAllowed as exc:
                self.stderr.write(f"Booking {booking_id}: skipped - {exc.detail}")
                continue
            if payment.refund_status == Refund.FAILED:
                counts["errors"] += 1
                self.stderr.write(f"Booking {booking_id}: refund failed - {payment.refund_failure_reason}")
            else:
                counts[kind] += 1

        self.stdout.write(self.style.SUCCESS(
            "Sent {sent}, synced {synced}, retried {retried}, backlog {backlog}; {errors} problem(s).".format(**counts)
        ))
