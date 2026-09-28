from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction


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
    # TICKET-034: map position. Optional (a property without one simply isn't
    # on the map); both or neither - enforced in clean() and by a DB
    # constraint. 6 decimals ~ 11 cm. Guests only ever get an approximate
    # point (see listings/geo.py); these exact values are admin-only.
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
        help_text="Exact map position (admins only; guests see a ~500 m area). Set together with longitude.",
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
        help_text="Exact map position. Set together with latitude.",
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
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(latitude__isnull=True, longitude__isnull=True)
                    | models.Q(latitude__isnull=False, longitude__isnull=False)
                ),
                name="property_lat_lng_both_or_neither",
            ),
            models.CheckConstraint(
                condition=models.Q(latitude__isnull=True) | models.Q(latitude__gte=-90, latitude__lte=90),
                name="property_latitude_in_range",
            ),
            models.CheckConstraint(
                condition=models.Q(longitude__isnull=True) | models.Q(longitude__gte=-180, longitude__lte=180),
                name="property_longitude_in_range",
            ),
        ]

    def __str__(self):
        return self.title

    @property
    def has_coordinates(self):
        return self.latitude is not None and self.longitude is not None

    def clean(self):
        # Mirrors property_lat_lng_both_or_neither with a friendly message.
        super().clean()
        if (self.latitude is None) != (self.longitude is None):
            raise ValidationError("Set both latitude and longitude, or neither.")

    @property
    def cover_image(self):
        """The image flagged `is_cover`, or - if none is flagged yet - the
        earliest-added image (PropertyImage's default ordering already puts
        the cover first, then oldest-first, so `.first()` does the right
        thing either way). Returns None if the property has no images."""
        return self.images.first()


class PropertyImage(models.Model):
    """One photo belonging to a Property. A property can have many; at most
    one may be flagged `is_cover` (enforced below both in `save()` and with
    a DB constraint), and that one is used as the listing's thumbnail."""

    property = models.ForeignKey(
        Property,
        on_delete=models.CASCADE,
        related_name="images",
    )
    image = models.URLField(
        max_length=500,
        help_text=(
            "Photo URL. Demo data uses stock photo URLs (see the Faker seed "
            "script); real uploads are a later, nice-to-have ticket."
        ),
    )
    is_cover = models.BooleanField(
        default=False,
        help_text="Marks this as the property's thumbnail/cover photo. At most one per property.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_cover", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["property"],
                condition=models.Q(is_cover=True),
                name="unique_cover_image_per_property",
            ),
        ]

    def __str__(self):
        marker = " (cover)" if self.is_cover else ""
        return f"Image for {self.property.title}{marker}"

    def save(self, *args, **kwargs):
        # Saving this image as the cover silently un-covers any sibling that
        # was previously flagged, so callers never have to remember to do
        # that themselves. The UniqueConstraint above is the hard backstop
        # (e.g. against a bulk .update() that skips save()); this is what
        # makes the everyday "mark this one as cover" case just work.
        if self.is_cover:
            with transaction.atomic():
                PropertyImage.objects.filter(
                    property=self.property, is_cover=True
                ).exclude(pk=self.pk).update(is_cover=False)
                super().save(*args, **kwargs)
        else:
            super().save(*args, **kwargs)
