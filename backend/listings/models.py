from django.db import models


class Property(models.Model):
    """A single bookable listing (apartment or room)."""

    title = models.CharField(
        max_length=200,
        help_text="Short, guest-facing name for the listing, e.g. \"Cozy studio near the seafront\".",
    )
    description = models.TextField(
        blank=True,
        help_text="Longer free-text description shown on the property detail page.",
    )
    location = models.CharField(
        max_length=255,
        help_text="Free-text location, e.g. \"Thessaloniki, Greece\". Used for search/filtering.",
    )
    price_per_night = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        help_text="Nightly price. Decimal (not float) so money never loses precision.",
    )
    capacity = models.PositiveIntegerField(
        help_text="Maximum number of guests the property sleeps.",
    )
    amenities = models.JSONField(
        default=list,
        blank=True,
        help_text="List of amenity labels, e.g. [\"wifi\", \"parking\", \"pool\"].",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive properties are hidden from customer-facing listings but kept for history.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "properties"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title
