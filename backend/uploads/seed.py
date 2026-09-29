"""Seed photos in the owner's S3 bucket (TICKET-037).

A fixed set of free-licensed photos lives in the repo at
`core/seed_photos/<type>-<nn>.webp` (credits in its CREDITS.md).
`manage.py upload_seed_photos` puts them in the bucket once, under the
simple, fixed prefix `property-images/seed/`, and `seed_demo_data` points
the demo properties at their public URLs.

They sit inside `property-images/`, so the existing bucket policy already
makes them public and the IAM user can already write there - no AWS change.
`s3.key_from_url()` only matches keys the app itself uploaded
(`property-images/YYYY/MM/<32 hex>`), so a seed photo is never deleted when
an admin removes it from a property, even though many properties share it.
"""
import re
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings

from . import s3

SEED_PREFIX = f"{s3.UPLOAD_PREFIX}seed/"

# Unlike uploads (random keys, never overwritten -> "immutable"), a seed file
# keeps its name if the photo is ever swapped, so caches expire after a week.
SEED_CACHE_CONTROL = "public, max-age=604800"
SEED_CONTENT_TYPE = "image/webp"

# villa-01.webp, apartment-12.webp ... - anything else in the folder
# (CREDITS.md, stray files) is ignored.
_SEED_NAME = re.compile(r"^[a-z]+-\d{2}\.webp$")


def seed_dir():
    return Path(settings.BASE_DIR) / "core" / "seed_photos"


def seed_files(directory=None):
    """The seed photos in `directory` (default: the repo folder), by name."""
    directory = Path(directory) if directory else seed_dir()
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if p.is_file() and _SEED_NAME.match(p.name))


def seed_key(name):
    return f"{SEED_PREFIX}{name}"


def seed_url(name):
    return s3.public_url(seed_key(name))


def remote_size(url, timeout=10):
    """Size in bytes of the public object at `url`, or None if it isn't
    there. A plain anonymous HEAD: public GET is allowed on
    property-images/*, and a missing key answers 403 (anonymous callers
    can't list the bucket) or 404 - so no s3:ListBucket is needed.
    Network trouble raises OSError (URLError is one)."""
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            length = response.headers.get("Content-Length")
            return int(length) if length is not None else -1
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            return None
        raise


def upload(path):
    """Put one seed photo at property-images/seed/<name> (overwrites)."""
    path = Path(path)
    s3._client().put_object(
        Bucket=settings.AWS_S3_BUCKET,
        Key=seed_key(path.name),
        Body=path.read_bytes(),
        ContentType=SEED_CONTENT_TYPE,
        CacheControl=SEED_CACHE_CONTROL,
    )
