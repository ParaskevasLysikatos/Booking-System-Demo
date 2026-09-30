from django.urls import path
from rest_framework.routers import SimpleRouter

from .blocks import PropertyBlockDetailView, PropertyBlocksView
from .views import GeocodeView, PropertyViewSet

router = SimpleRouter(trailing_slash=True)
router.register("properties", PropertyViewSet, basename="property")

urlpatterns = [
    path("admin/geocode/", GeocodeView.as_view(), name="admin-geocode"),  # TICKET-034
    # TICKET-045: closed dates
    path("admin/properties/<int:property_id>/blocks/", PropertyBlocksView.as_view(), name="admin-property-blocks"),
    path("admin/properties/<int:property_id>/blocks/<int:block_id>/", PropertyBlockDetailView.as_view(),
         name="admin-property-block-detail"),
    *router.urls,
]
