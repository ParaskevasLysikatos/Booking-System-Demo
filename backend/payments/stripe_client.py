"""The one place the app talks to Stripe from (TICKET-029).

Uses the StripeClient instance pattern (not the deprecated global
`stripe.api_key`), with the API version pinned in settings so a Stripe
account upgrade can't change response shapes under us. Tests replace
get_client() with a mock - the suite never calls Stripe.
"""
from functools import lru_cache

import stripe
from django.conf import settings


class PaymentsDisabled(Exception):
    """STRIPE_SECRET_KEY isn't set - online payment is switched off."""


def payments_enabled():
    return bool(settings.PAYMENTS_ENABLED and settings.STRIPE_SECRET_KEY)


def get_client() -> stripe.StripeClient:
    if not payments_enabled():
        raise PaymentsDisabled()
    return _client(settings.STRIPE_SECRET_KEY, settings.STRIPE_API_VERSION)


@lru_cache(maxsize=4)
def _client(api_key, api_version):
    # max_network_retries: the SDK retries dropped connections itself, re-sending
    # the same idempotency key, so a retry can't create a second session.
    return stripe.StripeClient(api_key, stripe_version=api_version, max_network_retries=2)
