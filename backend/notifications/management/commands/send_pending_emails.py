from django.core.management.base import BaseCommand

from notifications.models import BookingEmail
from notifications.outbox import due_for_retry, send_email

Status = BookingEmail.Status


class Command(BaseCommand):
    help = (
        "Send the booking emails that are still waiting (TICKET-030): pending ones "
        "(e.g. the server stopped before sending), failed ones (the provider was down "
        "or refused) and ones stuck in 'sending'. An email that was already sent is "
        "never sent again, and one whose booking has moved on is skipped. Safe to run "
        "any time (e.g. from a cron job)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--max-attempts", type=int, default=5,
                            help="Leave out emails that already failed this many times (default 5; 0 = no limit). "
                                 "They can still be retried from Django Admin.")
        parser.add_argument("--dry-run", action="store_true", help="Only list what would be sent.")

    def handle(self, *args, **options):
        ids = due_for_retry(max_attempts=options["max_attempts"] or None)
        if options["dry_run"]:
            for row in BookingEmail.objects.filter(pk__in=ids).order_by("created_at", "id"):
                self.stdout.write(f"#{row.pk} {row.kind} booking {row.booking_id} ({row.status}, "
                                  f"{row.attempts} attempts) -> {row.recipients}")
            self.stdout.write(f"{len(ids)} email(s) would be tried.")
            return

        counts = {Status.SENT: 0, Status.FAILED: 0, Status.SKIPPED: 0, "left": 0}
        for pk in ids:
            row = send_email(pk)  # never raises
            if row.status == Status.FAILED:
                self.stderr.write(f"#{row.pk} {row.kind} booking {row.booking_id}: failed - {row.last_error}")
            counts[row.status if row.status in counts else "left"] += 1
        self.stdout.write(
            f"Sent {counts[Status.SENT]}, failed {counts[Status.FAILED]}, skipped {counts[Status.SKIPPED]}"
            + (f", left alone {counts['left']}" if counts["left"] else "") + "."
        )
