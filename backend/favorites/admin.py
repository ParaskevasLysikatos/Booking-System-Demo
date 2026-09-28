from django.contrib import admin

from .models import Favorite


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ("user", "property", "created_at")
    search_fields = ("user__username", "user__email", "property__title")
    ordering = ("-created_at",)
    raw_id_fields = ("user", "property")
