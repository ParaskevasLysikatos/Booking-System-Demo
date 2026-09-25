import uuid

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Profile

User = get_user_model()


def tokens_for_user(user):
    """Same access/refresh pair (with the same custom claims) that the login
    endpoint issues - used by register so a new user is logged in
    immediately."""
    refresh = EmailTokenObtainPairSerializer.get_token(user)
    return {"refresh": str(refresh), "access": str(refresh.access_token)}


class UserSerializer(serializers.ModelSerializer):
    """Read-only public shape of a user, flattened with their Profile -
    returned by register, login, and /me/."""

    role = serializers.CharField(source="profile.role", read_only=True)
    phone = serializers.CharField(source="profile.phone", read_only=True)
    is_admin = serializers.BooleanField(source="profile.is_admin", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "phone",
            "is_admin",
        ]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    """Sign-up with email + password. The username (Django's built-in User
    still requires one) is derived from the email automatically - users
    never see or type it.

    Every self-registered account is a guest: `role` is deliberately not an
    accepted field, so nobody can register themselves as an admin. The
    Profile itself is created by the existing post_save signal
    (accounts/signals.py); this serializer only fills in the optional phone
    number on it.
    """

    # Capped at 150 (User.username's max_length) since the username is
    # derived from it.
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(
        write_only=True, trim_whitespace=False, style={"input_type": "password"}
    )
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)

    def validate_email(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError(
                "An account with this email already exists."
            )
        return email

    def validate(self, attrs):
        # Run Django's AUTH_PASSWORD_VALIDATORS (min length, too common,
        # all-numeric, too similar to the email/name) against an unsaved
        # User so the similarity check has something to compare with.
        candidate = User(
            username=attrs["email"],
            email=attrs["email"],
            first_name=attrs.get("first_name", ""),
            last_name=attrs.get("last_name", ""),
        )
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    @staticmethod
    def _username_from_email(email):
        username = email[:150]
        if not User.objects.filter(username__iexact=username).exists():
            return username
        # Extremely unlikely (an existing account's *username* happens to
        # equal this email) - fall back to a unique suffixed variant.
        local = email.split("@", 1)[0][:130]
        return f"{local}-{uuid.uuid4().hex[:8]}"

    @transaction.atomic
    def create(self, validated_data):
        phone = validated_data.pop("phone", "")
        email = validated_data["email"]
        user = User.objects.create_user(
            username=self._username_from_email(email),
            email=email,
            password=validated_data["password"],
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        # Profile already exists at this point (post_save signal, role=guest).
        if phone:
            user.profile.phone = phone
            user.profile.save(update_fields=["phone"])
        return user


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """simplejwt's login serializer, switched to email + password (routed
    through accounts.backends.EmailBackend) and with a few extra claims so
    the frontend can read who's logged in - and whether they're an admin -
    straight from the token without an extra request.

    The claims are a convenience for UI decisions (show/hide the Admin link,
    route guards). They're only as fresh as the token: if an admin changes
    someone's role, the old claim lives until that token expires. The server
    must always re-check Profile.role on admin-only endpoints (TICKET-014)
    rather than trusting the claim, and GET /api/auth/me/ is the
    always-current source of truth.
    """

    username_field = "email"

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        profile = getattr(user, "profile", None)
        token["email"] = user.email
        token["username"] = user.get_username()
        token["role"] = profile.role if profile else Profile.Role.GUEST
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
