"""Builds the actual email for an outbox row (TICKET-030).

Each kind has two Django templates - `notifications/emails/<kind>.html`
(inline styles, a simple table layout that survives Gmail/Outlook) and
`<kind>.txt` (the plain-text version) - rendered from email_context(). The
subject lines are built here. Everything is rendered when the email is
*sent*, from the booking as it is then.

Money and dates are formatted like the Angular app: "€240" / "€95.50",
"Wed 10 Mar 2027", times in the site's time zone (Europe/Athens).
"""
import re
from decimal import Decimal

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone, translation

from payments.models import Payment

from .models import BookingEmail

Kind = BookingEmail.Kind


def money(amount):
    """Decimal("240.00") -> "€240", Decimal("95.5") -> "€95.50", thousands with commas."""
    value = Decimal(amount)
    if value == value.to_integral_value():
        return f"€{value:,.0f}"
    return f"€{value:,.2f}"


def day(value):
    """date(2027, 3, 10) -> "Wed 10 Mar 2027"."""
    return f"{value:%a} {value.day} {value:%b %Y}"


def day_time(value):
    """An aware datetime -> "Mon 8 Mar 2027, 15:00" in the site's time zone."""
    local = timezone.localtime(value)
    return f"{day(local.date())}, {local:%H:%M}"


def short_range(check_in, check_out):
    """"10–13 Mar", "28 Feb – 3 Mar", "30 Dec 2026 – 2 Jan 2027"."""
    if check_in.year != check_out.year:
        return f"{check_in.day} {check_in:%b %Y} – {check_out.day} {check_out:%b %Y}"
    if check_in.month != check_out.month:
        return f"{check_in.day} {check_in:%b} – {check_out.day} {check_out:%b}"
    return f"{check_in.day}–{check_out.day} {check_out:%b}"


def _payment_view(booking, payment, now):
    """What the email says about money: one of
    open (pay by ...) / paid / waived (confirmed by hand) / none."""
    if payment is None:
        return {"state": "none"}
    if payment.status == Payment.Status.OPEN:
        return {"state": "open", "pay_by": timezone.localtime(payment.expires_at).strftime("%H:%M"),
                "pay_by_full": day_time(payment.expires_at), "open": payment.expires_at > now}
    if payment.status == Payment.Status.PAID:
        return {"state": "paid", "amount": money(payment.amount)}
    if payment.status == Payment.Status.CANCELLED and booking.status == booking.Status.CONFIRMED:
        return {"state": "waived"}  # an admin confirmed it without online payment
    return {"state": payment.status}


def _refund_view(payment):
    """For the cancellation email: is money coming back, and how sure are we?"""
    if payment is None or payment.status != Payment.Status.PAID:
        return {"state": "none"}  # nothing was charged
    amount = money(payment.refund_amount or payment.amount)
    if payment.refund_status == Payment.RefundStatus.REFUNDED:
        return {"state": "refunded", "amount": amount}
    if payment.refund_status == Payment.RefundStatus.PENDING:
        return {"state": "on_its_way", "amount": amount}
    # failed / not started: never the technical reason, just that it's handled
    return {"state": "arranging", "amount": amount}


def email_context(row, now=None):
    now = now or timezone.now()
    booking = row.booking
    prop = booking.property
    guest = booking.guest
    payment = Payment.objects.filter(booking=booking).first()
    cover = prop.cover_image
    frontend = settings.FRONTEND_URL
    deadline = booking.cancel_deadline()
    return {
        "kind": row.kind,
        "reason": row.reason,
        "ref": f"#{booking.pk}",
        "booking_id": booking.pk,
        "guest_name": (guest.first_name or "").strip() or guest.email.split("@")[0] or "there",
        "guest_email": guest.email,
        "property_title": prop.title,
        "property_location": prop.location,
        "cover_url": cover.image if cover else "",
        "check_in": day(booking.check_in),
        "check_out": day(booking.check_out),
        "dates": short_range(booking.check_in, booking.check_out),
        "nights": booking.get_nights(),
        "guests": booking.guests,
        "total": money(booking.total_price),
        "check_in_time": settings.BOOKING_CHECK_IN_TIME,
        "cancel_deadline": day_time(deadline),
        "can_cancel_online": deadline > now,
        "cancellation_hours": settings.BOOKING_GUEST_CANCELLATION_HOURS,
        "payment": _payment_view(booking, payment, now),
        "refund": _refund_view(payment),
        "hold_minutes": settings.STRIPE_CHECKOUT_HOLD_MINUTES,
        "created_at": day_time(booking.created_at),
        "links": {
            "my_bookings": f"{frontend}/my-bookings",
            "my_cancelled": f"{frontend}/my-bookings?tab=cancelled",
            "pay": f"{frontend}/bookings/{booking.pk}/payment",
            "property": f"{frontend}/listings/{prop.pk}",
            "listings": f"{frontend}/listings",
            "admin_bookings": f"{frontend}/admin/bookings",
            "site": frontend,
        },
        "site_name": "Booking System Demo",
    }


def subject_for(row, ctx):
    title, dates, ref = ctx["property_title"], ctx["dates"], ctx["ref"]
    return {
        Kind.BOOKING_RECEIVED: (
            f"Complete your payment - booking {ref}, {title}" if ctx["payment"]["state"] == "open"
            else f"Booking {ref} received - {title}, {dates}"
        ),
        Kind.BOOKING_CONFIRMED: f"Booking {ref} confirmed - {title}, {dates}",
        Kind.BOOKING_CANCELLED: f"Booking {ref} cancelled - {title}, {dates}",
        Kind.ADMIN_NEW_BOOKING: f"New booking {ref}: {title}, {dates} ({ctx['total']})",
    }[row.kind]


def _tidy(text):
    """Plain-text version: no runs of blank lines left by template tags."""
    text = "\n".join(line.rstrip() for line in text.strip().splitlines())
    return re.sub(r"\n{3,}", "\n\n", text) + "\n"


def build_message(row):
    # Booking emails stay English (TICKET-038 scope), even when they're
    # built inside a request the guest made in Greek.
    with translation.override("en"):
        return _build_message(row)


def _build_message(row):
    ctx = email_context(row)
    template = f"notifications/emails/{row.kind}"
    message = EmailMultiAlternatives(
        subject=subject_for(row, ctx),
        body=_tidy(render_to_string(f"{template}.txt", ctx)),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=row.recipient_list,
        reply_to=[settings.DEFAULT_FROM_EMAIL],
        # Which outbox row this is - visible in "Show original" in Gmail.
        headers={"X-Booking-Email": f"booking-{row.booking_id}-{row.kind}"},
    )
    message.attach_alternative(render_to_string(f"{template}.html", ctx), "text/html")
    message.tags = [row.kind]
    return message
