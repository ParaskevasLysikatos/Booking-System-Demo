from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class DateRange(models.Func):
    """Postgres `daterange(check_in, check_out)` - default bounds '[)', i.e.
    check_out is exclusive, exactly like Booking.objects.overlapping(): a
    stay ending on the 10th and one starting on the 10th don't overlap."""

    function = "DATERANGE"
    output_field = DateRangeField()


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
    guests = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1)],
        help_text="Number of people staying. Must not exceed the property's capacity (checked on booking).",
    )
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
            models.CheckConstraint(
                check=models.Q(guests__gte=1),
                name="booking_guests_at_least_one",
            ),
            # TICKET-015: the real double-booking guarantee. overlapping() is
            # only a friendly pre-check - two simultaneous requests can both
            # pass it (check-then-act race). This makes two overlapping
            # non-cancelled bookings for the same property impossible at the
            # DB level regardless of timing. Needs the btree_gist extension
            # (for `property WITH =` inside a GiST index) - created in
            # migration 0002. Postgres-only, like the rest of the stack.
            ExclusionConstraint(
                name="booking_no_overlap_per_property",
                expressions=[
                    ("property", RangeOperators.EQUAL),
                    (DateRange("check_in", "check_out"), RangeOperators.OVERLAPS),
                ],
                condition=~models.Q(status="cancelled"),
            ),
        ]

    def __str__(self):
        return f"{self.property.title}: {self.check_in} → {self.check_out} ({self.status})"

    # Status transitions allowed through the API (TICKET-015). Cancelled is
    # final - a cancelled stay is never revived (the guest books again), so
    # no overlap re-check is ever needed on a status change.
    ADMIN_TRANSITIONS = {
        Status.PENDING: {Status.CONFIRMED, Status.CANCELLED},
        Status.CONFIRMED: {Status.CANCELLED},
        Status.CANCELLED: set(),
    }
    # Guests can only cancel their own booking, and only until the
    # cancellation deadline (see cancel_deadline()).
    GUEST_TRANSITIONS = {
        Status.PENDING: {Status.CANCELLED},
        Status.CONFIRMED: {Status.CANCELLED},
        Status.CANCELLED: set(),
    }

    def clean(self):
        # Mirrors the DB CheckConstraint so a bad date range is rejected
        # with a friendly ValidationError in forms/admin/serializers, not
        # just an opaque IntegrityError from the database.
        if self.check_in and self.check_out and self.check_out <= self.check_in:
            raise ValidationError("check_out must be after check_in.")
        if self.property_id and self.guests and self.guests > self.property.capacity:
            raise ValidationError(
                f"This property sleeps at most {self.property.capacity} guests."
            )

    def check_in_datetime(self):
        """The check-in moment: check_in date at settings.BOOKING_CHECK_IN_TIME,
        local time (TIME_ZONE), as an aware datetime."""
        at = time.fromisoformat(settings.BOOKING_CHECK_IN_TIME)
        return timezone.make_aware(datetime.combine(self.check_in, at))

    def cancel_deadline(self):
        """Last moment a *guest* may cancel: N real hours (default 48) before
        the check-in moment. Subtracted in UTC so it's exactly N hours even
        across a daylight-saving change."""
        hours = settings.BOOKING_GUEST_CANCELLATION_HOURS
        utc = self.check_in_datetime().astimezone(dt_timezone.utc) - timedelta(hours=hours)
        return timezone.localtime(utc)

    def guest_can_cancel(self, now=None):
        if self.status == self.Status.CANCELLED:
            return False
        return (now or timezone.now()) < self.cancel_deadline()

    def get_nights(self):
        # A plain method, not @property: the `property` FK field above shadows
        # the builtin inside this class body.
        return (self.check_out - self.check_in).days

    def overlaps_with(self, other_check_in, other_check_out):
        return self.check_in < other_check_out and self.check_out > other_check_in
