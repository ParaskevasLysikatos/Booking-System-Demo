"""Tests for the deploy-related bits in core (TICKET-026): the seed command's
--if-empty flag used by the Render build, and the health check not leaking
database details in production."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

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
