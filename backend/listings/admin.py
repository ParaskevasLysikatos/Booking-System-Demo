from django.contrib import admin

from .models import BlockedPeriod, Property, PropertyImage


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
    fieldsets = (
        (None, {"fields": ("title", "description", "location", "price_per_night", "capacity", "amenities", "is_active")}),
        ("Map position (TICKET-034)", {"fields": ("latitude", "longitude")}),
    )


@admin.register(PropertyImage)
class PropertyImageAdmin(admin.ModelAdmin):
    list_display = ("property", "is_cover", "created_at")
    list_filter = ("is_cover",)
    search_fields = ("property__title",)
    ordering = ("property", "-is_cover", "created_at")


@admin.register(BlockedPeriod)
class BlockedPeriodAdmin(admin.ModelAdmin):
    """Read-only view of closed dates (TICKET-045). They're created and
    removed from the app's admin pages, where the overlap rules and the
    property lock apply - the Django Admin would skip both."""

    list_display = ("property", "start", "end", "note", "created_by", "created_at")
    list_filter = ("property",)
    search_fields = ("property__title", "note")
    ordering = ("start",)
    readonly_fields = ("property", "start", "end", "note", "created_by", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
