from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LoginView, MeView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    # authentication_classes=[] for the same stale-token reason as login.
    path(
        "refresh/",
        TokenRefreshView.as_view(authentication_classes=[]),
        name="auth-refresh",
    ),
    path("me/", MeView.as_view(), name="auth-me"),
]
