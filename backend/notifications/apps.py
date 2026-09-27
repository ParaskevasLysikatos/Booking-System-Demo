from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notifications'
    verbose_name = 'Notifications (emails)'

    def ready(self):
        # Registers the email settings system checks (notifications/checks.py).
        from . import checks  # noqa: F401
