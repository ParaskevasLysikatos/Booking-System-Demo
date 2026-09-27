"""Builds the actual email for an outbox row (TICKET-030).

Step 1: a plain-text placeholder per kind. Step 2 replaces this with the
real HTML + text templates.
"""
from django.conf import settings
from django.core.mail import EmailMultiAlternatives


def build_message(row):
    booking = row.booking
    message = EmailMultiAlternatives(
        subject=f"{row.get_kind_display()} - booking #{booking.pk}",
        body=f"{row.get_kind_display()}: booking #{booking.pk}, {booking.check_in} to {booking.check_out}.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=row.recipient_list,
        headers={"Idempotency-Key": f"booking-{booking.pk}-{row.kind}"},
    )
    message.tags = [row.kind]
    return message
