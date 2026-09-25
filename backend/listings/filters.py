"""Query-param filtering for GET /api/properties/ (TICKET-013).

Params are validated with a plain DRF serializer rather than pulling in
django-filter: the one non-trivial filter (date availability) needs both
dates together plus cross-field checks anyway, and a serializer gives the
same clean 400 {"field": ["message"]} errors as the rest of the API.
"""

from decimal import Decimal

from django.db.models import Exists, OuterRef
from django.utils import timezone
from rest_framework import serializers

from bookings.models import Booking

ORDERING_MAP = {
    "price": ("price_per_night", "id"),
    "-price": ("-price_per_night", "id"),
    "capacity": ("capacity", "id"),
    "-capacity": ("-capacity", "id"),
    "newest": ("-created_at", "-id"),
}


class DateRangeQuerySerializer(serializers.Serializer):
    """check_in/check_out as a pair - used by the list filter and by the
    detail endpoint's availability check. Dates are YYYY-MM-DD; check_out is
    the departure day (exclusive), matching Booking's convention."""

    check_in = serializers.DateField(required=False)
    check_out = serializers.DateField(required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        check_in, check_out = attrs.get("check_in"), attrs.get("check_out")
        if (check_in is None) != (check_out is None):
            raise serializers.ValidationError(
                {"check_in": ["check_in and check_out must be given together."]}
            )
        if check_in and check_out:
            if check_out <= check_in:
                raise serializers.ValidationError(
                    {"check_out": ["check_out must be after check_in."]}
                )
            if check_in < timezone.localdate():
                raise serializers.ValidationError(
                    {"check_in": ["check_in can't be in the past."]}
                )
        return attrs


class PropertyFilterSerializer(DateRangeQuerySerializer):
    location = serializers.CharField(required=False, allow_blank=True, max_length=255)
    guests = serializers.IntegerField(required=False, min_value=1)
    min_price = serializers.DecimalField(
        required=False, max_digits=10, decimal_places=2, min_value=Decimal("0")
    )
    max_price = serializers.DecimalField(
        required=False, max_digits=10, decimal_places=2, min_value=Decimal("0")
    )
    ordering = serializers.ChoiceField(required=False, choices=list(ORDERING_MAP))
    # Only honoured for admins (guests only ever see active properties).
    is_active = serializers.BooleanField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        low, high = attrs.get("min_price"), attrs.get("max_price")
        if low is not None and high is not None and low > high:
            raise serializers.ValidationError(
                {"min_price": ["min_price can't be greater than max_price."]}
            )
        return attrs


def available_between(queryset, check_in, check_out):
    """Keep only properties with no non-cancelled booking overlapping
    [check_in, check_out). Reuses Booking.objects.overlapping() - the same
    overlap rule booking creation uses - as a correlated EXISTS subquery, so
    it's one SQL query however many properties there are."""
    clashes = Booking.objects.overlapping(OuterRef("pk"), check_in, check_out)
    return queryset.filter(~Exists(clashes))


def apply_property_filters(queryset, params, *, is_admin=False):
    """Validate `params` (request.query_params) and return the filtered
    queryset. Raises serializers.ValidationError (-> HTTP 400) on bad input."""
    serializer = PropertyFilterSerializer(data=params)
    serializer.is_valid(raise_exception=True)
    f = serializer.validated_data

    if is_admin:
        if f.get("is_active") is not None:
            queryset = queryset.filter(is_active=f["is_active"])
    else:
        queryset = queryset.filter(is_active=True)

    if f.get("location"):
        queryset = queryset.filter(location__icontains=f["location"].strip())
    if f.get("guests") is not None:
        queryset = queryset.filter(capacity__gte=f["guests"])
    if f.get("min_price") is not None:
        queryset = queryset.filter(price_per_night__gte=f["min_price"])
    if f.get("max_price") is not None:
        queryset = queryset.filter(price_per_night__lte=f["max_price"])
    if f.get("check_in"):
        queryset = available_between(queryset, f["check_in"], f["check_out"])
    if f.get("ordering"):
        queryset = queryset.order_by(*ORDERING_MAP[f["ordering"]])
    return queryset
