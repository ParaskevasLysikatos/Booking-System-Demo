"""Startup checks for the email settings (TICKET-030).

Only warnings: a mis-set email setting must never stop a deploy (build.sh
runs `migrate`, which runs these checks) - bookings work without emails, and
every email waits in the outbox until it can be sent.
"""
from email.utils import parseaddr

from django.conf import settings
from django.core.checks import Warning, register

PROVIDERS = ("console", "smtp", "gmail")


@register()
def email_settings_check(app_configs=None, **kwargs):
    problems = []
    provider = settings.EMAIL_PROVIDER
    if provider not in PROVIDERS:
        problems.append(Warning(
            f"EMAIL_PROVIDER={provider!r} isn't known - emails are printed to the log instead.",
            hint="Use console, smtp or gmail.",
            id="notifications.W001",
        ))
    if provider == "gmail":
        missing = [name for name in ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")
                   if not getattr(settings, name)]
        if missing:
            problems.append(Warning(
                f"EMAIL_PROVIDER is gmail but {', '.join(missing)} {'is' if len(missing) == 1 else 'are'} not set - "
                "emails are printed to the log instead.",
                hint="See the README's \"Emails on Render (Gmail API)\"; the refresh token comes from "
                     "`manage.py gmail_authorize`.",
                id="notifications.W002",
            ))
        sender = parseaddr(settings.DEFAULT_FROM_EMAIL)[1]
        if not sender or sender.endswith("@example.com"):
            problems.append(Warning(
                f"DEFAULT_FROM_EMAIL ({settings.DEFAULT_FROM_EMAIL!r}) isn't a real sender address.",
                hint="Set it to the authorised Gmail, e.g. 'Booking System Demo <you@gmail.com>'.",
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
