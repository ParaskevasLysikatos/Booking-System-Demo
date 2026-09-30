from django.db import models


class BookingEmail(models.Model):
    """One email about one booking - the outbox (TICKET-030).

    A row is created in the *same transaction* as the booking change it
    reports (booked, confirmed, cancelled), and the email itself is sent
    only after that transaction has committed (notifications/outbox.py). So:

      - an email is never sent for a change that was rolled back;
      - a failed send never blocks or rolls back the booking - the row just
        records `failed` and can be retried;
      - there is at most one row per (booking, kind) (a DB constraint), so a
        repeated Stripe webhook or a double confirm can't send twice.

    The content is rendered when the email is sent, from the booking as it is
    then. If the booking has moved on before a (retried) email could go out -
    e.g. a "booking received" email for a booking that is already confirmed -
    it is marked `skipped` instead of sending something out of date.

        pending ──claimed──▶ sending ──ok──▶ sent
                                   └─error─▶ failed ──retry──▶ sending ...
        pending/failed ──booking moved on──▶ skipped
    """

    class Kind(models.TextChoices):
        BOOKING_RECEIVED = "booking_received", "Booking received (guest)"
        BOOKING_CONFIRMED = "booking_confirmed", "Booking confirmed (guest)"
        BOOKING_CANCELLED = "booking_cancelled", "Booking cancelled (guest)"
        ADMIN_NEW_BOOKING = "admin_new_booking", "New booking alert (admin)"

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting to send"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped (booking changed)"

    booking = models.ForeignKey(
        "bookings.Booking",
        on_delete=models.CASCADE,
        related_name="emails",
    )
    class Reason(models.TextChoices):
        # Why a booking was cancelled - picks the wording of the email.
        NONE = "", "-"
        GUEST = "guest", "Cancelled by the guest"
        HOST = "host", "Cancelled by the host"
        PAYMENT_EXPIRED = "payment_expired", "Payment time ran out"
        PAYMENT_FAILED = "payment_failed", "Payment failed"

    class Provider(models.TextChoices):
        # Who actually sent it (TICKET-047) - filled in when the email is sent.
        NONE = "", "-"
        GMAIL = "gmail", "Gmail API"
        BREVO = "brevo", "Brevo (Gmail fallback)"
        SMTP = "smtp", "SMTP"
        CONSOLE = "console", "Console (printed to the log)"

    kind = models.CharField(max_length=32, choices=Kind.choices)
    reason = models.CharField(max_length=20, choices=Reason.choices, blank=True, default="")
    # Comma-separated, fixed when the row is created (the guest's email, or
    # BOOKING_ALERT_EMAILS for the admin alert).
    recipients = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=500, blank=True)
    provider = models.CharField(max_length=10, choices=Provider.choices, blank=True, default="")
    # The provider's message id (Gmail's / Brevo's; empty for console/SMTP).
    provider_message_id = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sending_started_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["booking", "kind"], name="one_email_per_booking_kind"),
        ]
        indexes = [models.Index(fields=["status"], name="bookingemail_status_idx")]

    def __str__(self):
        return f"{self.get_kind_display()} - booking #{self.booking_id} ({self.status})"

    @property
    def recipient_list(self):
        return [r.strip() for r in self.recipients.split(",") if r.strip()]


class GmailHealth(models.Model):
    """Whether the Gmail API login works - one row, pk=1 (TICKET-047).

    Written by GmailWithBrevoFallbackBackend (notifications/gmail_health.py):
    set when Gmail's login is dead (e.g. the refresh token expired) and an
    email went through Brevo instead; cleared by the next email Gmail sends.
    `alerted_at` = when the owner was last emailed "the Gmail token needs
    renewing" - at most once a day. Kept in the database (not in memory) so
    a restart on Render doesn't send the alert again.
    """

    failing_since = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    alerted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Gmail status"
        verbose_name_plural = "Gmail status"

    def __str__(self):
        return f"Gmail login failing since {self.failing_since:%Y-%m-%d %H:%M}" if self.failing_since else "Gmail OK"
