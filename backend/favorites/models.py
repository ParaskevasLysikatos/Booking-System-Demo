from django.conf import settings
from django.db import models


class Favorite(models.Model):
    """A property a user has saved ("hearted") - TICKET-033.

    One row per user per property. Removing a favorite deletes the row;
    deactivating the property does *not* (the guest still sees it on their
    Saved page, greyed out as "No longer available").
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    property = models.ForeignKey(
        "listings.Property",
        on_delete=models.CASCADE,
        related_name="favorites",
        help_text="CASCADE is safe: properties are only ever soft-deleted (is_active=False).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "property"],
                name="unique_favorite_per_user_per_property",
            ),
        ]

    def __str__(self):
        return f"{self.user.get_username()} saved {self.property.title}"
