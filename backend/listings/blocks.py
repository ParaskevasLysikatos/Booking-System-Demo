"""Closed dates of a property (TICKET-045): the admin API and its rules.

    GET    /api/admin/properties/{id}/blocks/             upcoming blocks of one property
    POST   /api/admin/properties/{id}/blocks/             close dates {start, end, note}
    DELETE /api/admin/properties/{id}/blocks/{block_id}/  reopen them
    GET    /api/admin/blocks/?property={id}               upcoming blocks of every property (step 4)

Admins only. The rules for a new block:

- `start` today or later, at most MAX_DAYS_AHEAD days ahead (like a
  booking's check-in), at most MAX_NIGHTS nights, `end` after `start`;
- it can't overlap a pending or confirmed booking -> 409 `booking_overlap`
  (cancel or move the booking first);
- it can't overlap another block of the property -> 409 `dates_closed`.

The overlap checks run with the property's row locked (lock_property), and
booking create takes the same lock before it looks at the blocks, so a
booking and a block for the same days can't both get in.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _, ngettext
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole
from bookings.models import Booking

from .models import BlockedPeriod, Property, lock_property

MAX_DAYS_AHEAD = 365  # same as bookings (bookings/serializers.py)
MAX_NIGHTS = 365
BLOCK_OVERLAP_CONSTRAINT = "blockedperiod_no_overlap_per_property"
EXCLUSION_VIOLATION = "23P01"


class BlockedPeriodSerializer(serializers.ModelSerializer):
    nights = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = BlockedPeriod
        fields = ["id", "property", "start", "end", "nights", "note", "created_by", "created_at"]
        read_only_fields = fields

    def get_nights(self, obj):
        return (obj.end - obj.start).days

    def get_created_by(self, obj):
        return obj.created_by.email if obj.created_by else None


class BlockedPeriodWithPropertySerializer(BlockedPeriodSerializer):
    """For the list across properties: also the property's title and whether it's active."""

    property_title = serializers.CharField(source="property.title", read_only=True)
    property_is_active = serializers.BooleanField(source="property.is_active", read_only=True)

    class Meta(BlockedPeriodSerializer.Meta):
        fields = [*BlockedPeriodSerializer.Meta.fields, "property_title", "property_is_active"]
        read_only_fields = fields


class AllBlocksQuerySerializer(serializers.Serializer):
    property = serializers.IntegerField(required=False, min_value=1)


class BlockedPeriodCreateSerializer(serializers.Serializer):
    start = serializers.DateField()
    end = serializers.DateField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate_note(self, value):
        return value.strip()

    def validate(self, attrs):
        start, end = attrs["start"], attrs["end"]
        today = timezone.localdate()
        errors = {}
        if start < today:
            errors["start"] = [_("Past days can't be closed.")]
        elif start > today + timedelta(days=MAX_DAYS_AHEAD):
            errors["start"] = [_("Dates can be closed at most %(days)s days ahead.") % {"days": MAX_DAYS_AHEAD}]
        if end <= start:
            errors["end"] = [_("end must be after start.")]
        elif (end - start).days > MAX_NIGHTS:
            errors["end"] = [_("At most %(nights)s nights can be closed at once.") % {"nights": MAX_NIGHTS}]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


def _range(start, end):
    return f"{start:%Y-%m-%d} → {end:%Y-%m-%d}"


class BlockConflict(Exception):
    """A new block overlaps something - answered with a 409."""

    def __init__(self, code, detail, **extra):
        super().__init__(detail)
        self.body = {"detail": detail, "code": code, **extra}


def _conflict_with_bookings(bookings):
    refs = ", ".join(f"#{b.pk} ({_range(b.check_in, b.check_out)})" for b in bookings)
    detail = ngettext(
        "These dates overlap booking %(refs)s. Cancel or move the booking first.",
        "These dates overlap bookings %(refs)s. Cancel or move those bookings first.",
        len(bookings),
    ) % {"refs": refs}
    return BlockConflict(
        "booking_overlap", detail,
        bookings=[{"id": b.pk, "check_in": b.check_in, "check_out": b.check_out, "status": b.status}
                  for b in bookings],
    )


def _conflict_with_blocks(blocks):
    ranges = ", ".join(_range(b.start, b.end) for b in blocks)
    return BlockConflict(
        "dates_closed",
        _("Some of these dates are already closed (%(ranges)s).") % {"ranges": ranges},
    )


def _is_block_overlap(exc):
    cause = getattr(exc, "__cause__", None)
    if getattr(cause, "pgcode", None) != EXCLUSION_VIOLATION:
        return False
    return getattr(getattr(cause, "diag", None), "constraint_name", None) in (None, BLOCK_OVERLAP_CONSTRAINT)


def create_block(prop, start, end, note="", user=None):
    """Close [start, end) for `prop`, or raise BlockConflict."""
    # A payment hold that ran out but whose "expired" webhook never came
    # would still count as a pending booking here - settle those first, the
    # same way booking create does (TICKET-029). Outside the lock: it may
    # ask Stripe.
    from payments.services import release_stale_holds
    release_stale_holds(prop, start, end)

    with transaction.atomic():
        lock_property(prop.pk)
        bookings = list(Booking.objects.overlapping(prop, start, end).order_by("check_in", "id"))
        if bookings:
            raise _conflict_with_bookings(bookings)
        blocks = list(BlockedPeriod.objects.overlapping(prop, start, end))
        if blocks:
            raise _conflict_with_blocks(blocks)
        try:
            with transaction.atomic():
                return BlockedPeriod.objects.create(
                    property=prop, start=start, end=end, note=note, created_by=user,
                )
        except IntegrityError as exc:
            # Only reachable if something wrote a block without the lock
            # (e.g. the Django Admin) - the constraint still holds the line.
            if _is_block_overlap(exc):
                raise _conflict_with_blocks(list(BlockedPeriod.objects.overlapping(prop, start, end)))
            raise


def upcoming_blocks():
    """Blocks that still have a closed night today or later."""
    return BlockedPeriod.objects.filter(end__gt=timezone.localdate())


class PropertyBlocksView(APIView):
    """GET (upcoming blocks, soonest first) / POST (close dates) for one property."""

    permission_classes = [IsAdminRole]

    def get(self, request, property_id):
        prop = get_object_or_404(Property, pk=property_id)
        blocks = upcoming_blocks().filter(property=prop).select_related("created_by")
        return Response(BlockedPeriodSerializer(blocks, many=True).data)

    def post(self, request, property_id):
        prop = get_object_or_404(Property, pk=property_id)
        serializer = BlockedPeriodCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            block = create_block(prop, data["start"], data["end"], data["note"], request.user)
        except BlockConflict as conflict:
            return Response(conflict.body, status=status.HTTP_409_CONFLICT)
        return Response(BlockedPeriodSerializer(block).data, status=status.HTTP_201_CREATED)


class PropertyBlockDetailView(APIView):
    """DELETE - reopen the dates (any block of this property, past ones too)."""

    permission_classes = [IsAdminRole]

    def delete(self, request, property_id, block_id):
        block = get_object_or_404(BlockedPeriod, pk=block_id, property_id=property_id)
        block.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AllBlocksView(APIView):
    """GET /api/admin/blocks/ - upcoming blocks of every property, soonest
    first (the "Closed dates" tab of the admin Bookings page). `?property=`
    narrows it to one. Not paginated: only upcoming blocks, a short list."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        query = AllBlocksQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        blocks = upcoming_blocks().select_related("property", "created_by").order_by("start", "property__title", "id")
        if "property" in query.validated_data:
            blocks = blocks.filter(property_id=query.validated_data["property"])
        return Response(BlockedPeriodWithPropertySerializer(blocks, many=True).data)
