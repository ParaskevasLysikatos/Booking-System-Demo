from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import AdminStatsView, BookingViewSet

router = SimpleRouter(trailing_slash=True)
router.register("bookings", BookingViewSet, basename="booking")

urlpatterns = [
    path("admin/stats/", AdminStatsView.as_view(), name="admin-stats"),
    *router.urls,
]
