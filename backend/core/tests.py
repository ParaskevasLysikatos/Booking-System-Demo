"""Tests for the deploy-related bits in core (TICKET-026): the seed command's
--if-empty flag used by the Render build, and the health check not leaking
database details in production."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from django.contrib.auth.models import User

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
        return User.objects.filter(username__startswith="guest_").order_by("username")

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
        self.assertFalse(Favorite.objects.filter(user__username="admin_demo").exists())

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
