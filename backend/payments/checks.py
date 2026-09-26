"""Startup checks for the Stripe settings (TICKET-029).

Django runs these on `manage.py check`, `runserver` and `migrate` - and
build.sh runs `migrate` on every Render deploy, so a misconfigured deploy
fails loudly instead of taking real money or silently never confirming.
"""
from django.conf import settings
from django.core.checks import Error, Warning, register

TEST_KEY_PREFIXES = ("sk_test_", "rk_test_")
LIVE_KEY_PREFIXES = ("sk_live_", "rk_live_")
MIN_HOLD_MINUTES = 30  # Stripe's minimum Checkout Session lifetime
MAX_HOLD_MINUTES = 24 * 60  # ... and its maximum


@register()
def stripe_settings_check(app_configs=None, **kwargs):
    key = settings.STRIPE_SECRET_KEY
    if not key:
        return []  # payments switched off - nothing to check

    problems = []
    if key.startswith("pk_"):
        problems.append(Error(
            "STRIPE_SECRET_KEY is a publishable key (pk_...).",
            hint="Use a restricted key (rk_test_...) or secret key (sk_test_...).",
            id="payments.E001",
        ))
    elif key.startswith(LIVE_KEY_PREFIXES):
        if not settings.STRIPE_ALLOW_LIVE_KEYS:
            problems.append(Error(
                "STRIPE_SECRET_KEY is a live-mode key, but this demo only takes test payments.",
                hint="Use an rk_test_/sk_test_ key, or set STRIPE_ALLOW_LIVE_KEYS=True deliberately.",
                id="payments.E002",
            ))
    elif not key.startswith(TEST_KEY_PREFIXES):
        problems.append(Error(
            "STRIPE_SECRET_KEY doesn't look like a Stripe secret or restricted key.",
            hint="Expected a key starting with rk_test_ or sk_test_.",
            id="payments.E003",
        ))
    elif key.startswith("sk_"):
        problems.append(Warning(
            "STRIPE_SECRET_KEY is a full-access secret key.",
            hint="Stripe recommends a restricted key (rk_test_...) with only 'Checkout Sessions: Write'.",
            id="payments.W001",
        ))

    hold = settings.STRIPE_CHECKOUT_HOLD_MINUTES
    if not MIN_HOLD_MINUTES <= hold <= MAX_HOLD_MINUTES:
        problems.append(Error(
            f"STRIPE_CHECKOUT_HOLD_MINUTES={hold} is outside what Stripe allows.",
            hint=f"Use {MIN_HOLD_MINUTES}..{MAX_HOLD_MINUTES} minutes.",
            id="payments.E004",
        ))

    if not (settings.STRIPE_WEBHOOK_SECRET or settings.STRIPE_WEBHOOK_SECRET_FILE):
        problems.append(Warning(
            "Payments are on but no webhook signing secret is configured.",
            hint="Without it no payment can ever confirm a booking. Set STRIPE_WEBHOOK_SECRET "
                 "(Render) or run the stripe-cli Docker service (local).",
            id="payments.W002",
        ))
    return problems
