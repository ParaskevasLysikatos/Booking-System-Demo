from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Subquery
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.pagination import StandardPagination
from listings.models import Property
from listings.queries import property_cards

from .models import Favorite
from .serializers import SavedPropertySerializer


class FavoriteListView(generics.ListAPIView):
    """GET /api/favorites/ (TICKET-033) - logged-in only.

    The caller's saved properties, most recently saved first, 12 per page,
    as listing cards + `saved_at`. Deactivated properties stay in the list
    (`is_active: false`) so the page can show them as "No longer available".
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = SavedPropertySerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        user = self.request.user
        saved_at = Favorite.objects.filter(user=user, property=OuterRef("pk")).values("created_at")[:1]
        return (
            property_cards(user)
            .filter(is_favorite=True)
            .annotate(saved_at=Subquery(saved_at))
            .order_by("-saved_at", "-id")
        )


class FavoriteDetailView(APIView):
    """/api/favorites/{property_id}/ (TICKET-033) - logged-in only.

    - PUT    - save the property. 201 the first time, 200 if it was already
               saved (safe to repeat). Only active properties can be saved:
               an inactive or unknown one is a 404, as on the detail page.
    - DELETE - remove it. Always 204, also if it wasn't saved or the
               property has since been deactivated (safe to repeat).
    """

    permission_classes = [permissions.IsAuthenticated]

    @staticmethod
    def _body(favorite):
        # saved_at formatted like every other DRF date (local time zone),
        # so it matches `saved_at` in GET /api/favorites/.
        saved_at = serializers.DateTimeField().to_representation(favorite.created_at)
        return {"property": favorite.property_id, "is_favorite": True, "saved_at": saved_at}

    def put(self, request, property_id):
        prop = get_object_or_404(Property.objects.filter(is_active=True), pk=property_id)
        try:
            # Two quick taps can race; the unique constraint decides and the
            # loser just reads the row the winner created.
            with transaction.atomic():
                favorite, created = Favorite.objects.get_or_create(user=request.user, property=prop)
        except IntegrityError:
            favorite, created = Favorite.objects.get(user=request.user, property=prop), False
        return Response(self._body(favorite), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request, property_id):
        Favorite.objects.filter(user=request.user, property_id=property_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
