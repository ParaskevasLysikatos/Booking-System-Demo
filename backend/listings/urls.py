from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import GeocodeView, PropertyViewSet

router = SimpleRouter(trailing_slash=True)
router.register("properties", PropertyViewSet, basename="property")

urlpatterns = [
    path("admin/geocode/", GeocodeView.as_view(), name="admin-geocode"),  # TICKET-034
    *router.urls,
]
