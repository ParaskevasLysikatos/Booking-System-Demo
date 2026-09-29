import base64
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from . import s3
from .checks import s3_settings_check

User = get_user_model()
PASSWORD = "S3cure-Booking-Pass!"
CONFIG_URL = reverse("upload-config")
PRESIGN_URL = reverse("upload-presign")

S3_ON = dict(
    AWS_ACCESS_KEY_ID="AKIATESTKEY",
    AWS_SECRET_ACCESS_KEY="test-secret-never-sent",
    AWS_S3_BUCKET="demo-bucket",
    AWS_S3_REGION="eu-central-1",
    AWS_S3_PUBLIC_BASE_URL="",
    UPLOADS_MAX_BYTES=10 * 1024 * 1024,
)
S3_OFF = dict(S3_ON, AWS_ACCESS_KEY_ID="", AWS_SECRET_ACCESS_KEY="", AWS_S3_BUCKET="", AWS_S3_REGION="")


def policy_of(upload):
    return json.loads(base64.b64decode(upload["fields"]["policy"]))


class UploadAPITestBase(APITestCase):
    def setUp(self):
        cache.clear()  # the throttle lives in the cache
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.client.force_authenticate(self.admin)

    def tearDown(self):
        cache.clear()

    def presign(self, content_type="image/webp", size=250_000):
        return self.client.post(PRESIGN_URL, {"content_type": content_type, "size": size}, format="json")


@override_settings(**S3_ON)
class PermissionTests(UploadAPITestBase):
    def test_anonymous_gets_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(CONFIG_URL).status_code, 401)
        self.assertEqual(self.presign().status_code, 401)

    def test_guest_gets_403(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(CONFIG_URL).status_code, 403)
        self.assertEqual(self.presign().status_code, 403)

    def test_get_on_presign_not_allowed(self):
        self.assertEqual(self.client.get(PRESIGN_URL).status_code, 405)


class ConfigTests(UploadAPITestBase):
    @override_settings(**S3_ON)
    def test_enabled_with_all_four_settings(self):
        resp = self.client.get(CONFIG_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {
            "enabled": True,
            "max_bytes": 10 * 1024 * 1024,
            "content_types": ["image/jpeg", "image/png", "image/webp"],
        })

    @override_settings(**S3_OFF)
    def test_disabled_without_settings(self):
        self.assertFalse(self.client.get(CONFIG_URL).data["enabled"])

    def test_any_missing_setting_disables(self):
        for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET", "AWS_S3_REGION"):
            with self.subTest(name), override_settings(**dict(S3_ON, **{name: ""})):
                self.assertFalse(self.client.get(CONFIG_URL).data["enabled"])

    @override_settings(**S3_ON)
    def test_no_secret_in_response(self):
        self.assertNotIn("test-secret-never-sent", self.client.get(CONFIG_URL).content.decode())


@override_settings(**S3_ON)
class PresignTests(UploadAPITestBase):
    def test_presigned_post_for_one_new_photo(self):
        resp = self.presign("image/webp")
        self.assertEqual(resp.status_code, 201, resp.data)
        data = resp.data
        self.assertEqual(data["url"], "https://demo-bucket.s3.eu-central-1.amazonaws.com/")
        self.assertRegex(data["key"], r"^property-images/\d{4}/\d{2}/[0-9a-f]{32}\.webp$")
        self.assertEqual(data["public_url"], "https://demo-bucket.s3.eu-central-1.amazonaws.com/" + data["key"])
        self.assertEqual(data["expires_in"], 300)
        self.assertEqual(data["max_bytes"], 10 * 1024 * 1024)
        fields = data["fields"]
        self.assertEqual(fields["key"], data["key"])
        self.assertEqual(fields["Content-Type"], "image/webp")
        self.assertEqual(fields["Cache-Control"], s3.CACHE_CONTROL)
        self.assertEqual(fields["x-amz-algorithm"], "AWS4-HMAC-SHA256")
        self.assertIn("x-amz-signature", fields)

    def test_policy_pins_bucket_key_type_and_size(self):
        data = self.presign("image/jpeg").data
        conditions = policy_of(data)["conditions"]
        self.assertIn({"bucket": "demo-bucket"}, conditions)
        self.assertIn({"key": data["key"]}, conditions)
        self.assertIn({"Content-Type": "image/jpeg"}, conditions)
        self.assertIn({"Cache-Control": s3.CACHE_CONTROL}, conditions)
        self.assertIn(["content-length-range", 1, 10 * 1024 * 1024], conditions)

    def test_policy_expires_in_five_minutes(self):
        expiration = datetime.strptime(policy_of(self.presign().data)["expiration"], "%Y-%m-%dT%H:%M:%SZ")
        left = expiration.replace(tzinfo=dt_timezone.utc) - datetime.now(dt_timezone.utc)
        self.assertGreater(left, timedelta(minutes=4))
        self.assertLessEqual(left, timedelta(minutes=5))

    def test_extension_follows_type(self):
        for content_type, ext in (("image/jpeg", "jpg"), ("image/png", "png"), ("image/webp", "webp")):
            with self.subTest(content_type):
                self.assertTrue(self.presign(content_type).data["key"].endswith("." + ext))

    def test_every_upload_gets_its_own_key(self):
        keys = {self.presign().data["key"] for _ in range(3)}
        self.assertEqual(len(keys), 3)

    def test_other_types_refused(self):
        for content_type in ("image/gif", "image/svg+xml", "text/html", "application/pdf", ""):
            with self.subTest(content_type):
                resp = self.presign(content_type)
                self.assertEqual(resp.status_code, 400)
                self.assertIn("content_type", resp.data)
        self.assertEqual(
            str(self.presign("image/svg+xml").data["content_type"][0]),
            "Only JPEG, PNG and WebP photos can be uploaded.",
        )

    def test_size_checked(self):
        self.assertEqual(self.presign(size=0).status_code, 400)
        self.assertEqual(self.presign(size=10 * 1024 * 1024).status_code, 201)  # exactly the limit
        resp = self.presign(size=10 * 1024 * 1024 + 1)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(str(resp.data["size"][0]), "Photos can be at most 10 MB.")

    def test_size_required(self):
        resp = self.client.post(PRESIGN_URL, {"content_type": "image/webp"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("size", resp.data)

    @override_settings(UPLOADS_MAX_BYTES=5 * 1024 * 1024 // 2)
    def test_limit_setting_used_everywhere(self):
        resp = self.presign(size=3 * 1024 * 1024)
        self.assertEqual(str(resp.data["size"][0]), "Photos can be at most 2.5 MB.")
        data = self.presign(size=1000).data
        self.assertEqual(data["max_bytes"], 2621440)
        self.assertIn(["content-length-range", 1, 2621440], policy_of(data)["conditions"])

    @override_settings(AWS_S3_PUBLIC_BASE_URL="https://photos.example.com/")
    def test_public_base_url_override(self):
        data = self.presign().data
        self.assertEqual(data["public_url"], "https://photos.example.com/" + data["key"])
        self.assertEqual(data["url"], "https://demo-bucket.s3.eu-central-1.amazonaws.com/")  # upload still to S3

    def test_no_secret_in_response(self):
        self.assertNotIn("test-secret-never-sent", self.presign().content.decode())

    @override_settings(**S3_OFF)
    def test_503_when_switched_off(self):
        resp = self.presign()
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.data["code"], "uploads_disabled")

    def test_503_when_signing_fails(self):
        with mock.patch.object(s3, "_client", side_effect=RuntimeError("boom")), \
                self.assertLogs("uploads.views", level="ERROR"):
            resp = self.presign()
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.data["code"], "uploads_unavailable")
        self.assertNotIn("boom", resp.content.decode())


class ChecksTests(SimpleTestCase):
    def ids(self, **overrides):
        with override_settings(**dict(S3_ON, **overrides)):
            return [p.id for p in s3_settings_check()]

    def test_all_or_nothing_is_fine(self):
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.ids(**S3_OFF), [])

    def test_partly_configured_warns(self):
        self.assertEqual(self.ids(AWS_SECRET_ACCESS_KEY=""), ["uploads.W001"])
        self.assertEqual(self.ids(**dict(S3_OFF, AWS_S3_BUCKET="demo-bucket")), ["uploads.W001"])

    def test_public_base_url_must_be_https(self):
        self.assertEqual(self.ids(AWS_S3_PUBLIC_BASE_URL="http://photos.example.com"), ["uploads.E001"])
        self.assertEqual(self.ids(AWS_S3_PUBLIC_BASE_URL="https://photos.example.com"), [])

    def test_limit_must_be_positive(self):
        self.assertEqual(self.ids(UPLOADS_MAX_BYTES=0), ["uploads.E002"])
