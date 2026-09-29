from django.utils.translation import gettext as _
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsAdminOrReadOnly, IsAdminRole, is_app_admin
from core.pagination import StandardPagination

from . import geocoding
from .filters import DateRangeQuerySerializer, apply_property_filters
from .queries import property_cards
from .serializers import PropertyDetailSerializer, PropertyListSerializer, PropertyPinSerializer

# The most pins GET /api/properties/map/ returns in one response. Far above
# the demo's data; it only stops a huge result from being sent in one go
# (the response says `truncated: true` if it ever kicks in).
MAP_PIN_LIMIT = 500


class PropertyViewSet(viewsets.ModelViewSet):
    """/api/properties/ (TICKET-013)

    - GET list      - anyone; filterable (see listings/filters.py), paginated
    - GET detail    - anyone; includes images + availability
    - POST/PUT/PATCH - admin only (Profile.role == 'admin')
    - DELETE        - admin only; *soft* delete (is_active=False), since
                      bookings reference properties with on_delete=PROTECT
    - GET map       - anyone; /api/properties/map/ - every stay matching the
                      same filters as the list, as map pins (TICKET-034)

    Guests/anonymous only ever see active properties (an inactive one is a
    404 for them); admins see everything and can filter with ?is_active=.
    """

    permission_classes = [IsAdminOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.action == "list":
            return PropertyListSerializer
        if self.action == "map":
            return PropertyPinSerializer
        return PropertyDetailSerializer

    def _is_admin(self):
        # Cached per request so the Profile lookup happens once.
        if not hasattr(self, "_admin_flag"):
            self._admin_flag = is_app_admin(self.request.user)
        return self._admin_flag

    def get_queryset(self):
        # Ratings, the caller's is_favorite and (admins) favorite_count -
        # see listings/queries.py.
        qs = property_cards(self.request.user, with_favorite_count=self._is_admin()).order_by("-created_at", "-id")
        if self.action in ("list", "map"):
            return apply_property_filters(qs, self.request.query_params, is_admin=self._is_admin())
        if not self._is_admin():
            qs = qs.filter(is_active=True)
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["show_favorite_count"] = self._is_admin()
        # TICKET-034: admins get exact coordinates, everyone else an
        # approximate point (listings/geo.py).
        context["exact_location"] = self._is_admin()
        if self.action == "retrieve":
            dates = DateRangeQuerySerializer(data=self.request.query_params)
            dates.is_valid(raise_exception=True)
            if dates.validated_data.get("check_in"):
                context["requested_dates"] = dates.validated_data
        return context

    @action(detail=False, methods=["get"], url_path="map")
    def map(self, request):
        """GET /api/properties/map/ (TICKET-034): the pins for the listings
        map - *every* stay matching the filters (same params and 400s as the
        list: dates, location, guests, prices, ordering, is_active for
        admins), not one page of 12. Stays without a map position aren't
        pins; `missing_position` counts them so the page can say so."""
        qs = self.get_queryset()
        with_position = qs.filter(latitude__isnull=False, longitude__isnull=False)
        total = with_position.count()
        pins = list(with_position[:MAP_PIN_LIMIT])
        return Response({
            "count": total,
            "missing_position": qs.filter(latitude__isnull=True).count(),
            "truncated": total > MAP_PIN_LIMIT,
            "results": self.get_serializer(pins, many=True).data,
        })

    def _respond_with_fresh(self, instance, status_code):
        # Re-read through get_queryset() so the response carries the same
        # annotations/prefetches (rating, cover) as a normal GET.
        fresh = self.get_queryset().get(pk=instance.pk)
        return Response(self.get_serializer(fresh).data, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        return self._respond_with_fresh(instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        return self._respond_with_fresh(instance, status.HTTP_200_OK)

    def perform_destroy(self, instance):
        # Soft delete: keeps booking/review history intact. Re-activate with
        # PATCH {"is_active": true}.
        if instance.is_active:
            instance.is_active = False
            instance.save(update_fields=["is_active", "updated_at"])


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=200, trim_whitespace=True)


class GeocodeThrottle(UserRateThrottle):
    """Per admin: plenty for typing searches by hand, but a runaway client
    can't hammer Nominatim through us (it's also cached and spaced 1/s)."""

    scope = "geocode"
    rate = "30/min"


class GeocodeView(APIView):
    """GET /api/admin/geocode/?q=Tsimiski 45, Thessaloniki (TICKET-034) -
    admin only. Up to 5 specific places in Greece for the property form's
    "Find on map"; see listings/geocoding.py. 503 when the search service
    can't be used (the admin can still place the pin by hand)."""

    permission_classes = [IsAdminRole]
    throttle_classes = [GeocodeThrottle]

    def get(self, request):
        params = GeocodeQuerySerializer(data=request.query_params)
        params.is_valid(raise_exception=True)
        query = params.validated_data["q"]
        try:
            results = geocoding.search(query)
        except geocoding.GeocodingDisabled:
            return Response(
                {"detail": _("Map search is switched off. Place the pin on the map instead."),
                 "code": "geocoding_disabled"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except geocoding.GeocodingError:
            return Response(
                {"detail": _("Map search isn't available right now. Try again in a moment, "
                             "or place the pin on the map."),
                 "code": "geocoding_unavailable"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response({"query": query, "results": results, "attribution": geocoding.ATTRIBUTION})
