from django.contrib import admin

from .models import Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("property", "guest", "check_in", "check_out", "guests", "status", "total_price", "created_at")
    list_filter = ("status", "check_in")
    search_fields = ("property__title", "guest__username", "guest__email")
    ordering = ("-check_in",)
    date_hierarchy = "check_in"
