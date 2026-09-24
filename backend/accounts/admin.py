from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import User

from .models import Profile


class ProfileInline(admin.StackedInline):
    """Shows role/phone right on the built-in User admin page, instead of
    hopping to a separate Profile list to see who's an admin."""

    model = Profile
    can_delete = False
    fields = ("role", "phone")


class UserAdminWithProfile(UserAdmin):
    inlines = (*UserAdmin.inlines, ProfileInline)


admin.site.unregister(User)
admin.site.register(User, UserAdminWithProfile)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "phone")
    list_filter = ("role",)
    search_fields = ("user__username", "user__email", "phone")
