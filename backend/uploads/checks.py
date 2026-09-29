"""Startup checks for the S3 upload settings (TICKET-036). Run by
`manage.py check`/`migrate`, so build.sh on Render reports a half-configured
bucket instead of the Upload button silently staying hidden."""
from django.conf import settings
from django.core.checks import Error, Warning, register

AWS_SETTINGS = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET", "AWS_S3_REGION")


@register()
def s3_settings_check(app_configs=None, **kwargs):
    problems = []
    missing = [name for name in AWS_SETTINGS if not getattr(settings, name)]
    if missing and len(missing) < len(AWS_SETTINGS):
        problems.append(Warning(
            "Photo uploads are off: some S3 settings are set but not " + ", ".join(missing) + ".",
            hint="Set all four of " + ", ".join(AWS_SETTINGS) + " (or none). See the README's "
                 "\"Photo uploads (S3)\".",
            id="uploads.W001",
        ))
    base = settings.AWS_S3_PUBLIC_BASE_URL
    if base and not base.startswith("https://"):
        problems.append(Error(
            "AWS_S3_PUBLIC_BASE_URL must start with https://.",
            hint="Leave it empty to use https://<bucket>.s3.<region>.amazonaws.com.",
            id="uploads.E001",
        ))
    if settings.UPLOADS_MAX_BYTES < 1:
        problems.append(Error("UPLOADS_MAX_BYTES must be at least 1.", id="uploads.E002"))
    return problems
