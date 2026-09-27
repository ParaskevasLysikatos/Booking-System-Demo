from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.checks import Error, Warning
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from bookings.models import Booking
from listings.models import Property

from .checks import stripe_settings_check
from .models import Payment, StripeEvent

User = get_user_model()


def make_booking(total="240.00"):
    guest = User.objects.create_user("payer", "payer@example.com", "S3cure-Booking-Pass!")
    prop = Property.objects.create(
        title="Loft", location="Thessaloniki", price_per_night=Decimal("80.00"), capacity=3
    )
    today = timezone.localdate()
    return Booking.objects.create(
        property=prop, guest=guest, check_in=today + timedelta(days=10),
        check_out=today + timedelta(days=13), total_price=Decimal(total),
    )


def make_payment(booking, **extra):
    fields = dict(
        booking=booking, amount=booking.total_price,
        stripe_checkout_session_id=f"cs_test_{booking.pk}",
        checkout_url="https://checkout.stripe.com/c/pay/cs_test_x",
        expires_at=timezone.now() + timedelta(minutes=30),
    )
    fields.update(extra)
    return Payment.objects.create(**fields)


class PaymentModelTests(TestCase):
    def setUp(self):
        self.booking = make_booking()

    def test_defaults_and_cents(self):
        payment = make_payment(self.booking)
        self.assertEqual(payment.status, Payment.Status.OPEN)
        self.assertEqual(payment.currency, "eur")
        self.assertEqual(payment.amount_cents, 24000)
        self.assertEqual(self.booking.payment, payment)  # reverse one-to-one

    def test_to_cents_is_exact(self):
        # The classic float trap: 0.1 + 0.2 style amounts must stay exact.
        self.assertEqual(Payment.to_cents(Decimal("364.10")), 36410)
        self.assertEqual(Payment.to_cents(Decimal("0.29")), 29)
        self.assertEqual(Payment.to_cents(Decimal("1234.99")), 123499)

    def test_one_payment_per_booking(self):
        make_payment(self.booking)
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_payment(self.booking, stripe_checkout_session_id="cs_test_other")

    def test_session_id_is_unique(self):
        make_payment(self.booking)
        other = Booking.objects.create(
            property=self.booking.property, guest=self.booking.guest,
            check_in=self.booking.check_out, check_out=self.booking.check_out + timedelta(days=1),
            total_price=Decimal("80.00"),
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_payment(other, stripe_checkout_session_id=f"cs_test_{self.booking.pk}")

    def test_db_rejects_non_positive_amount(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_payment(self.booking, amount=Decimal("0.00"))

    def test_is_holding(self):
        now = timezone.now()
        payment = make_payment(self.booking, expires_at=now + timedelta(minutes=5))
        self.assertTrue(payment.is_holding(now))
        self.assertFalse(payment.is_holding(now + timedelta(minutes=5)))  # expiry is exclusive
        payment.status = Payment.Status.PAID
        self.assertFalse(payment.is_holding(now))

    def test_follows_booking_on_delete(self):
        make_payment(self.booking)
        self.booking.delete()
        self.assertFalse(Payment.objects.exists())


class StripeEventTests(TestCase):
    def test_duplicate_event_id_is_rejected(self):
        StripeEvent.objects.create(event_id="evt_1", type="checkout.session.completed")
        with self.assertRaises(IntegrityError), transaction.atomic():
            StripeEvent.objects.create(event_id="evt_1", type="checkout.session.completed")


STRIPE_DEFAULTS = dict(
    STRIPE_SECRET_KEY="rk_test_abc",
    STRIPE_ALLOW_LIVE_KEYS=False,
    STRIPE_WEBHOOK_SECRET="whsec_abc",
    STRIPE_WEBHOOK_SECRET_FILE="",
    STRIPE_CHECKOUT_HOLD_MINUTES=30,
)


class StripeSettingsCheckTests(SimpleTestCase):
    def ids(self, **overrides):
        with override_settings(**{**STRIPE_DEFAULTS, **overrides}):
            return [p.id for p in stripe_settings_check()]

    def test_payments_off_is_fine(self):
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="", STRIPE_WEBHOOK_SECRET=""), [])

    def test_restricted_test_key_is_clean(self):
        self.assertEqual(self.ids(), [])

    def test_full_secret_key_warns(self):
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="sk_test_abc"), ["payments.W001"])

    def test_live_keys_refused_unless_allowed(self):
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="rk_live_abc"), ["payments.E002"])
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="sk_live_abc"), ["payments.E002"])
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="rk_live_abc", STRIPE_ALLOW_LIVE_KEYS=True), [])

    def test_wrong_kind_of_key(self):
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="pk_test_abc"), ["payments.E001"])
        self.assertEqual(self.ids(STRIPE_SECRET_KEY="whsec_oops"), ["payments.E003"])

    def test_hold_minutes_must_fit_stripe_limits(self):
        self.assertEqual(self.ids(STRIPE_CHECKOUT_HOLD_MINUTES=29), ["payments.E004"])
        self.assertEqual(self.ids(STRIPE_CHECKOUT_HOLD_MINUTES=24 * 60 + 1), ["payments.E004"])
        self.assertEqual(self.ids(STRIPE_CHECKOUT_HOLD_MINUTES=24 * 60), [])

    def test_missing_webhook_secret_warns(self):
        self.assertEqual(self.ids(STRIPE_WEBHOOK_SECRET=""), ["payments.W002"])
        self.assertEqual(self.ids(STRIPE_WEBHOOK_SECRET="", STRIPE_WEBHOOK_SECRET_FILE="/stripe/whsec"), [])

    def test_levels(self):
        with override_settings(**{**STRIPE_DEFAULTS, "STRIPE_SECRET_KEY": "rk_live_abc"}):
            self.assertIsInstance(stripe_settings_check()[0], Error)
        with override_settings(**{**STRIPE_DEFAULTS, "STRIPE_WEBHOOK_SECRET": ""}):
            self.assertIsInstance(stripe_settings_check()[0], Warning)


# --------------------------------------------------------------------------
# Step 2: the hold at booking time + POST /api/bookings/{id}/checkout/
# (Stripe is always mocked - the suite never calls it.)
# --------------------------------------------------------------------------

from datetime import datetime, timezone as dt_timezone  # noqa: E402
from unittest import mock  # noqa: E402

import stripe  # noqa: E402
from django.urls import reverse  # noqa: E402
from rest_framework import status  # noqa: E402
from rest_framework.test import APIClient, APITestCase  # noqa: E402

from listings.models import PropertyImage  # noqa: E402

from . import services  # noqa: E402

PASSWORD = "S3cure-Booking-Pass!"
PAYMENTS_ON = dict(
    PAYMENTS_ENABLED=True,
    STRIPE_SECRET_KEY="rk_test_dummy",
    STRIPE_WEBHOOK_SECRET="whsec_dummy",
    STRIPE_CHECKOUT_HOLD_MINUTES=30,
    FRONTEND_URL="http://localhost:4200",
)


def checkout_url(pk):
    return reverse("booking-checkout", args=[pk])


def fake_session(session_id="cs_test_123", expires_at=None, status="open", payment_status="unpaid", **extra):
    expires_at = expires_at or int((timezone.now() + timedelta(minutes=32)).timestamp())
    return stripe.checkout.Session.construct_from({
        "id": session_id,
        "object": "checkout.session",
        "url": f"https://checkout.stripe.com/c/pay/{session_id}",
        "expires_at": expires_at,
        "status": status,
        "payment_status": payment_status,
        "amount_total": 24015,
        "currency": "eur",
        "payment_intent": "pi_test_123" if status == "complete" else None,
        **extra,
    }, "rk_test_dummy")


def fake_refund(refund_id="re_test_1", status="pending", **extra):
    return stripe.Refund.construct_from({
        "id": refund_id, "object": "refund", "amount": 24015, "currency": "eur",
        "payment_intent": "pi_test_123", "status": status, **extra,
    }, "rk_test_dummy")


class CheckoutFixtures:
    def setUp(self):
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.other = User.objects.create_user("other", "other@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.prop = Property.objects.create(
            title="Loft", location="Thessaloniki", price_per_night=Decimal("80.05"), capacity=3
        )
        PropertyImage.objects.create(property=self.prop, image="https://img.test/c.jpg", is_cover=True)
        self.stripe = mock.MagicMock()
        self.sessions = self.stripe.v1.checkout.sessions
        self.sessions.create.return_value = fake_session()
        self.sessions.expire.return_value = fake_session(status="expired")
        self.refunds = self.stripe.v1.refunds
        self.refunds.create.return_value = fake_refund()
        for target in ("payments.services.get_client", "payments.refunds.get_client"):
            patcher = mock.patch(target, return_value=self.stripe)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client.force_authenticate(self.guest)

    def book_via_api(self, start=10, end=13):
        today = timezone.localdate()
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": (today + timedelta(days=start)).isoformat(),
            "check_out": (today + timedelta(days=end)).isoformat(), "guests": 2,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        return Booking.objects.get(pk=res.data["id"]), res

    def create_kwargs(self, call_index=-1):
        call = self.sessions.create.call_args_list[call_index]
        return call.kwargs["params"], call.kwargs["options"]


@override_settings(**PAYMENTS_ON)
class HoldAtBookingTests(CheckoutFixtures, APITestCase):
    def test_booking_starts_an_open_hold(self):
        before = timezone.now()
        booking, res = self.book_via_api()
        payment = booking.payment
        self.assertEqual(payment.status, Payment.Status.OPEN)
        self.assertEqual(payment.amount, Decimal("240.15"))  # 3 x 80.05, exact
        self.assertEqual(payment.currency, "eur")
        self.assertIsNone(payment.stripe_checkout_session_id)
        # 30-minute hold + 2 minutes' retry slack, measured from booking
        self.assertAlmostEqual(
            (payment.expires_at - before).total_seconds(), 32 * 60, delta=5
        )
        block = res.data["payment"]
        self.assertEqual(block["status"], "open")
        self.assertEqual(block["amount"], "240.15")
        self.assertTrue(block["can_pay"])
        self.assertEqual(booking.status, Booking.Status.PENDING)
        self.sessions.create.assert_not_called()  # Stripe only at checkout

    def test_losing_the_race_creates_no_payment(self):
        self.book_via_api()
        today = timezone.localdate()
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": (today + timedelta(days=11)).isoformat(),
            "check_out": (today + timedelta(days=12)).isoformat(), "guests": 1,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Payment.objects.count(), 1)

    @override_settings(PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY="")
    def test_payments_off_means_no_hold(self):
        booking, res = self.book_via_api()
        self.assertFalse(Payment.objects.exists())
        self.assertIsNone(res.data["payment"])

    def test_can_pay_is_only_for_the_owner(self):
        booking, _ = self.book_via_api()
        self.client.force_authenticate(self.admin)
        res = self.client.get(reverse("booking-detail", args=[booking.pk]))
        self.assertEqual(res.data["payment"]["status"], "open")
        self.assertFalse(res.data["payment"]["can_pay"])


@override_settings(**PAYMENTS_ON)
class CheckoutEndpointTests(CheckoutFixtures, APITestCase):
    def test_creates_session_with_exact_request(self):
        booking, _ = self.book_via_api()
        res = self.client.post(checkout_url(booking.pk))
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual(res.data["checkout_url"], "https://checkout.stripe.com/c/pay/cs_test_123")

        params, options = self.create_kwargs()
        self.assertEqual(options, {"idempotency_key": f"booking-{booking.pk}-checkout-1"})
        item = params["line_items"][0]
        self.assertEqual(item["quantity"], 1)
        self.assertEqual(item["price_data"]["unit_amount"], 24015)  # cents, exact
        self.assertEqual(item["price_data"]["currency"], "eur")
        self.assertIn("Loft - 3 nights", item["price_data"]["product_data"]["name"])
        self.assertEqual(params["mode"], "payment")
        self.assertEqual(params["metadata"]["booking_id"], str(booking.pk))
        self.assertEqual(params["client_reference_id"], str(booking.pk))
        self.assertEqual(params["payment_intent_data"]["metadata"]["booking_id"], str(booking.pk))
        self.assertEqual(params["customer_email"], "guest@example.com")
        self.assertEqual(params["expires_at"], int(booking.payment.expires_at.timestamp()))
        self.assertEqual(
            params["success_url"],
            f"http://localhost:4200/bookings/{booking.pk}/payment?session_id={{CHECKOUT_SESSION_ID}}",
        )
        self.assertEqual(params["cancel_url"], f"http://localhost:4200/bookings/{booking.pk}/payment?cancelled=1")
        self.assertNotIn("payment_method_types", params)  # dynamic payment methods
        self.assertEqual(params["adaptive_pricing"], {"enabled": False})  # always charged in EUR
        self.assertEqual(params["managed_payments"], {"enabled": False})  # we are the seller, no Stripe-added tax

        payment = Payment.objects.get(booking=booking)
        self.assertEqual(payment.stripe_checkout_session_id, "cs_test_123")
        self.assertEqual(payment.checkout_url, "https://checkout.stripe.com/c/pay/cs_test_123")

    def test_expiry_is_taken_from_stripe(self):
        booking, _ = self.book_via_api()
        stripe_expiry = int((timezone.now() + timedelta(minutes=31)).timestamp())
        self.sessions.create.return_value = fake_session(expires_at=stripe_expiry)
        self.client.post(checkout_url(booking.pk))
        booking.payment.refresh_from_db()
        self.assertEqual(booking.payment.expires_at, datetime.fromtimestamp(stripe_expiry, tz=dt_timezone.utc))

    def test_pay_now_reuses_the_same_page(self):
        booking, _ = self.book_via_api()
        first = self.client.post(checkout_url(booking.pk))
        second = self.client.post(checkout_url(booking.pk))
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data, second.data)
        self.sessions.create.assert_called_once()  # no second session, ever

    def test_retry_after_a_failure_repeats_the_identical_request(self):
        booking, _ = self.book_via_api()
        self.sessions.create.side_effect = [stripe.APIConnectionError("network down"), fake_session()]
        with self.assertLogs("payments.services", "ERROR"), self.assertLogs("django.request", "ERROR"):
            failed = self.client.post(checkout_url(booking.pk))
        self.assertEqual(failed.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(failed.data["code"], "payment_provider_error")
        self.assertIsNone(Payment.objects.get(booking=booking).stripe_checkout_session_id)

        ok = self.client.post(checkout_url(booking.pk))
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        # Same key AND same parameters: if Stripe had created the session the
        # first time, it now just returns it - no second session.
        self.assertEqual(self.create_kwargs(0), self.create_kwargs(1))

    def test_late_retry_starts_a_fresh_attempt(self):
        booking, _ = self.book_via_api()
        # A first attempt never produced a session and its expiry is now too
        # close for Stripe to accept the same request again.
        Payment.objects.filter(booking=booking).update(expires_at=timezone.now() + timedelta(minutes=10))
        res = self.client.post(checkout_url(booking.pk))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        params, options = self.create_kwargs()
        self.assertEqual(options["idempotency_key"], f"booking-{booking.pk}-checkout-2")
        self.assertGreaterEqual(params["expires_at"] - timezone.now().timestamp(), 30 * 60)

    def test_parallel_duplicate_gets_a_friendly_409(self):
        booking, _ = self.book_via_api()
        self.sessions.create.side_effect = stripe.IdempotencyError("in progress")
        res = self.client.post(checkout_url(booking.pk))
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["code"], "checkout_in_progress")

    def test_only_the_bookings_guest_can_pay(self):
        booking, _ = self.book_via_api()
        for user in (self.other, self.admin):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(checkout_url(booking.pk)).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(checkout_url(booking.pk)).status_code, status.HTTP_401_UNAUTHORIZED)
        self.sessions.create.assert_not_called()

    def test_bookings_without_a_payment_are_not_payable(self):
        today = timezone.localdate()
        seeded = Booking.objects.create(
            property=self.prop, guest=self.guest, check_in=today + timedelta(days=40),
            check_out=today + timedelta(days=42), total_price=Decimal("160.10"),
        )
        res = self.client.post(checkout_url(seeded.pk))
        self.assertEqual((res.status_code, res.data["code"]), (409, "payment_not_required"))

    def test_states_that_cant_be_paid(self):
        booking, _ = self.book_via_api()
        cases = [
            (dict(booking_status=Booking.Status.CONFIRMED), "already_confirmed"),
            (dict(booking_status=Booking.Status.CANCELLED), "booking_cancelled"),
            (dict(payment_status=Payment.Status.PAID), "already_paid"),
            (dict(payment_status=Payment.Status.PROCESSING), "already_paid"),
            (dict(payment_status=Payment.Status.EXPIRED), "payment_window_closed"),
            (dict(payment_status=Payment.Status.CANCELLED), "payment_window_closed"),
        ]
        for change, code in cases:
            with self.subTest(code=code, change=change), transaction.atomic():
                if "booking_status" in change:
                    Booking.objects.filter(pk=booking.pk).update(status=change["booking_status"])
                if "payment_status" in change:
                    Payment.objects.filter(booking=booking).update(status=change["payment_status"])
                if "expires_at" in change:
                    Payment.objects.filter(booking=booking).update(expires_at=change["expires_at"])
                res = self.client.post(checkout_url(booking.pk))
                self.assertEqual((res.status_code, res.data["code"]), (409, code))
                transaction.set_rollback(True)
        self.sessions.create.assert_not_called()

    def test_cancelled_while_talking_to_stripe(self):
        booking, _ = self.book_via_api()

        def cancel_meanwhile(**kwargs):
            Booking.objects.filter(pk=booking.pk).update(status=Booking.Status.CANCELLED)
            return fake_session("cs_test_late")

        self.sessions.create.side_effect = cancel_meanwhile
        res = self.client.post(checkout_url(booking.pk))
        self.assertEqual((res.status_code, res.data["code"]), (409, "booking_cancelled"))
        self.sessions.expire.assert_called_once_with("cs_test_late")  # can never be paid

    def test_payments_switched_off_at_checkout(self):
        booking, _ = self.book_via_api()
        with override_settings(PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY=""), \
                mock.patch("payments.services.get_client", side_effect=services.PaymentsDisabled), \
                self.assertLogs("django.request", "ERROR"):
            res = self.client.post(checkout_url(booking.pk))
        self.assertEqual((res.status_code, res.data["code"]), (503, "payments_disabled"))

    def test_list_has_payment_blocks_without_extra_queries(self):
        for start in (10, 20, 30):
            self.book_via_api(start, start + 2)
        with self.assertNumQueries(3):  # count + one page query (payment LEFT JOINed) + images prefetch
            res = self.client.get(reverse("booking-list"))
        self.assertEqual([b["payment"]["status"] for b in res.data["results"]], ["open"] * 3)


# --------------------------------------------------------------------------
# Step 3: the webhook - real signed payloads, verified exactly like Stripe's
# --------------------------------------------------------------------------

import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

from django.db import connection  # noqa: E402
from django.test import Client, TransactionTestCase  # noqa: E402

WEBHOOK_URL = reverse("stripe-webhook")
WEBHOOK_SECRET = "whsec_test_secret"


def signed(payload: bytes, secret=WEBHOOK_SECRET, timestamp=None):
    """The Stripe-Signature header Stripe would send for this body."""
    timestamp = int(timestamp or time.time())
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def session_event(event_type, session_id, event_id=None, **session_fields):
    session = {
        "id": session_id, "object": "checkout.session", "payment_status": "paid",
        "status": "complete", "payment_intent": "pi_test_123", "amount_total": 24015,
        "currency": "eur", "metadata": {},
    }
    session.update(session_fields)
    return {
        "id": event_id or f"evt_{event_type.replace('.', '_')}_{session_id}",
        "object": "event", "type": event_type, "api_version": "2026-08-26.dahlia",
        "data": {"object": session},
    }


class WebhookFixtures(CheckoutFixtures):
    """A booking made through the API and taken to checkout (session cs_test_123)."""

    def setUp(self):
        super().setUp()
        self.booking, _ = self.book_via_api()
        self.assertEqual(self.client.post(checkout_url(self.booking.pk)).status_code, 200)
        self.hook = Client()  # Stripe doesn't log in

    def deliver(self, event, secret=WEBHOOK_SECRET, header=None):
        body = json.dumps(event).encode()
        return self.hook.post(
            WEBHOOK_URL, body, content_type="application/json",
            HTTP_STRIPE_SIGNATURE=header if header is not None else signed(body, secret),
        )

    def state(self):
        self.booking.refresh_from_db()
        payment = Payment.objects.get(booking=self.booking)
        return self.booking.status, payment.status


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class WebhookSecurityTests(WebhookFixtures, APITestCase):
    def test_bad_or_missing_signature_is_rejected(self):
        event = session_event("checkout.session.completed", "cs_test_123")
        body = json.dumps(event).encode()
        cases = {
            "missing": "",
            "wrong secret": signed(body, "whsec_attacker"),
            "garbage": "t=1,v1=deadbeef",
            "too old (replay)": signed(body, timestamp=time.time() - 3600),
        }
        for name, header in cases.items():
            with self.subTest(name), self.assertLogs("payments.views", "WARNING"), \
                    self.assertLogs("django.request", "WARNING"):
                res = self.deliver(event, header=header)
                self.assertEqual(res.status_code, 400)
        self.assertEqual(self.state(), ("pending", "open"))
        self.assertFalse(StripeEvent.objects.exists())

    def test_tampered_body_is_rejected(self):
        event = session_event("checkout.session.completed", "cs_test_123")
        header = signed(json.dumps(event).encode())
        event["data"]["object"]["amount_total"] = 1  # changed after signing
        with self.assertLogs("payments.views", "WARNING"), self.assertLogs("django.request", "WARNING"):
            self.assertEqual(self.deliver(event, header=header).status_code, 400)
        self.assertEqual(self.state(), ("pending", "open"))

    def test_no_secret_configured(self):
        with override_settings(STRIPE_WEBHOOK_SECRET="", STRIPE_WEBHOOK_SECRET_FILE=""), \
                self.assertLogs("payments.views", "ERROR"), self.assertLogs("django.request", "ERROR"):
            res = self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        self.assertEqual(res.status_code, 503)

    def test_secret_from_the_stripe_cli_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write("whsec_from_cli\n")
        with override_settings(STRIPE_WEBHOOK_SECRET="", STRIPE_WEBHOOK_SECRET_FILE=f.name):
            res = self.deliver(session_event("checkout.session.completed", "cs_test_123"), secret="whsec_from_cli")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.state(), ("confirmed", "paid"))

    def test_only_post(self):
        self.assertEqual(self.hook.get(WEBHOOK_URL).status_code, 405)

    def test_no_login_or_csrf_needed(self):
        csrf_client = Client(enforce_csrf_checks=True)
        body = json.dumps(session_event("checkout.session.completed", "cs_test_123")).encode()
        res = csrf_client.post(WEBHOOK_URL, body, content_type="application/json",
                               HTTP_STRIPE_SIGNATURE=signed(body))
        self.assertEqual(res.status_code, 200)


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class WebhookEventTests(WebhookFixtures, APITestCase):
    def test_paid_confirms_the_booking(self):
        res = self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        self.assertEqual(res.json(), {"received": True, "handled": True})
        self.assertEqual(self.state(), ("confirmed", "paid"))
        payment = Payment.objects.get(booking=self.booking)
        self.assertEqual(payment.stripe_payment_intent_id, "pi_test_123")
        self.assertIsNotNone(payment.paid_at)
        self.assertTrue(StripeEvent.objects.filter(type="checkout.session.completed").exists())
        # and the guest now sees it as paid, with nothing left to pay
        detail = self.client.get(reverse("booking-detail", args=[self.booking.pk])).data
        self.assertEqual((detail["status"], detail["payment"]["status"], detail["payment"]["can_pay"]),
                         ("confirmed", "paid", False))

    def test_duplicate_delivery_is_handled_once(self):
        event = session_event("checkout.session.expired", "cs_test_123", payment_status="unpaid", status="expired")
        self.deliver(event)
        self.assertEqual(self.state(), ("cancelled", "expired"))
        # Put things back to prove the second delivery changes nothing.
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.PENDING)
        Payment.objects.filter(booking=self.booking).update(status=Payment.Status.OPEN)
        res = self.deliver(event)
        self.assertEqual(res.json(), {"received": True, "duplicate": True})
        self.assertEqual(self.state(), ("pending", "open"))
        self.assertEqual(StripeEvent.objects.count(), 1)

    def test_delayed_payment_then_success(self):
        self.deliver(session_event("checkout.session.completed", "cs_test_123", payment_status="unpaid"))
        self.assertEqual(self.state(), ("pending", "processing"))
        # still holding the dates, but nothing more to pay
        detail = self.client.get(reverse("booking-detail", args=[self.booking.pk])).data
        self.assertFalse(detail["payment"]["can_pay"])
        self.deliver(session_event("checkout.session.async_payment_succeeded", "cs_test_123"))
        self.assertEqual(self.state(), ("confirmed", "paid"))

    def test_delayed_payment_then_failure_frees_the_dates(self):
        self.deliver(session_event("checkout.session.completed", "cs_test_123", payment_status="unpaid"))
        self.deliver(session_event("checkout.session.async_payment_failed", "cs_test_123", payment_status="unpaid"))
        self.assertEqual(self.state(), ("cancelled", "failed"))
        self.book_via_api()  # same dates are bookable again (asserts 201)

    def test_expired_releases_the_dates(self):
        self.deliver(session_event("checkout.session.expired", "cs_test_123", payment_status="unpaid", status="expired"))
        self.assertEqual(self.state(), ("cancelled", "expired"))
        self.book_via_api()  # asserts 201

    def test_expired_after_admin_confirmed_keeps_it_confirmed(self):
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)
        self.deliver(session_event("checkout.session.expired", "cs_test_123", payment_status="unpaid", status="expired"))
        self.assertEqual(self.state(), ("confirmed", "expired"))

    def test_expired_after_paid_changes_nothing(self):
        self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        self.deliver(session_event("checkout.session.expired", "cs_test_123"))
        self.assertEqual(self.state(), ("confirmed", "paid"))

    def test_paid_after_cancelled_stays_cancelled_and_is_refunded(self):
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CANCELLED)
        with self.assertLogs("payments.webhooks", "WARNING") as logs, \
                self.captureOnCommitCallbacks(execute=True):
            self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        self.assertIn("refunding it", logs.output[0])
        self.assertEqual(self.state(), ("cancelled", "paid"))
        payment = Payment.objects.get(booking=self.booking)
        self.assertEqual(payment.refund_status, Payment.RefundStatus.PENDING)
        self.assertEqual(payment.stripe_refund_id, "re_test_1")
        self.refunds.create.assert_called_once()
        self.assertEqual(self.refunds.create.call_args.kwargs["options"],
                         {"idempotency_key": f"booking-{self.booking.pk}-refund-1"})

    def test_amount_mismatch_is_never_confirmed(self):
        with self.assertLogs("payments.webhooks", "ERROR"):
            self.deliver(session_event("checkout.session.completed", "cs_test_123", amount_total=100))
        self.assertEqual(self.state(), ("pending", "paid"))

    def test_unknown_session_is_ignored(self):
        res = self.deliver(session_event("checkout.session.completed", "cs_test_someone_else"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.state(), ("pending", "open"))

    def test_unrelated_event_types_are_acknowledged_only(self):
        res = self.deliver({"id": "evt_other", "object": "event", "type": "customer.created",
                            "data": {"object": {"id": "cus_1", "object": "customer"}}})
        self.assertEqual(res.json(), {"received": True, "handled": False})
        self.assertFalse(StripeEvent.objects.exists())

    def test_failure_rolls_back_so_stripe_can_retry(self):
        event = session_event("checkout.session.completed", "cs_test_123")
        with mock.patch("payments.views.handle_event", side_effect=RuntimeError("db hiccup")), \
                self.assertLogs("django.request", "ERROR"), self.assertRaises(RuntimeError):
            self.deliver(event)  # Django's test client re-raises; in production -> 500
        self.assertFalse(StripeEvent.objects.exists())  # not marked as handled
        self.assertEqual(self.state(), ("pending", "open"))
        self.assertEqual(self.deliver(event).json()["handled"], True)  # Stripe's retry works
        self.assertEqual(self.state(), ("confirmed", "paid"))


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class WebhookConcurrencyTests(WebhookFixtures, TransactionTestCase):
    client_class = APIClient
    def test_simultaneous_duplicate_deliveries_are_handled_once(self):
        """Stripe can send the same event twice at the same moment: the second
        insert of the event id waits for the first transaction, then is
        skipped - the handler runs exactly once."""
        from . import webhooks

        calls, lock = [], threading.Lock()
        real = webhooks.handle_event

        def slow_handle(event):
            with lock:
                calls.append(event["id"])
            time.sleep(0.3)  # keep the first transaction open while the second arrives
            real(event)

        event = session_event("checkout.session.completed", "cs_test_123")
        results, errors = [None, None], []

        def go(i):
            try:
                results[i] = self.deliver(event).json()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        with mock.patch("payments.views.handle_event", side_effect=slow_handle):
            threads = [threading.Thread(target=go, args=(i,)) for i in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=30)

        self.assertEqual(errors, [])
        self.assertEqual(len(calls), 1)
        self.assertCountEqual(
            results, [{"received": True, "handled": True}, {"received": True, "duplicate": True}]
        )
        self.assertEqual(self.state(), ("confirmed", "paid"))



# --------------------------------------------------------------------------
# Step 4: stale holds (missed webhooks) and status changes with a payment page open
# --------------------------------------------------------------------------

from django.core.management import call_command  # noqa: E402
from io import StringIO  # noqa: E402


def stale(booking):
    """Make the hold look as if its time ran out and no webhook came."""
    Payment.objects.filter(booking=booking).update(expires_at=timezone.now() - timedelta(minutes=1))


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class StaleHoldTests(CheckoutFixtures, APITestCase):
    def other_books_same_dates(self):
        self.client.force_authenticate(self.other)
        today = timezone.localdate()
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": (today + timedelta(days=10)).isoformat(),
            "check_out": (today + timedelta(days=13)).isoformat(), "guests": 1,
        }, format="json")
        self.client.force_authenticate(self.guest)
        return res.status_code

    def state(self, booking):
        booking.refresh_from_db()
        return booking.status, Payment.objects.get(booking=booking).status

    def test_hold_without_session_is_released_directly(self):
        booking, _ = self.book_via_api()
        stale(booking)
        self.assertEqual(self.other_books_same_dates(), 201)
        self.assertEqual(self.state(booking), ("cancelled", "expired"))
        self.sessions.expire.assert_not_called()  # never went to checkout: nothing to ask
        self.sessions.retrieve.assert_not_called()

    def test_hold_expired_at_stripe_is_released(self):
        booking, _ = self.book_via_api()
        self.client.post(checkout_url(booking.pk))
        stale(booking)
        self.assertEqual(self.other_books_same_dates(), 201)
        self.sessions.expire.assert_called_once_with("cs_test_123")
        self.assertEqual(self.state(booking), ("cancelled", "expired"))

    def test_hold_that_was_actually_paid_keeps_its_dates(self):
        booking, _ = self.book_via_api()
        self.client.post(checkout_url(booking.pk))
        stale(booking)
        self.sessions.expire.side_effect = stripe.InvalidRequestError("not open", "session")
        self.sessions.retrieve.return_value = fake_session(status="complete", payment_status="paid")
        self.assertEqual(self.other_books_same_dates(), 409)
        self.assertEqual(self.state(booking), ("confirmed", "paid"))

    def test_stripe_unreachable_leaves_the_hold_alone(self):
        booking, _ = self.book_via_api()
        self.client.post(checkout_url(booking.pk))
        stale(booking)
        self.sessions.expire.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.services", "WARNING"):
            self.assertEqual(self.other_books_same_dates(), 409)
        self.assertEqual(self.state(booking), ("pending", "open"))

    def test_live_hold_is_not_touched(self):
        booking, _ = self.book_via_api()
        self.client.post(checkout_url(booking.pk))
        self.assertEqual(self.other_books_same_dates(), 409)
        self.sessions.expire.assert_not_called()
        self.assertEqual(self.state(booking), ("pending", "open"))

    def test_pay_now_on_a_stale_hold_tells_the_truth(self):
        booking, _ = self.book_via_api()
        self.client.post(checkout_url(booking.pk))
        stale(booking)
        self.sessions.expire.side_effect = stripe.InvalidRequestError("not open", "session")
        self.sessions.retrieve.return_value = fake_session(status="complete", payment_status="paid")
        res = self.client.post(checkout_url(booking.pk))
        self.assertEqual((res.status_code, res.data["code"]), (409, "already_confirmed"))
        self.assertEqual(self.state(booking), ("confirmed", "paid"))

    def test_management_command_settles_all_stale_holds(self):
        no_session, _ = self.book_via_api(10, 12)
        with_session, _ = self.book_via_api(20, 22)
        live, _ = self.book_via_api(30, 32)
        self.client.post(checkout_url(with_session.pk))
        stale(no_session)
        stale(with_session)
        out = StringIO()
        call_command("release_stale_holds", stdout=out)
        self.assertIn("Settled 2 stale hold(s); 0 couldn't be checked.", out.getvalue())
        self.assertEqual(self.state(no_session), ("cancelled", "expired"))
        self.assertEqual(self.state(with_session), ("cancelled", "expired"))
        self.assertEqual(self.state(live), ("pending", "open"))


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class StatusChangeWithPaymentTests(WebhookFixtures, APITestCase):
    """setUp: self.booking is pending with an open payment page (cs_test_123)."""

    def patch(self, status_, user=None, booking=None):
        self.client.force_authenticate(user or self.guest)
        return self.client.patch(reverse("booking-detail", args=[(booking or self.booking).pk]),
                                 {"status": status_}, format="json")

    def test_guest_cancel_closes_the_payment_page_first(self):
        res = self.patch("cancelled")
        self.assertEqual(res.status_code, 200, res.data)
        self.sessions.expire.assert_called_once_with("cs_test_123")
        self.assertEqual(self.state(), ("cancelled", "cancelled"))
        self.assertEqual(res.data["payment"]["status"], "cancelled")
        # Stripe's own "expired" event for that page arrives later: no change.
        self.deliver(session_event("checkout.session.expired", "cs_test_123", payment_status="unpaid"))
        self.assertEqual(self.state(), ("cancelled", "cancelled"))

    def test_admin_confirm_by_hand_closes_the_payment_page(self):
        res = self.patch("confirmed", user=self.admin)
        self.assertEqual(res.status_code, 200, res.data)
        self.sessions.expire.assert_called_once_with("cs_test_123")
        self.assertEqual(self.state(), ("confirmed", "cancelled"))

    def test_cancel_just_after_the_guest_paid(self):
        self.sessions.expire.side_effect = stripe.InvalidRequestError("not open", "session")
        self.sessions.retrieve.return_value = fake_session(status="complete", payment_status="paid")
        res = self.patch("cancelled")
        self.assertEqual((res.status_code, res.data["code"]), (409, "payment_completed"))
        self.assertEqual(self.state(), ("confirmed", "paid"))  # recorded right away, not lost

    def test_cancel_just_after_a_delayed_payment_started(self):
        self.sessions.expire.side_effect = stripe.InvalidRequestError("not open", "session")
        self.sessions.retrieve.return_value = fake_session(status="complete", payment_status="unpaid")
        res = self.patch("cancelled")
        self.assertEqual((res.status_code, res.data["code"]), (409, "payment_processing"))
        self.assertEqual(self.state(), ("pending", "processing"))

    def test_no_cancelling_while_a_payment_is_processing(self):
        Payment.objects.filter(booking=self.booking).update(status=Payment.Status.PROCESSING)
        detail = self.client.get(reverse("booking-detail", args=[self.booking.pk])).data
        self.assertFalse(detail["can_cancel"])
        for user in (self.guest, self.admin):
            res = self.patch("cancelled", user=user)
            self.assertEqual((res.status_code, res.data["code"]), (409, "payment_processing"))
        self.sessions.expire.assert_not_called()
        self.assertEqual(self.state(), ("pending", "processing"))

    def test_stripe_unreachable_means_no_cancel(self):
        self.sessions.expire.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.services", "ERROR"), self.assertLogs("django.request", "ERROR"):
            res = self.patch("cancelled")
        self.assertEqual((res.status_code, res.data["code"]), (502, "payment_provider_error"))
        self.assertEqual(self.state(), ("pending", "open"))  # the page may still take money

    def test_cancel_before_checkout_needs_no_stripe(self):
        other, _ = self.book_via_api(20, 22)  # never went to checkout
        res = self.patch("cancelled", booking=other)
        self.assertEqual(res.status_code, 200)
        self.sessions.expire.assert_not_called()
        self.assertEqual(Payment.objects.get(booking=other).status, Payment.Status.CANCELLED)

    def test_refused_change_never_touches_stripe(self):
        res = self.patch("confirmed")  # guests can't confirm
        self.assertEqual(res.status_code, 400)
        self.sessions.expire.assert_not_called()

    def test_payment_page_opened_mid_cancel(self):
        other, _ = self.book_via_api(20, 22)

        def opened_meanwhile(booking_id):
            Payment.objects.filter(booking_id=booking_id).update(stripe_checkout_session_id="cs_test_new")
            return None  # at close time there was nothing to close

        with mock.patch("bookings.views.close_checkout_for_status_change", side_effect=opened_meanwhile):
            res = self.patch("cancelled", booking=other)
        self.assertEqual((res.status_code, res.data["code"]), (409, "checkout_just_opened"))
        other.refresh_from_db()
        self.assertEqual(other.status, Booking.Status.PENDING)

    def test_cancelling_a_paid_booking_keeps_the_payment(self):
        self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        res = self.patch("cancelled")
        self.assertEqual(res.status_code, 200)
        self.sessions.expire.assert_not_called()
        self.assertEqual(self.state(), ("cancelled", "paid"))  # still paid; the refund is tracked beside it
        self.assertEqual(res.data["payment"]["refund"]["status"], "pending")

    def test_payments_switched_off_with_a_page_open(self):
        with override_settings(PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY=""), \
                mock.patch("payments.services.get_client", side_effect=services.PaymentsDisabled), \
                self.assertLogs("payments.services", "WARNING"):
            res = self.patch("cancelled")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.state(), ("cancelled", "cancelled"))



class PaymentsConfigTests(APITestCase):
    @override_settings(**PAYMENTS_ON)
    def test_on(self):
        res = self.client.get(reverse("payments-config"))
        self.assertEqual(res.json(), {"enabled": True, "hold_minutes": 30, "currency": "eur"})
        self.assertNotIn("rk_test", res.content.decode())  # never leaks a key

    @override_settings(PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY="")
    def test_off_and_public(self):
        res = self.client.get(reverse("payments-config"))  # no login needed
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["enabled"])


# --------------------------------------------------------------------------
# TICKET-040 step 1: refunds when a paid booking is cancelled
# (Stripe is mocked; the webhook that confirms refunds is step 2.)
# --------------------------------------------------------------------------

from payments import refunds as refund_service  # noqa: E402


@override_settings(**{**PAYMENTS_ON, "STRIPE_WEBHOOK_SECRET": WEBHOOK_SECRET})
class RefundOnCancelTests(WebhookFixtures, APITestCase):
    """setUp: self.booking is paid and confirmed (PaymentIntent pi_test_123)."""

    def setUp(self):
        super().setUp()
        self.deliver(session_event("checkout.session.completed", "cs_test_123"))
        self.assertEqual(self.state(), ("confirmed", "paid"))

    def cancel(self, user=None):
        self.client.force_authenticate(user or self.guest)
        return self.client.patch(reverse("booking-detail", args=[self.booking.pk]),
                                 {"status": "cancelled"}, format="json")

    def payment(self):
        return Payment.objects.get(booking=self.booking)

    def test_guest_cancel_refunds_the_full_amount(self):
        res = self.cancel()
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.state(), ("cancelled", "paid"))
        payment = self.payment()
        self.assertEqual((payment.refund_status, payment.refund_amount, payment.stripe_refund_id),
                         ("pending", payment.amount, "re_test_1"))
        self.assertIsNotNone(payment.refund_requested_at)
        self.refunds.create.assert_called_once_with(
            params={"payment_intent": "pi_test_123", "reason": "requested_by_customer",
                    "metadata": {"booking_id": str(self.booking.pk), "payment_id": str(payment.pk)}},
            options={"idempotency_key": f"booking-{self.booking.pk}-refund-1"},
        )
        refund = res.data["payment"]["refund"]
        self.assertEqual((refund["status"], refund["amount"], refund["refunded_at"]),
                         ("pending", "240.15", None))
        self.assertNotIn("failure_reason", refund)  # guests never see why

    def test_admin_cancel_inside_the_deadline_still_refunds(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        Booking.objects.filter(pk=self.booking.pk).update(check_in=tomorrow, check_out=tomorrow + timedelta(days=3))
        self.assertEqual(self.cancel().status_code, 400)  # guest: too late (TICKET-015)
        self.refunds.create.assert_not_called()
        res = self.cancel(self.admin)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.payment().refund_status, "pending")
        self.refunds.create.assert_called_once()

    def test_unpaid_booking_needs_no_refund(self):
        other, _ = self.book_via_api(20, 22)
        self.client.force_authenticate(self.guest)
        res = self.client.patch(reverse("booking-detail", args=[other.pk]), {"status": "cancelled"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["payment"]["refund"])
        self.refunds.create.assert_not_called()

    def test_stripe_unreachable_never_blocks_the_cancel(self):
        self.refunds.create.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.refunds", "ERROR"):
            res = self.cancel()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.state(), ("cancelled", "paid"))
        payment = self.payment()
        self.assertEqual((payment.refund_status, payment.refund_attempt, payment.stripe_refund_id),
                         ("failed", 1, ""))
        self.assertEqual(payment.refund_failure_reason, "Couldn't reach Stripe.")
        self.assertEqual(res.data["payment"]["refund"]["status"], "failed")

    def test_key_without_refund_permission(self):
        self.refunds.create.side_effect = stripe.PermissionError("no")
        with self.assertLogs("payments.refunds", "ERROR"):
            self.cancel()
        payment = self.payment()
        self.assertEqual(payment.refund_status, "failed")
        self.assertIn("Charges and Refunds: Write", payment.refund_failure_reason)

    def test_payments_switched_off_marks_it_failed(self):
        with mock.patch("payments.refunds.get_client", side_effect=services.PaymentsDisabled):
            res = self.cancel()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.payment().refund_status, "failed")

    def test_no_payment_intent_recorded(self):
        Payment.objects.filter(booking=self.booking).update(stripe_payment_intent_id="")
        self.cancel()
        self.refunds.create.assert_not_called()
        payment = self.payment()
        self.assertEqual(payment.refund_status, "failed")
        self.assertIn("No Stripe payment", payment.refund_failure_reason)

    def test_stripe_reports_the_refund_failed_next_try_is_a_new_refund(self):
        self.refunds.create.return_value = fake_refund(status="failed", failure_reason="expired_or_canceled_card")
        self.cancel()
        payment = self.payment()
        self.assertEqual((payment.refund_status, payment.refund_attempt, payment.stripe_refund_id),
                         ("failed", 2, "re_test_1"))
        self.assertEqual(payment.refund_failure_reason, "expired_or_canceled_card")
        # a retry is a genuinely new refund: new key, old id cleared
        self.refunds.create.return_value = fake_refund("re_test_2")
        with transaction.atomic():
            self.assertTrue(refund_service.request_refund(Payment.objects.select_for_update().get(pk=payment.pk)))
        refund_service.send_refund(self.booking.pk)
        self.assertEqual(self.refunds.create.call_args.kwargs["options"],
                         {"idempotency_key": f"booking-{self.booking.pk}-refund-2"})
        payment.refresh_from_db()
        self.assertEqual((payment.refund_status, payment.stripe_refund_id), ("pending", "re_test_2"))

    def test_retry_after_stripe_was_unreachable_repeats_the_same_request(self):
        self.refunds.create.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.refunds", "ERROR"):
            self.cancel()
        self.refunds.create.side_effect = None
        payment = self.payment()
        self.assertTrue(refund_service.request_refund(payment))
        refund_service.send_refund(self.booking.pk)
        keys = [c.kwargs["options"]["idempotency_key"] for c in self.refunds.create.call_args_list]
        self.assertEqual(keys, [f"booking-{self.booking.pk}-refund-1"] * 2)  # same key: never twice
        self.assertEqual(self.payment().refund_status, "pending")

    def test_never_refunded_twice(self):
        self.cancel()
        payment = self.payment()
        self.assertFalse(refund_service.request_refund(payment))  # already pending
        refund_service.send_refund(self.booking.pk)  # already sent
        Payment.objects.filter(pk=payment.pk).update(refund_status=Payment.RefundStatus.REFUNDED)
        self.assertFalse(refund_service.request_refund(self.payment()))
        self.refunds.create.assert_called_once()

    def test_admin_sees_why_a_refund_failed(self):
        self.refunds.create.side_effect = stripe.APIConnectionError("down")
        with self.assertLogs("payments.refunds", "ERROR"):
            self.cancel()
        self.client.force_authenticate(self.admin)
        refund = self.client.get(reverse("booking-detail", args=[self.booking.pk])).data["payment"]["refund"]
        self.assertEqual((refund["status"], refund["failure_reason"]), ("failed", "Couldn't reach Stripe."))
        self.client.force_authenticate(self.guest)
        refund = self.client.get(reverse("booking-detail", args=[self.booking.pk])).data["payment"]["refund"]
        self.assertNotIn("failure_reason", refund)
