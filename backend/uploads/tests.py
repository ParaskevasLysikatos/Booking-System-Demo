import base64
import json
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from listings.models import Property, PropertyImage

from . import s3
from .checks import s3_settings_check
from .signals import delete_if_unused

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


# --- deleting removed photos from S3 (step 3) ----------------------------------

BASE = "https://demo-bucket.s3.eu-central-1.amazonaws.com/"
OURS_1 = BASE + "property-images/2026/09/" + "a" * 32 + ".webp"
OURS_2 = BASE + "property-images/2026/09/" + "b" * 32 + ".jpg"
PASTED = "https://picsum.photos/seed/1/800/600"


def key_of(url):
    return url[len(BASE):]


def make_property(title="Loft"):
    return Property.objects.create(
        title=title, location="Thessaloniki, Greece", price_per_night=Decimal("80.00"), capacity=2,
        latitude=Decimal("40.632700"), longitude=Decimal("22.943100"),
    )


@override_settings(**S3_ON)
class KeyFromUrlTests(SimpleTestCase):
    def test_own_uploads_only(self):
        self.assertEqual(s3.key_from_url(OURS_1), key_of(OURS_1))
        self.assertEqual(s3.key_from_url(OURS_2), key_of(OURS_2))
        for url in (
            PASTED,
            "https://other-bucket.s3.eu-central-1.amazonaws.com/property-images/2026/09/" + "a" * 32 + ".webp",
            BASE + "private/2026/09/" + "a" * 32 + ".webp",           # outside the prefix
            BASE + "property-images/../secret.txt",
            BASE + "property-images/2026/09/" + "a" * 32 + ".webp?x=1",
            BASE + "property-images/2026/09/my-photo.webp",           # not a key we'd make
            BASE + "property-images/2026/09/" + "a" * 32 + ".svg",
            "",
            None,
        ):
            with self.subTest(url):
                self.assertIsNone(s3.key_from_url(url))

    @override_settings(AWS_S3_PUBLIC_BASE_URL="https://photos.example.com")
    def test_custom_public_base(self):
        url = "https://photos.example.com/property-images/2026/09/" + "c" * 32 + ".png"
        self.assertEqual(s3.key_from_url(url), url[len("https://photos.example.com/"):])
        self.assertIsNone(s3.key_from_url(OURS_1))

    @override_settings(**S3_OFF)
    def test_nothing_is_ours_when_uploads_are_off(self):
        self.assertIsNone(s3.key_from_url(OURS_1))


@override_settings(**S3_ON)
class DeleteRemovedPhotoTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.client.force_authenticate(self.admin)
        self.prop = make_property()
        PropertyImage.objects.create(property=self.prop, image=OURS_1, is_cover=True)
        PropertyImage.objects.create(property=self.prop, image=OURS_2)
        PropertyImage.objects.create(property=self.prop, image=PASTED)
        patcher = mock.patch.object(s3, "_client")
        self.client_factory = patcher.start()
        self.addCleanup(patcher.stop)
        self.s3 = self.client_factory.return_value

    def deleted_keys(self):
        return [c.kwargs["Key"] for c in self.s3.delete_object.call_args_list]

    def save_images(self, images):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.patch(
                reverse("property-detail", args=[self.prop.pk]), {"images": images}, format="json",
            )
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp

    def test_removed_upload_is_deleted_kept_ones_and_pasted_urls_are_not(self):
        self.save_images([{"image": OURS_2, "is_cover": True}])  # removed OURS_1 and PASTED
        self.assertEqual(self.deleted_keys(), [key_of(OURS_1)])
        self.s3.delete_object.assert_called_once_with(Bucket="demo-bucket", Key=key_of(OURS_1))

    def test_reordering_or_changing_the_cover_deletes_nothing(self):
        self.save_images([
            {"image": PASTED, "is_cover": False},
            {"image": OURS_2, "is_cover": True},
            {"image": OURS_1, "is_cover": False},
        ])
        self.assertEqual(self.deleted_keys(), [])

    def test_a_photo_another_property_still_uses_is_kept(self):
        other = make_property("Other")
        PropertyImage.objects.create(property=other, image=OURS_1)
        self.save_images([{"image": OURS_2, "is_cover": True}])
        self.assertEqual(self.deleted_keys(), [])

    def test_nothing_deleted_if_the_save_is_rolled_back(self):
        with self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(RuntimeError), transaction.atomic():
                PropertyImage.objects.filter(image=OURS_1).delete()
                raise RuntimeError("rollback")
        self.s3.delete_object.assert_not_called()
        self.assertTrue(PropertyImage.objects.filter(image=OURS_1).exists())

    def test_deleting_the_property_deletes_its_uploads(self):
        # e.g. in Django Admin (the API only retires properties)
        with self.captureOnCommitCallbacks(execute=True):
            self.prop.delete()
        self.assertCountEqual(self.deleted_keys(), [key_of(OURS_1), key_of(OURS_2)])

    def test_s3_failure_is_logged_and_the_save_still_succeeds(self):
        self.s3.delete_object.side_effect = RuntimeError("S3 down")
        with self.assertLogs("uploads.s3", level="ERROR") as logs:
            resp = self.save_images([{"image": OURS_2, "is_cover": True}])
        self.assertIn(key_of(OURS_1), logs.output[0])
        self.assertEqual([i["image"] for i in resp.data["images"]], [OURS_2])

    @override_settings(**S3_OFF)
    def test_uploads_off_deletes_nothing(self):
        self.save_images([])
        self.client_factory.assert_not_called()

    def test_retiring_a_property_keeps_its_photos(self):
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.client.delete(reverse("property-detail", args=[self.prop.pk]))
        self.assertEqual(resp.status_code, 204)
        self.client_factory.assert_not_called()

    def test_delete_if_unused_directly(self):
        self.assertFalse(delete_if_unused(OURS_1))  # still used
        self.assertFalse(delete_if_unused(PASTED))  # not ours
        self.s3.delete_object.assert_not_called()
        PropertyImage.objects.filter(image=OURS_1).delete()
        self.s3.delete_object.return_value = {}
        self.assertTrue(delete_if_unused(OURS_1))
