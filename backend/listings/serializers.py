from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from bookings.models import Booking

from reviews.models import Review, has_finished_stay
from reviews.serializers import MyReviewSerializer

from . import geo
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


class FavoriteFieldsMixin(serializers.Serializer):
    """TICKET-033. `is_favorite` - has the caller saved this property (False
    when logged out). `favorite_count` - how many accounts saved it; only in
    admin responses (the view sets context["show_favorite_count"]), guests
    never see it. Both come from annotations (listings/queries.py)."""

    is_favorite = serializers.SerializerMethodField()
    favorite_count = serializers.SerializerMethodField()

    def get_fields(self):
        fields = super().get_fields()
        if not self.context.get("show_favorite_count"):
            fields.pop("favorite_count", None)
        return fields

    def get_is_favorite(self, obj):
        return bool(getattr(obj, "is_favorite", False))

    def get_favorite_count(self, obj):
        return getattr(obj, "favorite_count", 0) or 0


class CoordinateField(serializers.DecimalField):
    """A latitude/longitude. Accepts any number of decimals (a map click
    gives ~15) and rounds to the 6 the database keeps, instead of DRF's
    default "no more than 6 decimal places" error. Rendered as a JSON
    number, not a string. null or "" clears it."""

    def __init__(self, **kwargs):
        super().__init__(
            max_digits=9, decimal_places=6, coerce_to_string=False,
            allow_null=True, required=False, **kwargs,
        )

    def validate_empty_values(self, data):
        if data == "":
            data = None
        return super().validate_empty_values(data)

    def to_internal_value(self, data):
        if isinstance(data, bool):
            self.fail("invalid")
        try:
            value = Decimal(str(data).strip())
        except (ArithmeticError, ValueError, TypeError):
            self.fail("invalid")
        if not value.is_finite():
            self.fail("invalid")
        return super().to_internal_value(geo.quantize(value))


class CoordinatesMixin(serializers.Serializer):
    """TICKET-034. `latitude` / `longitude` - exact for admins (the view sets
    context["exact_location"]); for everyone else an approximate point
    100-400 m away (listings/geo.py), with `location_is_approximate: true`
    and `location_radius_m: 500` - the circle the map draws, which always
    contains the real point. null / null when the property has no position."""

    latitude = CoordinateField(min_value=-90, max_value=90)
    longitude = CoordinateField(min_value=-180, max_value=180)
    location_is_approximate = serializers.SerializerMethodField()
    location_radius_m = serializers.SerializerMethodField()

    def _exact(self):
        return bool(self.context.get("exact_location"))

    def get_location_is_approximate(self, obj):
        return not self._exact()

    def get_location_radius_m(self, obj):
        return None if self._exact() else geo.APPROX_RADIUS_METRES

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._exact() and "latitude" in data:
            data["latitude"], data["longitude"] = geo.approximate_point(
                instance.pk, instance.latitude, instance.longitude
            )
        return data

    def validate(self, attrs):
        # Both or neither - taking the stored value for a field a PATCH
        # leaves out.
        attrs = super().validate(attrs)

        def final(name):
            return attrs[name] if name in attrs else getattr(self.instance, name, None)

        lat, lng = final("latitude"), final("longitude")
        if lat is None and lng is not None:
            raise serializers.ValidationError({"latitude": ["Set a latitude too, or clear the longitude."]})
        if lng is None and lat is not None:
            raise serializers.ValidationError({"longitude": ["Set a longitude too, or clear the latitude."]})
        return attrs


def _cover_url(obj):
    # Iterate the prefetched images (already ordered cover-first by
    # PropertyImage.Meta.ordering) instead of querying again.
    images = list(obj.images.all())
    return images[0].image if images else None


class PropertyListSerializer(RatingFieldsMixin, FavoriteFieldsMixin, CoordinatesMixin, serializers.ModelSerializer):
    """Compact shape for the listings grid (one card per property)."""

    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = [
            "id",
            "title",
            "location",
            "latitude",
            "longitude",
            "location_is_approximate",
            "location_radius_m",
            "price_per_night",
            "capacity",
            "amenities",
            "is_active",
            "cover_image",
            "rating_avg",
            "review_count",
            "is_favorite",
            "favorite_count",
        ]

    def get_cover_image(self, obj):
        return _cover_url(obj)


class PropertyDetailSerializer(RatingFieldsMixin, FavoriteFieldsMixin, CoordinatesMixin, serializers.ModelSerializer):
    """Full shape for the detail page - and the write serializer for admin
    POST/PUT/PATCH.

    `images` is writable (nested): send a list of {image, is_cover} to set
    the property's photos in the same call. On update, sending `images`
    *replaces* the whole image set; leaving it out leaves images untouched.
    """

    images = PropertyImageSerializer(many=True, required=False)
    cover_image = serializers.SerializerMethodField()
    availability = serializers.SerializerMethodField()
    viewer_review = serializers.SerializerMethodField()
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
            "latitude",
            "longitude",
            "location_is_approximate",
            "location_radius_m",
            "price_per_night",
            "capacity",
            "amenities",
            "is_active",
            "cover_image",
            "images",
            "rating_avg",
            "review_count",
            "availability",
            "viewer_review",
            "is_favorite",
            "favorite_count",
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

    def get_viewer_review(self, obj):
        """The caller's relationship to this property's reviews (TICKET-032):
        `my_review` if they've already posted one (reviews are final), and
        `can_review` - true only for a logged-in guest with an ended,
        confirmed stay here and no review yet. Anonymous: false / null."""
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            return {"can_review": False, "my_review": None}
        mine = Review.objects.filter(property=obj, guest=user).first()
        return {
            "can_review": mine is None and obj.is_active and has_finished_stay(user, obj.id),
            "my_review": MyReviewSerializer(mine).data if mine else None,
        }

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
