from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, mixins, permissions, status, viewsets
from rest_framework.response import Response

from accounts.permissions import IsAdminRole, is_app_admin
from core.pagination import StandardPagination
from listings.models import Property

from .models import Review
from .serializers import (
    AdminReviewFilterSerializer,
    AdminReviewSerializer,
    ReviewCreateSerializer,
    ReviewSerializer,
)


class ReviewPagination(StandardPagination):
    """5 per page fits under the property details; ?page_size= still works."""

    page_size = 5


def rating_summary(queryset):
    """Average, count and how many reviews gave each star rating (5 to 1)
    for an already-filtered queryset of visible reviews."""
    agg = queryset.aggregate(
        rating_avg=Avg("rating"),
        review_count=Count("id"),
        **{f"r{n}": Count("id", filter=Q(rating=n)) for n in range(1, 6)},
    )
    avg = agg["rating_avg"]
    return {
        "rating_avg": round(float(avg), 1) if avg is not None else None,
        "review_count": agg["review_count"],
        "breakdown": [{"rating": n, "count": agg[f"r{n}"]} for n in range(5, 0, -1)],
    }


class PropertyReviewsView(generics.ListAPIView):
    """GET /api/properties/{id}/reviews/ (TICKET-032) - anyone.

    The property's visible reviews, newest first, 5 per page, plus a
    `summary` (average, count, per-star breakdown) over *all* its visible
    reviews. Same visibility as the property itself: an inactive property
    is a 404 for everyone but admins.
    """

    permission_classes = [permissions.AllowAny]
    serializer_class = ReviewSerializer
    pagination_class = ReviewPagination

    def get_property(self):
        if not hasattr(self, "_property"):
            qs = Property.objects.all()
            if not is_app_admin(self.request.user):
                qs = qs.filter(is_active=True)
            self._property = get_object_or_404(qs, pk=self.kwargs["pk"])
        return self._property

    def get_queryset(self):
        return (
            Review.objects.visible()
            .filter(property=self.get_property())
            .select_related("guest")
            .order_by("-created_at", "-id")
        )

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data["summary"] = rating_summary(Review.objects.visible().filter(property=self.get_property()))
        return response


class ReviewViewSet(mixins.CreateModelMixin, viewsets.GenericViewSet):
    """POST /api/reviews/ (TICKET-032) - a logged-in guest reviews a
    property after a confirmed stay there has ended. One per property;
    reviews are final (no PUT/PATCH/DELETE)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ReviewCreateSerializer
    queryset = Review.objects.none()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review = serializer.save()
        return Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED)


class AdminReviewViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """/api/admin/reviews/ (TICKET-032) - admin only.

    - GET   - every review (hidden ones too), newest first, paginated.
              Filters: ?rating=1-5, ?property=<id>, ?hidden=true|false,
              ?search= (property title, guest email or name, comment).
    - PATCH - {"is_hidden": true|false} hides a review or shows it again.
    """

    permission_classes = [IsAdminRole]
    serializer_class = AdminReviewSerializer
    pagination_class = StandardPagination
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return Review.objects.select_related("property", "guest").order_by("-created_at", "-id")

    def filter_queryset(self, queryset):
        if self.action != "list":
            return queryset
        params = AdminReviewFilterSerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        f = params.validated_data
        if f.get("rating"):
            queryset = queryset.filter(rating=f["rating"])
        if f.get("property"):
            queryset = queryset.filter(property_id=f["property"])
        if f.get("hidden"):
            queryset = queryset.filter(is_hidden=f["hidden"] == "true")
        term = f.get("search", "").strip()
        if term:
            queryset = queryset.filter(
                Q(property__title__icontains=term)
                | Q(guest__email__icontains=term)
                | Q(guest__first_name__icontains=term)
                | Q(guest__last_name__icontains=term)
                | Q(comment__icontains=term)
            )
        return queryset
