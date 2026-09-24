from django.contrib import admin

from .models import Property


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("title", "location", "price_per_night", "capacity", "is_active", "created_at")
    list_filter = ("is_active", "location")
    search_fields = ("title", "location", "description")
    ordering = ("-created_at",)
