from django.apps import AppConfig


class UploadsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'uploads'

    def ready(self):
        # Registers the S3 settings system checks (uploads/checks.py) and
        # the "delete a removed photo from S3" signal (uploads/signals.py).
        from . import checks, signals  # noqa: F401
