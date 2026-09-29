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
import logging
import re
import uuid

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

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
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
            # Deletes run inside an admin's save request: fail fast.
            connect_timeout=3,
            read_timeout=5,
            retries={"max_attempts": 2, "mode": "standard"},
        ),
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


# What our own keys look like (see new_key): nothing else is ever deleted.
_OWN_KEY = re.compile(r"^property-images/\d{4}/\d{2}/[0-9a-f]{32}\.(?:jpg|png|webp)$")


def key_from_url(url):
    """The S3 key if `url` is a photo *this app* uploaded to the configured
    bucket (under property-images/, in new_key's exact format), else None.
    Pasted URLs, stock photos, other buckets or anything odd -> None, so
    they are never touched."""
    if not uploads_enabled() or not isinstance(url, str):
        return None
    base = public_base_url() + "/"
    if not url.startswith(base):
        return None
    key = url[len(base):]
    return key if _OWN_KEY.match(key) else None


def delete_object(key):
    """Best effort: a photo that can't be deleted only costs a few KB of
    storage, so failures are logged, never raised."""
    try:
        _client().delete_object(Bucket=settings.AWS_S3_BUCKET, Key=key)
    except Exception:  # noqa: BLE001 - botocore/network errors
        logger.exception("Could not delete %s from S3", key)
        return False
    logger.info("Deleted %s from S3", key)
    return True
