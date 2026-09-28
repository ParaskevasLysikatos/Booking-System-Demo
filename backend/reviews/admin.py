from django.contrib import admin

from .models import Review


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("property", "guest", "rating", "is_hidden", "created_at")
    list_filter = ("rating", "is_hidden")
    search_fields = ("property__title", "guest__username", "guest__email", "comment")
    ordering = ("-created_at",)
