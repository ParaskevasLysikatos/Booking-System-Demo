from rest_framework import serializers

from listings.serializers import PropertyListSerializer


class SavedPropertySerializer(PropertyListSerializer):
    """One card on the Saved page (TICKET-033): the same shape as a
    listings card (so the frontend reuses PropertyCard) plus `saved_at`.
    `is_active` tells the page to grey out a place an admin deactivated."""

    saved_at = serializers.DateTimeField(read_only=True)

    class Meta(PropertyListSerializer.Meta):
        fields = [*PropertyListSerializer.Meta.fields, "saved_at"]
