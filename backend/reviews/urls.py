from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import AdminReviewViewSet, PropertyReviewsView, ReviewViewSet

router = SimpleRouter(trailing_slash=True)
router.register("reviews", ReviewViewSet, basename="review")
router.register("admin/reviews", AdminReviewViewSet, basename="admin-review")

urlpatterns = [
    path("properties/<int:pk>/reviews/", PropertyReviewsView.as_view(), name="property-reviews"),
    *router.urls,
]
