from django.contrib import admin

from .models import Payment, StripeEvent


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("booking", "status", "amount", "currency", "expires_at", "paid_at", "created_at")
    list_filter = ("status",)
    search_fields = ("booking__id", "booking__guest__email", "stripe_checkout_session_id", "stripe_payment_intent_id")
    # Stripe owns these - editing them here would only make our copy lie.
    readonly_fields = (
        "booking", "amount", "currency", "stripe_checkout_session_id", "checkout_url",
        "stripe_payment_intent_id", "expires_at", "paid_at", "created_at", "updated_at",
    )


@admin.register(StripeEvent)
class StripeEventAdmin(admin.ModelAdmin):
    list_display = ("event_id", "type", "received_at")
    list_filter = ("type",)
    search_fields = ("event_id",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
