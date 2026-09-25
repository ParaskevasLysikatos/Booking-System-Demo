from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from bookings.models import Booking

from .models import Property, PropertyImage


class PropertyImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyImage
        fields = ["id", "image", "is_cover"]
        read_only_fields = ["id"]


class RatingFieldsMixin(serializers.Serializer):
    """rating_avg / review_count come from queryset annotations
    (PropertyViewSet.get_queryset) - one SQL query for the whole page, not
    one per property."""

    rating_avg = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    def get_rating_avg(self, obj):
        avg = getattr(obj, "rating_avg", None)
        return round(float(avg), 1) if avg is not None else None

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0) or 0


def _cover_url(obj):
    # Iterate the prefetched images (already ordered cover-first by
    # PropertyImage.Meta.ordering) instead of querying again.
    images = list(obj.images.all())
    return images[0].image if images else None


class PropertyListSerializer(RatingFieldsMixin, serializers.ModelSerializer):
    """Compact shape for the listings grid (one card per property)."""

    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = [
            "id",
            "title",
            "location",
            "price_per_night",
            "capacity",
            "amenities",
            "is_active",
            "cover_image",
            "rating_avg",
            "review_count",
        ]

    def get_cover_image(self, obj):
        return _cover_url(obj)


class PropertyDetailSerializer(RatingFieldsMixin, serializers.ModelSerializer):
    """Full shape for the detail page - and the write serializer for admin
    POST/PUT/PATCH.

    `images` is writable (nested): send a list of {image, is_cover} to set
    the property's photos in the same call. On update, sending `images`
    *replaces* the whole image set; leaving it out leaves images untouched.
    """

    images = PropertyImageSerializer(many=True, required=False)
    cover_image = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    price_per_night = serializers.DecimalField(
        max_digits=8, decimal_places=2, min_value=Decimal("0.01")
    )
    capacity = serializers.IntegerField(min_value=1)
    amenities = serializers.ListField(
        child=serializers.CharField(max_length=50, allow_blank=True), required=False
    )

    class Meta:
        model = Property
        fields = [
            "id",
            "title",
            "description",
            "location",
            "price_per_night",
            "capacity",
            "amenities",
            "is_active",
            "cover_image",
            "images",
            "rating_avg",
            "review_count",
            "availability",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    # --- read side -------------------------------------------------------

    def get_cover_image(self, obj):
        return _cover_url(obj)

    def get_availability(self, obj):
        """Upcoming booked date ranges (for the detail page's calendar) and,
        if the view validated a ?check_in=&check_out= pair, whether that
        exact stay is free. Only dates are exposed - never who booked or the
        booking status."""
        today = timezone.localdate()
        booked = (
            Booking.objects.filter(property=obj, check_out__gt=today)
            .exclude(status=Booking.Status.CANCELLED)
            .order_by("check_in")
            .values("check_in", "check_out")
        )
        data = {"booked_ranges": list(booked)}

        dates = self.context.get("requested_dates")
        if dates:
            data["check_in"] = dates["check_in"]
            data["check_out"] = dates["check_out"]
            data["is_available"] = not Booking.objects.overlapping(
                obj, dates["check_in"], dates["check_out"]
            ).exists()
        return data

    # --- write side ------------------------------------------------------

    def validate_amenities(self, value):
        # Trim, drop blanks and duplicates (case-insensitive), keep order.
        seen, cleaned = set(), []
        for item in value:
            label = item.strip()
            if label and label.lower() not in seen:
                seen.add(label.lower())
                cleaned.append(label)
        return cleaned

    def validate_images(self, value):
        if sum(1 for img in value if img.get("is_cover")) > 1:
            raise serializers.ValidationError("Only one image can be the cover.")
        return value

    @staticmethod
    def _replace_images(prop, images):
        prop.images.all().delete()
        for img in images:
            # One save() at a time so PropertyImage.save()'s cover hand-off
            # logic runs; the DB constraint stays the backstop.
            PropertyImage.objects.create(property=prop, **img)

    @transaction.atomic
    def create(self, validated_data):
        images = validated_data.pop("images", [])
        prop = Property.objects.create(**validated_data)
        self._replace_images(prop, images)
        return prop

    @transaction.atomic
    def update(self, instance, validated_data):
        images = validated_data.pop("images", None)
        instance = super().update(instance, validated_data)
        if images is not None:
            self._replace_images(instance, images)
        return instance
