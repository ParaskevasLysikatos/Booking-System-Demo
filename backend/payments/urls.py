from django.urls import path

from .views import payments_config, stripe_webhook

urlpatterns = [
    path("config/", payments_config, name="payments-config"),
    path("stripe/webhook/", stripe_webhook, name="stripe-webhook"),
]
