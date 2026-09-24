from django.contrib import admin

from .models import Review


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("property", "guest", "rating", "created_at")
    list_filter = ("rating",)
    search_fields = ("property__title", "guest__username", "comment")
    ordering = ("-created_at",)
