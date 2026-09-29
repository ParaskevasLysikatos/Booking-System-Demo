"""Photo uploads to the owner's S3 bucket (TICKET-036).

The browser uploads straight to S3; Django never sees the file. It only
hands an admin a short-lived *presigned POST*: a form S3 itself accepts for
exactly one new key, one content type and a size range, until it expires.
The photo is then public at `public_url(key)` (a bucket policy allows public
GET on `property-images/*` only) and that URL is what `PropertyImage.image`
stores - so the rest of the app keeps working with plain URLs.

No AWS settings -> uploads are off (`uploads_enabled()` is False) and the
admin Photos editor falls back to pasting URLs, like before.
"""
import uuid

from django.conf import settings
from django.utils import timezone

# Everything this app writes lives under this prefix - and only this prefix
# is public (bucket policy) and writable/deletable by the IAM user.
UPLOAD_PREFIX = "property-images/"

# What an admin may upload -> file extension of the key. No SVG/GIF: SVG can
# carry scripts, and the browser resize step outputs WebP/JPEG anyway.
CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# How long the presigned POST can be used. Enough for a slow phone upload of
# one resized photo; each photo asks for its own.
PRESIGN_EXPIRES_SECONDS = 5 * 60

# Keys are random and never overwritten, so browsers/CDNs may cache forever.
CACHE_CONTROL = "public, max-age=31536000, immutable"


class UploadsDisabled(Exception):
    """The AWS_* settings aren't all set."""


def uploads_enabled():
    return bool(
        settings.AWS_ACCESS_KEY_ID
        and settings.AWS_SECRET_ACCESS_KEY
        and settings.AWS_S3_BUCKET
        and settings.AWS_S3_REGION
    )


def _client():
    # Imported here so the rest of the app (and a clone without boto3 yet)
    # never pays for it.
    import boto3
    from botocore.config import Config

    region = settings.AWS_S3_REGION
    return boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        # The regional endpoint + virtual-hosted style gives
        # https://<bucket>.s3.<region>.amazonaws.com/ - the global
        # s3.amazonaws.com name can answer a fresh bucket's upload with a
        # redirect the browser won't follow for a POST.
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def public_base_url():
    base = settings.AWS_S3_PUBLIC_BASE_URL or (
        f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_S3_REGION}.amazonaws.com"
    )
    return base.rstrip("/")


def public_url(key):
    return f"{public_base_url()}/{key}"


def new_key(content_type):
    """property-images/2026/09/<32 hex>.webp - random, so two uploads never
    collide and a key can't be guessed from a property."""
    ext = CONTENT_TYPES[content_type]
    month = timezone.localdate().strftime("%Y/%m")
    return f"{UPLOAD_PREFIX}{month}/{uuid.uuid4().hex}.{ext}"


def presign(content_type):
    """A presigned POST for one new photo. Raises UploadsDisabled when S3
    isn't configured, KeyError for a type not in CONTENT_TYPES. Pure
    signing - no request to AWS is made here."""
    if not uploads_enabled():
        raise UploadsDisabled()
    key = new_key(content_type)
    max_bytes = settings.UPLOADS_MAX_BYTES
    post = _client().generate_presigned_post(
        Bucket=settings.AWS_S3_BUCKET,
        Key=key,
        Fields={"Content-Type": content_type, "Cache-Control": CACHE_CONTROL},
        Conditions=[
            {"Content-Type": content_type},
            {"Cache-Control": CACHE_CONTROL},
            ["content-length-range", 1, max_bytes],
        ],
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
    )
    return {
        "url": post["url"],
        "fields": post["fields"],
        "key": key,
        "public_url": public_url(key),
        "expires_in": PRESIGN_EXPIRES_SECONDS,
        "max_bytes": max_bytes,
    }
