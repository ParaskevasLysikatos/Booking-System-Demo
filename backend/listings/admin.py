from django.contrib import admin

from .models import Property, PropertyImage


class PropertyImageInline(admin.TabularInline):
    """Lets you add/reorder/flag-as-cover a property's images right from
    the Property page, instead of hopping to a separate PropertyImage list."""

    model = PropertyImage
    extra = 1
    fields = ("image", "is_cover")


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("title", "location", "price_per_night", "capacity", "is_active", "created_at")
    list_filter = ("is_active", "location")
    search_fields = ("title", "location", "description")
    ordering = ("-created_at",)
    inlines = [PropertyImageInline]


@admin.register(PropertyImage)
class PropertyImageAdmin(admin.ModelAdmin):
    list_display = ("property", "is_cover", "created_at")
    list_filter = ("is_cover",)
    search_fields = ("property__title",)
    ordering = ("property", "-is_cover", "created_at")
