from django.urls import path

from .views import FavoriteDetailView, FavoriteListView

urlpatterns = [
    path("favorites/", FavoriteListView.as_view(), name="favorite-list"),
    path("favorites/<int:property_id>/", FavoriteDetailView.as_view(), name="favorite-detail"),
]
