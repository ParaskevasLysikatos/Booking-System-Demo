import logging

import stripe
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from django.views.decorators.http import require_GET, require_POST

from .models import StripeEvent
from .stripe_client import payments_enabled, webhook_secret
from .webhooks import HANDLED_EVENTS, handle_event

logger = logging.getLogger(__name__)


@require_GET
def payments_config(request):
    """GET /api/payments/config/ - public: lets the booking form say
    "Confirm and pay" and "dates held for 30 minutes" before a booking
    exists. No secrets here (the secret key never leaves the server)."""
    return JsonResponse({
        "enabled": payments_enabled(),
        "hold_minutes": settings.STRIPE_CHECKOUT_HOLD_MINUTES,
        "currency": settings.PAYMENTS_CURRENCY,
    })


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """POST /api/payments/stripe/webhook/ (TICKET-029).

    A plain Django view, not DRF: the signature is computed over the *raw*
    request body, so it must be verified before anything parses it. No login
    - Stripe's signature is the authentication. Any non-2xx answer makes
    Stripe retry the delivery later (for up to 3 days).
    """
    secret = webhook_secret()
    if not secret:
        logger.error("Stripe webhook received but no signing secret is configured")
        return JsonResponse({"detail": "Webhook not configured."}, status=503)
    try:
        event = stripe.Webhook.construct_event(
            request.body, request.headers.get("Stripe-Signature", ""), secret
        ).to_dict()  # plain dicts from here on (StripeObjects aren't dicts in SDK v15)
    except (ValueError, stripe.SignatureVerificationError):
        logger.warning("Rejected a Stripe webhook with a bad payload or signature")
        return JsonResponse({"detail": "Invalid payload or signature."}, status=400)

    if event["type"] not in HANDLED_EVENTS:
        return JsonResponse({"received": True, "handled": False})

    # Stripe delivers each event *at least* once. The event id is inserted in
    # the same transaction as the changes it causes: a second delivery hits
    # the primary key and is skipped (a simultaneous one waits for the first
    # to commit, then is skipped), and if handling fails, everything -
    # including this row - rolls back so Stripe's retry starts clean.
    with transaction.atomic():
        try:
            with transaction.atomic():
                StripeEvent.objects.create(event_id=event["id"], type=event["type"])
        except IntegrityError:
            return JsonResponse({"received": True, "duplicate": True})
        handle_event(event)
    return JsonResponse({"received": True, "handled": True})
