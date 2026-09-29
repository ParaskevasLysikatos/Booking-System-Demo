"""Tests for the deploy-related bits in core (TICKET-026): the seed command's
--if-empty flag used by the Render build, and the health check not leaking
database details in production."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from django.contrib.auth.models import User

from core.demo_accounts import DEMO_ADMIN_USERNAME, demo_guest_users
from favorites.models import Favorite
from listings.models import Property


class SeedIfEmptyTests(TestCase):
    def seed(self, *args):
        out = StringIO()
        call_command("seed_demo_data", "--properties", "2", "--guests", "2", "--seed", "1", *args, stdout=out)
        return out.getvalue()

    def test_seeds_an_empty_database(self):
        self.seed("--if-empty")
        self.assertEqual(Property.objects.count(), 2)

    def test_skips_when_any_property_exists(self):
        self.seed()
        before = list(Property.objects.values_list("id", flat=True))
        out = self.seed("--if-empty")
        self.assertIn("skipping", out)
        # nothing wiped, nothing duplicated
        self.assertEqual(list(Property.objects.values_list("id", flat=True)), before)


class SeedFavoritesTests(TestCase):
    """TICKET-033: the seeder gives demo guests saved places."""

    def seed(self, *args):
        call_command("seed_demo_data", "--properties", "8", "--guests", "3", "--seed", "7", *args, stdout=StringIO())

    def guests(self):
        return demo_guest_users().order_by("username")

    def test_every_guest_saves_two_to_five_active_places(self):
        self.seed()
        for guest in self.guests():
            active = Favorite.objects.filter(user=guest, property__is_active=True).count()
            self.assertTrue(2 <= active <= 5, (guest.username, active))

    def test_first_guest_keeps_one_retired_place_saved(self):
        self.seed()
        first = self.guests().first()
        self.assertEqual(Favorite.objects.filter(user=first, property__is_active=False).count(), 1)
        self.assertTrue(Property.objects.filter(is_active=False).exists())

    def test_admin_has_no_favorites(self):
        self.seed()
        self.assertFalse(Favorite.objects.filter(user__username=DEMO_ADMIN_USERNAME).exists())

    def test_clear_removes_old_favorites(self):
        self.seed()
        old_ids = set(Favorite.objects.values_list("id", flat=True))
        self.seed("--clear")
        self.assertFalse(old_ids & set(Favorite.objects.values_list("id", flat=True)))
        self.assertTrue(Favorite.objects.exists())


class HealthCheckTests(TestCase):
    URL = "/api/health/"

    def test_connected(self):
        self.assertEqual(self.client.get(self.URL).json(), {"status": "ok", "database": "connected"})

    def broken_db(self):
        return mock.patch("core.views.connection.cursor", side_effect=Exception("could not connect to host secret-db.internal"))

    @override_settings(DEBUG=True)
    def test_debug_shows_the_database_error(self):
        with self.broken_db():
            self.assertIn("secret-db.internal", self.client.get(self.URL).json()["database"])

    @override_settings(DEBUG=False)
    def test_production_hides_the_database_error(self):
        with self.broken_db(), self.assertLogs("core.views", level="ERROR") as logs:
            body = self.client.get(self.URL).json()
        self.assertEqual(body["database"], "error")
        self.assertIn("secret-db.internal", logs.output[0])  # still visible in the server logs


class SeedCoordinatesTests(TestCase):
    """TICKET-034: seeded places get a map position near their city."""

    def test_every_seeded_property_is_near_its_city(self):
        from listings import geo

        call_command("seed_demo_data", "--properties", "12", "--guests", "1", "--seed", "5", stdout=StringIO())
        for prop in Property.objects.all():
            lat, lng, radius = geo.CITY_CENTRES[geo.city_for(prop.location)]
            self.assertIsNotNone(prop.latitude, prop.location)
            self.assertLessEqual(geo.distance_metres(lat, lng, prop.latitude, prop.longitude), radius + 1)


class SeedPhotosTests(TestCase):
    """TICKET-037: with S3 configured the seeder uses the seed photos in the
    bucket, matched to the property type; without it, picsum."""

    S3_ON = dict(
        AWS_ACCESS_KEY_ID="AKIATESTKEY", AWS_SECRET_ACCESS_KEY="test-secret",
        AWS_S3_BUCKET="demo-bucket", AWS_S3_REGION="eu-central-1", AWS_S3_PUBLIC_BASE_URL="",
    )
    S3_OFF = dict(S3_ON, AWS_ACCESS_KEY_ID="", AWS_SECRET_ACCESS_KEY="", AWS_S3_BUCKET="", AWS_S3_REGION="")
    SEED_BASE = "https://demo-bucket.s3.eu-central-1.amazonaws.com/property-images/seed/"

    def seed(self):
        out = StringIO()
        call_command("seed_demo_data", "--properties", "14", "--guests", "2", "--seed", "3", stdout=out)
        return out.getvalue()

    @staticmethod
    def kind(prop):
        return prop.title.split(" in ")[0].split()[-1]  # "Cozy Villa in Chania" -> "Villa"

    def test_s3_seed_photos_match_the_property_type(self):
        from core.management.commands.seed_demo_data import PHOTO_GROUPS
        from uploads import seed

        on_disk = {p.name for p in seed.seed_files()}
        with override_settings(**self.S3_ON):
            out = self.seed()
        self.assertIn("Photos: S3 seed photos", out)
        for prop in Property.objects.prefetch_related("images"):
            images = list(prop.images.order_by("id"))
            names = [img.image[len(self.SEED_BASE):] for img in images]
            with self.subTest(prop.title):
                self.assertTrue(all(img.image.startswith(self.SEED_BASE) for img in images))
                self.assertTrue(set(names) <= on_disk)
                self.assertTrue(3 <= len(images) <= 5)
                self.assertEqual(len(set(names)), len(names))           # no photo twice
                self.assertEqual([img.is_cover for img in images], [True] + [False] * (len(images) - 1))
                cover_groups = PHOTO_GROUPS[self.kind(prop)][0]
                self.assertIn(names[0].rsplit("-", 1)[0], cover_groups)  # e.g. a villa's cover is a villa-*

    def test_covers_are_spread_out(self):
        with override_settings(**self.S3_ON):
            self.seed()
        covers = [p.images.get(is_cover=True).image for p in Property.objects.all()]
        self.assertGreaterEqual(len(set(covers)), 10)  # 14 properties, few repeats

    def test_falls_back_to_picsum_without_s3(self):
        with override_settings(**self.S3_OFF):
            out = self.seed()
        self.assertIn("Photos: picsum.photos", out)
        for prop in Property.objects.all():
            images = list(prop.images.all())
            with self.subTest(prop.title):
                self.assertTrue(3 <= len(images) <= 5)
                self.assertTrue(all(img.image.startswith("https://picsum.photos/seed/") for img in images))
                self.assertEqual(sum(img.is_cover for img in images), 1)


class SeedReviewsTests(TestCase):
    """TICKET-037: 4-8 reviews per property, each backed by a real ended,
    confirmed stay, a mix of ratings, some without a comment - and every
    guest keeps one ended stay to review live."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo_data", "--properties", "8", "--guests", "10", "--seed", "11", stdout=StringIO())

    def test_every_property_has_four_to_ten_reviews(self):
        from reviews.models import Review

        for prop in Property.objects.all():
            with self.subTest(prop.title):
                # 4-8 targeted; stays from the general booking mix can add a few (max: one per guest).
                self.assertTrue(4 <= Review.objects.filter(property=prop).count() <= 10)

    def test_every_review_is_backed_by_an_ended_confirmed_stay(self):
        from django.utils import timezone

        from bookings.models import Booking
        from reviews.models import Review

        today = timezone.localdate()
        for review in Review.objects.all():
            stays = Booking.objects.filter(
                property=review.property, guest=review.guest,
                status=Booking.Status.CONFIRMED, check_out__lte=today,
            )
            with self.subTest(review.pk):
                self.assertTrue(stays.exists())
                # Written after the stay began, never in the future.
                self.assertGreaterEqual(review.created_at.date(), min(s.check_in for s in stays))
                self.assertLessEqual(review.created_at, timezone.now())

    def test_mix_of_ratings_and_some_without_a_comment(self):
        from reviews.models import Review

        ratings = list(Review.objects.values_list("rating", flat=True))
        comments = list(Review.objects.values_list("comment", flat=True))
        self.assertTrue(any(r <= 3 for r in ratings))
        self.assertTrue(any(r == 5 for r in ratings))
        blank = sum(1 for c in comments if not c)
        self.assertTrue(0 < blank < len(comments) / 2, (blank, len(comments)))
        self.assertGreaterEqual(len({c for c in comments if c}), 10)  # varied texts

    def test_every_guest_can_still_write_one_review(self):
        from django.utils import timezone

        from bookings.models import Booking
        from reviews.models import Review

        today = timezone.localdate()
        for guest in demo_guest_users():
            ended = Booking.objects.filter(guest=guest, status=Booking.Status.CONFIRMED, check_out__lte=today)
            reviewed = set(Review.objects.filter(guest=guest).values_list("property_id", flat=True))
            with self.subTest(guest.username):
                self.assertTrue(ended.exclude(property_id__in=reviewed).filter(property__is_active=True).exists())

    def test_no_overlapping_stays(self):
        from bookings.models import Booking

        for booking in Booking.objects.exclude(status=Booking.Status.CANCELLED):
            with self.subTest(booking.pk):
                self.assertFalse(
                    Booking.objects.overlapping(booking.property, booking.check_in, booking.check_out)
                    .exclude(pk=booking.pk).exists()
                )


class SeedDemoLoginsTests(TestCase):
    """TICKET-041: simple, fixed demo logins - admin@demo.com / admin123 and
    guest1@demo.com ... guestN@demo.com / guest123 - and --clear removing
    both these and the old-style accounts, never real ones."""

    def seed(self, *args, guests=3):
        out = StringIO()
        call_command(
            "seed_demo_data", "--properties", "3", "--guests", str(guests), "--seed", "2", *args, stdout=out
        )
        return out.getvalue()

    def api_login(self, email, password):
        from django.urls import reverse

        return self.client.post(
            reverse("auth-login"), {"email": email, "password": password}, content_type="application/json"
        )

    def test_guests_are_numbered_with_one_shared_password(self):
        out = self.seed()
        emails = sorted(demo_guest_users().values_list("email", flat=True))
        self.assertEqual(emails, ["guest1@demo.com", "guest2@demo.com", "guest3@demo.com"])
        for guest in demo_guest_users():
            with self.subTest(guest.email):
                self.assertEqual(guest.username, guest.email)  # same rule as sign-up
                self.assertTrue(guest.first_name and guest.last_name)  # Faker names
                self.assertTrue(guest.check_password("guest123"))
                self.assertFalse(guest.is_staff)
                self.assertEqual(guest.profile.role, "guest")
        self.assertIn("guest1@demo.com ... guest3@demo.com / guest123", out)

    def test_guest_logs_in_through_the_api(self):
        self.seed()
        resp = self.api_login("guest2@demo.com", "guest123")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["user"]["role"], "guest")

    def test_admin_logs_in_to_the_api_and_django_admin(self):
        out = self.seed()
        admin = User.objects.get(email="admin@demo.com")
        self.assertEqual(admin.username, "admin")
        self.assertTrue(admin.is_superuser)
        self.assertEqual(admin.profile.role, "admin")
        resp = self.api_login("admin@demo.com", "admin123")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["user"]["role"], "admin")
        self.assertTrue(self.client.login(username="admin", password="admin123"))
        self.assertIn("admin@demo.com / admin123", out)

    def test_rerun_without_clear_reuses_the_accounts(self):
        self.seed()
        first_ids = set(demo_guest_users().values_list("id", flat=True))
        out = self.seed()  # no IntegrityError on the fixed usernames
        self.assertEqual(set(demo_guest_users().values_list("id", flat=True)), first_ids)
        self.assertEqual(User.objects.filter(email="admin@demo.com").count(), 1)
        self.assertIn("left untouched", out)

    def test_clear_removes_old_style_and_current_demo_accounts_only(self):
        # What the old seeder left behind (before TICKET-041).
        User.objects.create_superuser("admin_demo", "admin_demo@example.com", "AdminPass123!")
        User.objects.create_user("guest_0_jdoe", "guest_0_jdoe@example.com", "DemoPass123!")
        # Real accounts: a sign-up and an owner's own superuser.
        User.objects.create_user("maria@example.com", "maria@example.com", "S3cure-Booking-Pass!")
        User.objects.create_superuser("owner", "owner@gmail.com", "S3cure-Booking-Pass!")
        self.seed(guests=4)
        self.seed("--clear", guests=2)

        self.assertFalse(User.objects.filter(username__in=["admin_demo", "guest_0_jdoe"]).exists())
        self.assertEqual(
            sorted(demo_guest_users().values_list("email", flat=True)),
            ["guest1@demo.com", "guest2@demo.com"],  # guest3/guest4 from the first run are gone
        )
        self.assertEqual(User.objects.filter(email="admin@demo.com").count(), 1)
        self.assertTrue(User.objects.filter(username="maria@example.com").exists())
        self.assertTrue(User.objects.filter(username="owner").exists())

    def test_an_owner_superuser_called_admin_is_never_touched(self):
        owner = User.objects.create_superuser("admin", "owner@gmail.com", "S3cure-Booking-Pass!")
        out = self.seed()
        self.assertIn("already uses the username 'admin'", out)
        self.seed("--clear")
        owner.refresh_from_db()  # still there, unchanged
        self.assertEqual(owner.email, "owner@gmail.com")
        self.assertTrue(owner.check_password("S3cure-Booking-Pass!"))
        self.assertFalse(User.objects.filter(email="admin@demo.com").exists())
