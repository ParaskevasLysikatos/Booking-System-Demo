from rest_framework.routers import SimpleRouter

from .views import PropertyViewSet

router = SimpleRouter(trailing_slash=True)
router.register("properties", PropertyViewSet, basename="property")

urlpatterns = router.urls
