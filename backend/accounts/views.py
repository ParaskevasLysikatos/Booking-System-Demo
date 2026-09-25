from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import (
    EmailTokenObtainPairSerializer,
    RegisterSerializer,
    UserSerializer,
    tokens_for_user,
)


class RegisterView(generics.GenericAPIView):
    """POST /api/auth/register/ - create a guest account and return it along
    with an access/refresh token pair, so the user is logged in straight
    away."""

    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    # No authentication on this endpoint: a stale/expired token still
    # attached by the frontend's interceptor would otherwise make JWT auth
    # reject the request with 401 before registration even runs.
    authentication_classes = []

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {"user": UserSerializer(user).data, **tokens_for_user(user)},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ - email + password -> access + refresh tokens
    (plus the user object)."""

    serializer_class = EmailTokenObtainPairSerializer
    authentication_classes = []  # same reasoning as RegisterView


class MeView(generics.RetrieveAPIView):
    """GET /api/auth/me/ - the currently authenticated user, with their
    up-to-date role. Always current, unlike the role claim baked into the
    token."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user
