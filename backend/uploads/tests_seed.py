"""Seed photos in S3 (TICKET-037): the repo folder, the URLs, the
upload_seed_photos command, and that seed photos are never deleted."""
import io
import tempfile
import urllib.error
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from listings.models import PropertyImage

from . import s3, seed
from .signals import delete_if_unused
from .tests import S3_OFF, S3_ON, make_property

User = get_user_model()
BASE = "https://demo-bucket.s3.eu-central-1.amazonaws.com/"


class SeedFolderTests(SimpleTestCase):
    def test_repo_folder_holds_the_seed_photos(self):
        files = seed.seed_files()
        self.assertGreaterEqual(len(files), 30)
        for path in files:
            with self.subTest(path.name):
                data = path.read_bytes()
                self.assertEqual(data[:4], b"RIFF")          # WebP container
                self.assertEqual(data[8:12], b"WEBP")
                self.assertLess(len(data), 300 * 1024)       # pre-resized
        self.assertTrue((seed.seed_dir() / "CREDITS.md").is_file())

    def test_every_photo_is_credited(self):
        credits = (seed.seed_dir() / "CREDITS.md").read_text(encoding="utf-8")
        for path in seed.seed_files():
            with self.subTest(path.name):
                self.assertIn(f"`{path.name}`", credits)

    def test_only_seed_names_are_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("villa-02.webp", "villa-01.webp", "CREDITS.md", "Villa-03.webp",
                         "villa-1.webp", "villa-04.jpg", "notes.txt"):
                Path(tmp, name).write_bytes(b"x")
            Path(tmp, "loft-01.webp").mkdir()
            self.assertEqual([p.name for p in seed.seed_files(tmp)], ["villa-01.webp", "villa-02.webp"])

    def test_missing_folder_is_empty(self):
        self.assertEqual(seed.seed_files("/no/such/folder"), [])


@override_settings(**S3_ON)
class SeedUrlTests(SimpleTestCase):
    def test_fixed_readable_url(self):
        self.assertEqual(seed.seed_url("villa-01.webp"), BASE + "property-images/seed/villa-01.webp")

    @override_settings(AWS_S3_PUBLIC_BASE_URL="https://photos.example.com")
    def test_custom_public_base(self):
        self.assertEqual(seed.seed_url("loft-02.webp"), "https://photos.example.com/property-images/seed/loft-02.webp")

    def test_seed_photos_are_never_ours_to_delete(self):
        self.assertIsNone(s3.key_from_url(seed.seed_url("villa-01.webp")))


class RemoteSizeTests(SimpleTestCase):
    def _response(self, length):
        response = mock.MagicMock()
        response.headers = {"Content-Length": length} if length is not None else {}
        response.__enter__.return_value = response
        return response

    def test_size_of_an_existing_object(self):
        with mock.patch("urllib.request.urlopen", return_value=self._response("1234")) as urlopen:
            self.assertEqual(seed.remote_size(BASE + "property-images/seed/a-01.webp"), 1234)
        self.assertEqual(urlopen.call_args.args[0].get_method(), "HEAD")

    def test_missing_object_is_none(self):
        for code in (403, 404):
            error = urllib.error.HTTPError("u", code, "no", {}, io.BytesIO())
            with self.subTest(code), mock.patch("urllib.request.urlopen", side_effect=error):
                self.assertIsNone(seed.remote_size("https://x/y.webp"))

    def test_other_errors_raise(self):
        error = urllib.error.HTTPError("u", 500, "boom", {}, io.BytesIO())
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(OSError):
                seed.remote_size("https://x/y.webp")


@override_settings(**S3_ON)
class UploadSeedPhotosCommandTests(SimpleTestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for name, size in (("villa-01.webp", 100), ("villa-02.webp", 200), ("loft-01.webp", 300)):
            (self.dir / name).write_bytes(b"w" * size)
        (self.dir / "CREDITS.md").write_text("credits")
        patcher = mock.patch.object(s3, "_client")
        self.s3 = patcher.start().return_value
        self.addCleanup(patcher.stop)
        self.remote = {}  # key -> size in the "bucket"
        patcher = mock.patch.object(seed, "remote_size", side_effect=self._remote_size)
        self.head = patcher.start()
        self.addCleanup(patcher.stop)

    def _remote_size(self, url):
        return self.remote.get(url[len(BASE):])

    def run_command(self, *args):
        out, err = io.StringIO(), io.StringIO()
        call_command("upload_seed_photos", "--source", str(self.dir), *args, stdout=out, stderr=err)
        return out.getvalue()

    def put_keys(self):
        return [c.kwargs["Key"] for c in self.s3.put_object.call_args_list]

    def test_uploads_new_photos_with_fixed_keys(self):
        out = self.run_command()
        self.assertEqual(self.put_keys(), [
            "property-images/seed/loft-01.webp",
            "property-images/seed/villa-01.webp",
            "property-images/seed/villa-02.webp",
        ])
        call = self.s3.put_object.call_args_list[1].kwargs
        self.assertEqual(call["Bucket"], "demo-bucket")
        self.assertEqual(call["ContentType"], "image/webp")
        self.assertEqual(call["CacheControl"], seed.SEED_CACHE_CONTROL)
        self.assertEqual(call["Body"], b"w" * 100)
        self.assertIn("Uploaded 3, skipped 0, failed 0 of 3", out)

    def test_photos_already_there_are_skipped(self):
        self.remote = {"property-images/seed/villa-01.webp": 100, "property-images/seed/loft-01.webp": 300}
        out = self.run_command()
        self.assertEqual(self.put_keys(), ["property-images/seed/villa-02.webp"])
        self.assertIn("Uploaded 1, skipped 2", out)

    def test_changed_photo_is_uploaded_again(self):
        self.remote = {"property-images/seed/villa-01.webp": 999}
        out = self.run_command()
        self.assertIn("property-images/seed/villa-01.webp", self.put_keys())
        self.assertIn("changed (999 -> 100 bytes)", out)

    def test_force_uploads_everything_without_checking(self):
        self.remote = {f"property-images/seed/{p.name}": p.stat().st_size for p in self.dir.glob("*.webp")}
        self.run_command("--force")
        self.assertEqual(len(self.put_keys()), 3)
        self.head.assert_not_called()

    def test_dry_run_uploads_nothing(self):
        out = self.run_command("--dry-run")
        self.s3.put_object.assert_not_called()
        self.assertIn("Would upload 3", out)

    def test_check_failure_uploads_anyway(self):
        self.head.side_effect = OSError("timed out")
        self.run_command()
        self.assertEqual(len(self.put_keys()), 3)

    def test_one_failure_does_not_stop_the_rest(self):
        def put(**kwargs):
            if kwargs["Key"].endswith("villa-01.webp"):
                raise RuntimeError("AccessDenied")
        self.s3.put_object.side_effect = put
        with self.assertRaisesMessage(CommandError, "1 upload(s) failed: villa-01.webp"):
            self.run_command()
        self.assertEqual(len(self.put_keys()), 3)

    @override_settings(**S3_OFF)
    def test_refuses_when_uploads_are_off(self):
        with self.assertRaisesMessage(CommandError, "S3 uploads are off"):
            self.run_command()
        self.s3.put_object.assert_not_called()

    def test_empty_folder_is_an_error(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaisesMessage(CommandError, "No seed photos found"):
                call_command("upload_seed_photos", "--source", empty, stdout=io.StringIO())


@override_settings(**S3_ON)
class SharedSeedPhotoIsNeverDeletedTests(APITestCase):
    """The ticket's safety rule: several properties share a seed photo, and
    removing it from one (or deleting a property) must not delete it."""

    def setUp(self):
        self.admin = User.objects.create_superuser("admin", "admin@example.com", "S3cure-Booking-Pass!")
        self.client.force_authenticate(self.admin)
        self.url = seed.seed_url("villa-01.webp")
        self.other = seed.seed_url("villa-02.webp")
        self.a, self.b = make_property("Villa A"), make_property("Villa B")
        for prop in (self.a, self.b):
            PropertyImage.objects.create(property=prop, image=self.url, is_cover=True)
            PropertyImage.objects.create(property=prop, image=self.other)
        patcher = mock.patch.object(s3, "_client")
        self.s3 = patcher.start().return_value
        self.addCleanup(patcher.stop)

    def test_removing_it_from_one_property_deletes_nothing(self):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.patch(
                reverse("property-detail", args=[self.a.pk]),
                {"images": [{"image": self.other, "is_cover": True}]}, format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.a.images.count(), 1)
        self.s3.delete_object.assert_not_called()

    def test_even_when_no_property_uses_it_any_more(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.a.images.all().delete()
            self.b.images.all().delete()
        self.assertFalse(delete_if_unused(self.url))
        self.s3.delete_object.assert_not_called()
