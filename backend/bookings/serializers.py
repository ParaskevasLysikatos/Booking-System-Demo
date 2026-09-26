from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from listings.models import Property
from payments.serializers import payment_summary

from .models import Booking

MAX_NIGHTS = 30
MAX_DAYS_AHEAD = 365


class BookingPropertySummarySerializer(serializers.ModelSerializer):
    """Just enough of the property to render a booking row/card."""

    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = ["id", "title", "location", "price_per_night", "cover_image"]

    def get_cover_image(self, obj):
        images = list(obj.images.all())  # prefetched, cover-first
        return images[0].image if images else None


class BookingSerializer(serializers.ModelSerializer):
    """Read shape for every booking response."""

    property = BookingPropertySummarySerializer(read_only=True)
    nights = serializers.SerializerMethodField()
    guest_email = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    cancel_deadline = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id",
            "property",
            "check_in",
            "check_out",
            "nights",
            "guests",
            "total_price",
            "status",
            "can_cancel",
            "cancel_deadline",
            "payment",
            "guest_email",
            "created_at",
        ]
        read_only_fields = fields

    def get_nights(self, obj):
        return obj.get_nights()

    def get_guest_email(self, obj):
        # Only admins see who booked; a guest only ever sees their own
        # bookings anyway, so they get null here.
        return obj.guest.email if self.context.get("is_admin") else None

    def get_can_cancel(self, obj):
        """Whether the *current caller* may cancel this booking right now -
        lets the frontend show/hide the Cancel button without duplicating
        the rules."""
        if obj.status == Booking.Status.CANCELLED:
            return False
        if self.context.get("is_admin"):
            return True
        return obj.guest_can_cancel()

    def get_cancel_deadline(self, obj):
        """When free guest cancellation ends (48h before check-in at
        15:00 local by default) - so the UI can say "Free cancellation
        until Wed 15:00"."""
        return serializers.DateTimeField().to_representation(obj.cancel_deadline())

    def get_payment(self, obj):
        """Online payment state (TICKET-029), or null when this booking
        doesn't take online payment (seeded / made while payments were off)."""
        return payment_summary(obj, self.context.get("request"))


class BookingCreateSerializer(serializers.Serializer):
    """POST body: property, check_in, check_out, guests.

    Everything else is decided by the server: total_price is computed from
    the property's current nightly price (any client-sent price is ignored),
    status always starts as pending (with payments on, the Stripe webhook
    confirms it once the money has arrived - TICKET-029), and guest is the
    logged-in user.
    """

    property = serializers.PrimaryKeyRelatedField(queryset=Property.objects.all())
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    guests = serializers.IntegerField(min_value=1, default=1)

    def validate_property(self, prop):
        if not prop.is_active:
            raise serializers.ValidationError("This property isn't available for booking.")
        return prop

    def validate(self, attrs):
        today = timezone.localdate()
        check_in, check_out = attrs["check_in"], attrs["check_out"]
        errors = {}
        if check_in < today:
            errors["check_in"] = ["check_in can't be in the past."]
        elif check_in > today + timedelta(days=MAX_DAYS_AHEAD):
            errors["check_in"] = [f"Bookings open at most {MAX_DAYS_AHEAD} days ahead."]
        if check_out <= check_in:
            errors["check_out"] = ["check_out must be after check_in."]
        elif (check_out - check_in).days > MAX_NIGHTS:
            errors["check_out"] = [f"A stay can be at most {MAX_NIGHTS} nights."]
        if attrs["guests"] > attrs["property"].capacity:
            errors["guests"] = [f"This property sleeps at most {attrs['property'].capacity} guests."]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated_data):
        prop = validated_data["property"]
        nights = (validated_data["check_out"] - validated_data["check_in"]).days
        return Booking.objects.create(
            property=prop,
            guest=self.context["request"].user,
            check_in=validated_data["check_in"],
            check_out=validated_data["check_out"],
            guests=validated_data["guests"],
            total_price=prop.price_per_night * nights,
            status=Booking.Status.PENDING,
        )


class BookingStatusSerializer(serializers.Serializer):
    """PATCH body: only `status` can change. Whether the transition is
    allowed is decided in the view, against the row locked with
    select_for_update(), so it's checked against the current DB state."""

    status = serializers.ChoiceField(choices=Booking.Status.choices)

    def validate(self, attrs):
        extra = set(self.initial_data) - {"status"}
        if extra:
            raise serializers.ValidationError(
                {field: ["Only status can be changed on a booking."] for field in sorted(extra)}
            )
        return attrs
