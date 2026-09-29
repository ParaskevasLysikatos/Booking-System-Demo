"""TICKET-038 step 6: the API answers in the language the app asks for.

The Angular app sends `Accept-Language: el` (Greek) or `en` with every API
call. Our own messages, Django's (password rules) and DRF's ("This field is
required.") then come back in that language; no header -> English, exactly
as before. The Django Admin and booking emails stay English.
"""
import re
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone, translation
from rest_framework import status
from rest_framework.test import APITestCase

from bookings.models import Booking
from core.middleware import language_from_header
from listings.models import Property
from notifications.messages import build_message
from notifications.models import BookingEmail

User = get_user_model()
PASSWORD = "S3cure-Booking-Pass!"
GREEK = re.compile(r"[Ͱ-Ͽ]")
EL = {"HTTP_ACCEPT_LANGUAGE": "el"}


def day(n):
    return timezone.localdate() + timedelta(days=n)


class HeaderTests(SimpleTestCase):
    """Which language a header asks for."""

    def lang(self, header):
        class Request:
            META = {"HTTP_ACCEPT_LANGUAGE": header} if header is not None else {}
        return language_from_header(Request)

    def test_supported_languages(self):
        self.assertEqual(self.lang("el"), "el")
        self.assertEqual(self.lang("el-GR,el;q=0.9,en;q=0.8"), "el")  # a browser's own header
        self.assertEqual(self.lang("en"), "en")
        self.assertEqual(self.lang("en-US"), "en")

    def test_first_supported_by_quality(self):
        self.assertEqual(self.lang("fr, el;q=0.5"), "el")
        self.assertEqual(self.lang("en;q=0.4, el;q=0.8"), "el")

    def test_anything_else_is_english(self):
        for header in (None, "", "fr", "de-DE,de;q=0.9", "*", "garbage;;q=x"):
            with self.subTest(header=header):
                self.assertEqual(self.lang(header), "en")


class ApiLanguageTests(APITestCase):
    def setUp(self):
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.prop = Property.objects.create(
            title="Loft", location="Thessaloniki", price_per_night=Decimal("80.00"), capacity=3
        )

    def book(self, **headers):
        return self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": day(10).isoformat(),
            "check_out": day(13).isoformat(), "guests": 2,
        }, format="json", **headers)

    def test_headers_on_api_answers(self):
        res = self.client.get(reverse("property-list"), **EL)
        self.assertEqual(res["Content-Language"], "el")
        self.assertIn("Accept-Language", res["Vary"])
        self.assertEqual(self.client.get(reverse("property-list"))["Content-Language"], "en")

    def test_our_message_in_greek_and_english(self):
        """The dates-taken clash (409): Greek with the header, unchanged English without."""
        Booking.objects.create(property=self.prop, guest=self.guest, check_in=day(10), check_out=day(12),
                               total_price=Decimal("160.00"))
        self.client.force_authenticate(self.guest)
        greek = self.book(**EL)
        self.assertEqual(greek.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(greek.json()["detail"],
                         "Αυτές οι ημερομηνίες δεν είναι πλέον διαθέσιμες για αυτό το κατάλυμα.")
        self.assertEqual(greek.json()["code"], "dates_unavailable")  # codes never change
        english = self.book()
        self.assertEqual(english.json()["detail"], "These dates are no longer available for this property.")

    def test_field_messages_with_numbers_and_plurals(self):
        self.client.force_authenticate(self.guest)
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": day(10).isoformat(),
            "check_out": day(60).isoformat(), "guests": 9,
        }, format="json", **EL)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.json()["check_out"], ["Η διαμονή μπορεί να είναι έως 30 νύχτες."])
        self.assertEqual(res.json()["guests"], ["Αυτό το κατάλυμα φιλοξενεί έως 3 άτομα."])

        self.prop.capacity = 1
        self.prop.save()
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": day(10).isoformat(),
            "check_out": day(12).isoformat(), "guests": 2,
        }, format="json", **EL)
        self.assertEqual(res.json()["guests"], ["Αυτό το κατάλυμα φιλοξενεί έως 1 άτομο."])
        res = self.client.post(reverse("booking-list"), {
            "property": self.prop.id, "check_in": day(10).isoformat(),
            "check_out": day(12).isoformat(), "guests": 2,
        }, format="json")
        self.assertEqual(res.json()["guests"], ["This property sleeps at most 1 guest."])

    def test_status_words_inside_a_sentence(self):
        booking = Booking.objects.create(property=self.prop, guest=self.guest, check_in=day(10),
                                         check_out=day(12), total_price=Decimal("160.00"),
                                         status=Booking.Status.CANCELLED)
        self.client.force_authenticate(self.guest)
        res = self.client.patch(reverse("booking-detail", args=[booking.pk]), {"status": "cancelled"},
                                format="json", **EL)
        self.assertEqual(res.json()["status"], ["Η κράτηση είναι ήδη ακυρωμένη."])
        res = self.client.patch(reverse("booking-detail", args=[booking.pk]), {"status": "cancelled"},
                                format="json")
        self.assertEqual(res.json()["status"], ["Booking is already cancelled."])

    def test_django_and_drf_messages_in_greek(self):
        """Texts we never wrote - Django's password rules, DRF's "required" - come
        in Greek from their own translations."""
        res = self.client.post(reverse("auth-register"), {"email": "new@example.com", "password": "123"},
                               format="json", **EL)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(res.json()["password"])
        for message in res.json()["password"]:
            self.assertRegex(message, GREEK)
        res = self.client.post(reverse("auth-register"), {}, format="json", **EL)
        self.assertRegex(res.json()["email"][0], GREEK)

    def test_duplicate_email_in_greek(self):
        res = self.client.post(reverse("auth-register"), {"email": "guest@example.com", "password": PASSWORD},
                               format="json", **EL)
        self.assertEqual(res.json()["email"], ["Υπάρχει ήδη λογαριασμός με αυτό το email."])

    def test_failed_login_in_greek(self):
        """simplejwt ships no Greek - its message lives in our catalog."""
        res = self.client.post(reverse("auth-login"), {"email": "guest@example.com", "password": "wrong"},
                               format="json", **EL)
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.json()["detail"], "Δεν βρέθηκε ενεργός λογαριασμός με αυτά τα στοιχεία")
        res = self.client.post(reverse("auth-login"), {"email": "guest@example.com", "password": "wrong"},
                               format="json")
        self.assertEqual(res.json()["detail"], "No active account found with the given credentials")

    def test_permission_message_in_greek(self):
        self.client.force_authenticate(self.guest)
        res = self.client.get(reverse("admin-stats"), **EL)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.json()["detail"], "Μόνο οι λογαριασμοί διαχειριστή μπορούν να κάνουν αυτή την ενέργεια.")

    def test_language_does_not_leak_into_the_next_request(self):
        self.client.force_authenticate(self.guest)
        self.client.get(reverse("admin-stats"), **EL)
        self.assertEqual(self.client.get(reverse("admin-stats")).json()["detail"],
                         "Only admin accounts can perform this action.")
        self.assertEqual(translation.get_language(), settings.LANGUAGE_CODE)

    @override_settings(PAYMENTS_ENABLED=False, STRIPE_SECRET_KEY="",
                       BOOKING_ALERT_EMAILS=[], DEFAULT_FROM_EMAIL="Demo <owner@example.com>")
    def test_booking_email_stays_english_for_a_greek_request(self):
        self.client.force_authenticate(self.guest)
        with self.captureOnCommitCallbacks(execute=True):
            res = self.book(**EL)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertNotRegex(message.subject, GREEK)
        self.assertNotRegex(message.body, GREEK)
        self.assertNotRegex(message.alternatives[0][0], GREEK)


class EmailLanguageTests(TestCase):
    def test_same_email_whatever_language_is_active(self):
        guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        prop = Property.objects.create(title="Loft", location="Thessaloniki",
                                       price_per_night=Decimal("80.00"), capacity=3)
        booking = Booking.objects.create(property=prop, guest=guest, check_in=day(10), check_out=day(13),
                                         total_price=Decimal("240.00"))
        row = BookingEmail.objects.create(booking=booking, kind=BookingEmail.Kind.BOOKING_RECEIVED,
                                          recipients="guest@example.com")
        english = build_message(row)
        with translation.override("el"):
            greek_request = build_message(row)
        self.assertEqual(greek_request.subject, english.subject)
        self.assertEqual(greek_request.body, english.body)
        self.assertEqual(greek_request.alternatives[0][0], english.alternatives[0][0])


class AdminStaysEnglishTests(TestCase):
    def test_django_admin_ignores_the_header(self):
        res = self.client.get("/admin/login/", HTTP_ACCEPT_LANGUAGE="el")
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, "Username")
        self.assertNotRegex(res.content.decode(), GREEK)
        self.assertNotIn("Content-Language", res)


class CatalogTests(SimpleTestCase):
    """The committed django.mo (what Django reads) matches django.po (what
    people edit): forgetting `compilemessages` after an edit fails here."""

    LOCALE = Path(settings.BASE_DIR) / "locale" / "el" / "LC_MESSAGES"

    @staticmethod
    def read_po(path):
        """msgid -> msgstr for a simple .po (what makemessages writes).
        Context entries are keyed "context\\x04msgid", plurals by msgid only
        (checked through their first form)."""
        entries, current, field = {}, {}, None

        def flush():
            if current.get("msgid"):
                key = current["msgid"]
                if "msgctxt" in current:
                    key = f'{current["msgctxt"]}\x04{key}'
                entries[key] = current.get("msgstr", current.get("msgstr[0]", ""))

        for line in path.read_text(encoding="utf-8").splitlines() + [""]:
            if not line.strip():
                flush()
                current, field = {}, None
            elif line.startswith("#"):
                continue
            elif line.startswith('"'):
                current[field] += bytes(line[1:-1], "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
            else:
                field, _, value = line.partition(" ")
                current[field] = bytes(value[1:-1], "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
        return entries

    def test_mo_matches_po(self):
        import gettext
        with open(self.LOCALE / "django.mo", "rb") as fh:
            catalog = gettext.GNUTranslations(fh)._catalog
        compiled = {(k[0] if isinstance(k, tuple) else k): v for k, v in catalog.items()
                    if not isinstance(k, tuple) or k[1] == 0}
        entries = self.read_po(self.LOCALE / "django.po")
        self.assertGreater(len(entries), 50)
        for msgid, msgstr in entries.items():
            with self.subTest(msgid=msgid):
                self.assertTrue(msgstr, "untranslated")
                self.assertEqual(compiled.get(msgid), msgstr, "run: python manage.py compilemessages")
