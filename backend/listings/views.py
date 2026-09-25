from django.db.models import Avg, Count, Prefetch
from rest_framework import status, viewsets
from rest_framework.response import Response

from accounts.permissions import IsAdminOrReadOnly, is_app_admin
from core.pagination import StandardPagination

from .filters import DateRangeQuerySerializer, apply_property_filters
from .models import Property, PropertyImage
from .serializers import PropertyDetailSerializer, PropertyListSerializer


class PropertyViewSet(viewsets.ModelViewSet):
    """/api/properties/ (TICKET-013)

    - GET list      - anyone; filterable (see listings/filters.py), paginated
    - GET detail    - anyone; includes images + availability
    - POST/PUT/PATCH - admin only (Profile.role == 'admin')
    - DELETE        - admin only; *soft* delete (is_active=False), since
                      bookings reference properties with on_delete=PROTECT

    Guests/anonymous only ever see active properties (an inactive one is a
    404 for them); admins see everything and can filter with ?is_active=.
    """

    permission_classes = [IsAdminOrReadOnly]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        return PropertyListSerializer if self.action == "list" else PropertyDetailSerializer

    def _is_admin(self):
        # Cached per request so the Profile lookup happens once.
        if not hasattr(self, "_admin_flag"):
            self._admin_flag = is_app_admin(self.request.user)
        return self._admin_flag

    def get_queryset(self):
        qs = (
            Property.objects.annotate(
                rating_avg=Avg("reviews__rating"),
                review_count=Count("reviews", distinct=True),
            )
            .prefetch_related(Prefetch("images", queryset=PropertyImage.objects.all()))
            .order_by("-created_at", "-id")
        )
        if self.action == "list":
            return apply_property_filters(qs, self.request.query_params, is_admin=self._is_admin())
        if not self._is_admin():
            qs = qs.filter(is_active=True)
        return qs

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "retrieve":
            dates = DateRangeQuerySerializer(data=self.request.query_params)
            dates.is_valid(raise_exception=True)
            if dates.validated_data.get("check_in"):
                context["requested_dates"] = dates.validated_data
        return context

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
