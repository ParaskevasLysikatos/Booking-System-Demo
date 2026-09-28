from django.db import IntegrityError, transaction
from rest_framework import serializers

from listings.models import Property

from .models import Review, has_finished_stay

MAX_COMMENT_LENGTH = 1000


def author_name(user):
    """How a reviewer is shown publicly: "Maria K." - never the email.
    Falls back to "Guest" for accounts without a first name."""
    first = (user.first_name or "").strip()
    last = (user.last_name or "").strip()
    if not first:
        return "Guest"
    return f"{first} {last[0].upper()}." if last else first


class ReviewSerializer(serializers.ModelSerializer):
    """Public shape: what anyone sees under a property."""

    author_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ["id", "rating", "comment", "author_name", "created_at"]
        read_only_fields = fields

    def get_author_name(self, obj):
        return author_name(obj.guest)


class MyReviewSerializer(serializers.ModelSerializer):
    """The caller's own review, as embedded in a property detail or a
    booking row (`my_review`)."""

    class Meta:
        model = Review
        fields = ["id", "rating", "comment", "created_at"]
        read_only_fields = fields


class ReviewCreateSerializer(serializers.Serializer):
    """POST /api/reviews/ body: property, rating (1-5), comment (optional).

    The guest is always the logged-in user. Allowed only after a confirmed
    stay at that property has ended, and only once per property - reviews
    are final, there's no edit or delete.
    """

    property = serializers.PrimaryKeyRelatedField(queryset=Property.objects.all())
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(
        max_length=MAX_COMMENT_LENGTH, required=False, allow_blank=True, default="", trim_whitespace=True
    )

    def validate_property(self, prop):
        if not prop.is_active:
            raise serializers.ValidationError("This property isn't available.")
        return prop

    def validate(self, attrs):
        user = self.context["request"].user
        prop = attrs["property"]
        if Review.objects.filter(property=prop, guest=user).exists():
            raise serializers.ValidationError("You've already reviewed this place.")
        if not has_finished_stay(user, prop.id):
            raise serializers.ValidationError(
                "You can review a place once a confirmed stay there has ended."
            )
        return attrs

    def create(self, validated_data):
        try:
            # Two quick submits can both pass validate(); the DB's
            # one-review-per-guest-per-property constraint decides.
            with transaction.atomic():
                return Review.objects.create(guest=self.context["request"].user, **validated_data)
        except IntegrityError:
            raise serializers.ValidationError(
                {"non_field_errors": ["You've already reviewed this place."]}
            )


class AdminReviewPropertySerializer(serializers.ModelSerializer):
    class Meta:
        model = Property
        fields = ["id", "title"]


class AdminReviewSerializer(serializers.ModelSerializer):
    """Admin Reviews page row. Only `is_hidden` is writable (PATCH)."""

    property = AdminReviewPropertySerializer(read_only=True)
    author_name = serializers.SerializerMethodField()
    guest_email = serializers.EmailField(source="guest.email", read_only=True)
    is_hidden = serializers.BooleanField(required=True)

    class Meta:
        model = Review
        fields = [
            "id",
            "property",
            "rating",
            "comment",
            "author_name",
            "guest_email",
            "is_hidden",
            "created_at",
        ]
        read_only_fields = ["id", "property", "rating", "comment", "author_name", "guest_email", "created_at"]

    def get_author_name(self, obj):
        return author_name(obj.guest)


class AdminReviewFilterSerializer(serializers.Serializer):
    """Query params for GET /api/admin/reviews/."""

    rating = serializers.IntegerField(required=False, min_value=1, max_value=5)
    property = serializers.IntegerField(required=False, min_value=1)
    hidden = serializers.ChoiceField(choices=["true", "false"], required=False)
    search = serializers.CharField(required=False, allow_blank=True, max_length=100)
