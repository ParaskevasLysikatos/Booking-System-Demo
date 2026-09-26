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
