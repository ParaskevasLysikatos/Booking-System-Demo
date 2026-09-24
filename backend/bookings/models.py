from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class BookingQuerySet(models.QuerySet):
    def overlapping(self, property, check_in, check_out, exclude_cancelled=True):
        """Bookings for `property` whose stay overlaps [check_in, check_out).

        This *is* the "availability" the build plan calls for - there's no
        separate Availability model; a date range is free exactly when this
        returns nothing for it. Two ranges overlap when each starts before
        the other ends, the standard interval-overlap test. Cancelled
        bookings don't block new ones by default, since cancelling a stay
        frees those dates back up; pass exclude_cancelled=False to include
        them anyway (e.g. for a full history view).
        """
        qs = self.filter(property=property, check_in__lt=check_out, check_out__gt=check_in)
        if exclude_cancelled:
            qs = qs.exclude(status=Booking.Status.CANCELLED)
        return qs


class Booking(models.Model):
    """One guest's reservation of a Property for a date range."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"

    property = models.ForeignKey(
        "listings.Property",
        on_delete=models.PROTECT,
        related_name="bookings",
        help_text="PROTECT, not CASCADE: a property with booking history shouldn't be hard-deletable - use Property.is_active to retire it instead.",
    )
    guest = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="bookings",
    )
    check_in = models.DateField()
    check_out = models.DateField()
    total_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Decimal, like Property.price_per_night - money never as float.",
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = BookingQuerySet.as_manager()

    class Meta:
        ordering = ["-check_in"]
        constraints = [
            models.CheckConstraint(
                check=models.Q(check_out__gt=models.F("check_in")),
                name="booking_check_out_after_check_in",
            ),
        ]

    def __str__(self):
        return f"{self.property.title}: {self.check_in} → {self.check_out} ({self.status})"

    def clean(self):
        # Mirrors the DB CheckConstraint so a bad date range is rejected
        # with a friendly ValidationError in forms/admin/serializers, not
        # just an opaque IntegrityError from the database.
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValidationError("check_out must be after check_in.")

    def overlaps_with(self, other_check_in, other_check_out):
        return self.check_in < other_check_out and self.check_out > other_check_in
