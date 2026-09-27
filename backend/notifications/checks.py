"""Startup checks for the email settings (TICKET-030).

Only warnings: a mis-set email setting must never stop a deploy (build.sh
runs `migrate`, which runs these checks) - bookings work without emails, and
every email waits in the outbox until it can be sent.
"""
from email.utils import parseaddr

from django.conf import settings
from django.core.checks import Warning, register

PROVIDERS = ("console", "smtp", "brevo")


@register()
def email_settings_check(app_configs=None, **kwargs):
    problems = []
    provider = settings.EMAIL_PROVIDER
    if provider not in PROVIDERS:
        problems.append(Warning(
            f"EMAIL_PROVIDER={provider!r} isn't known - emails are printed to the log instead.",
            hint="Use console, smtp or brevo.",
            id="notifications.W001",
        ))
    if provider == "brevo" and not settings.BREVO_API_KEY:
        problems.append(Warning(
            "EMAIL_PROVIDER is brevo but BREVO_API_KEY isn't set - emails are printed to the log instead.",
            hint="Create an API key in Brevo (SMTP & API -> API keys) and set BREVO_API_KEY.",
            id="notifications.W002",
        ))
    sender = parseaddr(settings.DEFAULT_FROM_EMAIL)[1]
    if provider == "brevo" and (not sender or sender.endswith("@example.com")):
        problems.append(Warning(
            f"DEFAULT_FROM_EMAIL ({settings.DEFAULT_FROM_EMAIL!r}) isn't a real sender address.",
            hint="Set it to an address verified in Brevo (Senders), e.g. 'Booking Demo <you@gmail.com>'.",
            id="notifications.W003",
        ))
    bad = [e for e in settings.BOOKING_ALERT_EMAILS if "@" not in parseaddr(e)[1]]
    if bad:
        problems.append(Warning(
            f"BOOKING_ALERT_EMAILS has entries that aren't email addresses: {', '.join(bad)}",
            hint="A comma-separated list, e.g. admin@example.com,owner@example.com",
            id="notifications.W004",
        ))
    return problems
