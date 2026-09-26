from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'payments'

    def ready(self):
        # Registers the Stripe settings system checks (payments/checks.py).
        from . import checks  # noqa: F401
