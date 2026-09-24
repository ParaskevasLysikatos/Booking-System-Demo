from django.conf import settings
from django.db import models


class Profile(models.Model):
    """Extends Django's built-in User with the app-specific bits it doesn't
    have: an admin/guest role, and a phone number."""

    class Role(models.TextChoices):
        GUEST = "guest", "Guest"
        ADMIN = "admin", "Admin"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    role = models.CharField(
        max_length=10,
        choices=Role.choices,
        default=Role.GUEST,
        help_text=(
            "Deliberately separate from Django's own is_staff/is_superuser "
            "(those gate the built-in /admin/ site used for dev DB "
            "inspection; this gates the app's own admin dashboard/API)."
        ),
    )
    phone = models.CharField(max_length=30, blank=True)

    def __str__(self):
        return f"{self.user.get_username()} ({self.role})"

    @property
    def is_admin(self):
        return self.role == self.Role.ADMIN
