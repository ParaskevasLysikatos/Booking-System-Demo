from django.apps import AppConfig


class UploadsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'uploads'

    def ready(self):
        # Registers the S3 settings system checks (uploads/checks.py).
        from . import checks  # noqa: F401
