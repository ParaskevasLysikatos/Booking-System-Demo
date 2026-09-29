"""The one place the app talks to Stripe from (TICKET-029).

Uses the StripeClient instance pattern (not the deprecated global
`stripe.api_key`), with the API version pinned in settings so a Stripe
account upgrade can't change response shapes under us. Tests replace
get_client() with a mock - the suite never calls Stripe.
"""
import logging
from functools import lru_cache
from pathlib import Path

import stripe
from django.conf import settings


logger = logging.getLogger(__name__)


class PaymentsDisabled(Exception):
    """STRIPE_SECRET_KEY isn't set - online payment is switched off."""


def payments_enabled():
    return bool(settings.PAYMENTS_ENABLED and settings.STRIPE_SECRET_KEY)


# TICKET-044: Stripe test keys. A live key (sk_live_ / rk_live_) never matches.
TEST_KEY_PREFIXES = ("sk_test_", "rk_test_")


def is_test_mode():
    """True only when online payment is on *and* the key is a Stripe test
    key - worked out here from the key's prefix; the key itself never leaves
    the server. False for a live key and when payments are off, so the
    "use card 4242..." hint can never reach a real guest (TICKET-044)."""
    return payments_enabled() and settings.STRIPE_SECRET_KEY.startswith(TEST_KEY_PREFIXES)


def get_client() -> stripe.StripeClient:
    if not payments_enabled():
        raise PaymentsDisabled()
    return _client(settings.STRIPE_SECRET_KEY, settings.STRIPE_API_VERSION)


@lru_cache(maxsize=4)
def _client(api_key, api_version):
    # max_network_retries: the SDK retries dropped connections itself, re-sending
    # the same idempotency key, so a retry can't create a second session.
    return stripe.StripeClient(api_key, stripe_version=api_version, max_network_retries=2)


def webhook_secret():
    """The webhook signing secret (whsec_...): STRIPE_WEBHOOK_SECRET if set
    (Render), else the file the local stripe-cli Docker service writes it to.
    Read on every call, because stripe-cli may start after the backend."""
    if settings.STRIPE_WEBHOOK_SECRET:
        return settings.STRIPE_WEBHOOK_SECRET
    path = settings.STRIPE_WEBHOOK_SECRET_FILE
    if path:
        try:
            return Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            logger.warning("Webhook secret file %s isn't readable (is stripe-cli running?)", path)
    return ""
