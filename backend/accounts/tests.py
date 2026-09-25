from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from .models import Profile

User = get_user_model()

STRONG_PASSWORD = "S3cure-Booking-Pass!"


class RegisterTests(APITestCase):
    url = reverse("auth-register")

    def test_register_creates_user_and_guest_profile_and_returns_tokens(self):
        resp = self.client.post(
            self.url,
            {
                "email": "Maria@Example.com",
                "password": STRONG_PASSWORD,
                "first_name": "Maria",
                "phone": "+30 2310 000000",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.assertEqual(resp.data["user"]["email"], "maria@example.com")
        self.assertEqual(resp.data["user"]["role"], "guest")
        self.assertFalse(resp.data["user"]["is_admin"])

        user = User.objects.get(email="maria@example.com")
        self.assertEqual(user.username, "maria@example.com")
        self.assertTrue(user.check_password(STRONG_PASSWORD))
        self.assertEqual(user.profile.role, Profile.Role.GUEST)
        self.assertEqual(user.profile.phone, "+30 2310 000000")
        self.assertEqual(Profile.objects.filter(user=user).count(), 1)
        self.assertNotIn("password", resp.data["user"])

    def test_role_cannot_be_self_assigned(self):
        resp = self.client.post(
            self.url,
            {"email": "sneaky@example.com", "password": STRONG_PASSWORD, "role": "admin"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            User.objects.get(email="sneaky@example.com").profile.role,
            Profile.Role.GUEST,
        )

    def test_duplicate_email_rejected_case_insensitively(self):
        User.objects.create_user("existing", "taken@example.com", STRONG_PASSWORD)
        resp = self.client.post(
            self.url, {"email": "TAKEN@example.com", "password": STRONG_PASSWORD}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", resp.data)

    def test_weak_password_rejected(self):
        for weak in ["123", "password", "12345678901"]:
            resp = self.client.post(
                self.url, {"email": "weak@example.com", "password": weak}, format="json"
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, weak)
            self.assertIn("password", resp.data)
        self.assertFalse(User.objects.filter(email="weak@example.com").exists())

    def test_missing_or_invalid_email_rejected(self):
        for payload in [{"password": STRONG_PASSWORD}, {"email": "not-an-email", "password": STRONG_PASSWORD}]:
            resp = self.client.post(self.url, payload, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn("email", resp.data)

    def test_stale_bearer_token_does_not_block_register(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        resp = self.client.post(
            self.url, {"email": "fresh@example.com", "password": STRONG_PASSWORD}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)


class LoginRefreshMeTests(APITestCase):
    login_url = reverse("auth-login")
    refresh_url = reverse("auth-refresh")
    me_url = reverse("auth-me")

    def setUp(self):
        self.guest = User.objects.create_user("guest_1", "guest@example.com", STRONG_PASSWORD)
        self.admin = User.objects.create_superuser("admin_demo", "admin_demo@example.com", STRONG_PASSWORD)

    def login(self, email, password=STRONG_PASSWORD):
        return self.client.post(self.login_url, {"email": email, "password": password}, format="json")

    def test_login_returns_access_and_refresh_with_role_claims(self):
        resp = self.login("guest@example.com")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.assertEqual(resp.data["user"]["role"], "guest")

        claims = AccessToken(resp.data["access"])
        self.assertEqual(str(claims["user_id"]), str(self.guest.id))
        self.assertEqual(claims["role"], "guest")
        self.assertEqual(claims["email"], "guest@example.com")

    def test_admin_login_carries_admin_role(self):
        resp = self.login("admin_demo@example.com")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(AccessToken(resp.data["access"])["role"], "admin")
        self.assertTrue(resp.data["user"]["is_admin"])

    def test_login_email_is_case_insensitive(self):
        self.assertEqual(self.login("GUEST@Example.COM").status_code, status.HTTP_200_OK)

    def test_bad_credentials_return_401(self):
        self.assertEqual(self.login("guest@example.com", "wrong-pass").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.login("nobody@example.com").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_by_username_is_not_accepted(self):
        resp = self.client.post(self.login_url, {"username": "guest_1", "password": STRONG_PASSWORD}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_user_cannot_log_in(self):
        self.guest.is_active = False
        self.guest.save()
        self.assertEqual(self.login("guest@example.com").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_ambiguous_duplicate_email_refuses_login(self):
        # Legacy data could contain duplicates (Django's User doesn't enforce
        # unique email) - refuse rather than pick an account at random.
        User.objects.create_user("guest_dup", "GUEST@example.com", STRONG_PASSWORD)
        self.assertEqual(self.login("guest@example.com").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_returns_new_access_token_with_claims(self):
        refresh = self.login("guest@example.com").data["refresh"]
        resp = self.client.post(self.refresh_url, {"refresh": refresh}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(AccessToken(resp.data["access"])["role"], "guest")

    def test_invalid_refresh_token_returns_401(self):
        resp = self.client.post(self.refresh_url, {"refresh": "garbage"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_access_token_cannot_be_used_as_refresh(self):
        access = self.login("guest@example.com").data["access"]
        resp = self.client.post(self.refresh_url, {"refresh": access}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_requires_authentication(self):
        self.assertEqual(self.client.get(self.me_url).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_returns_current_user_with_live_role(self):
        access = self.login("guest@example.com").data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        resp = self.client.get(self.me_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["email"], "guest@example.com")
        self.assertEqual(resp.data["role"], "guest")

        # Promote after the token was issued: /me/ reflects it immediately
        # even though the token's claim is still 'guest'.
        self.guest.profile.role = Profile.Role.ADMIN
        self.guest.profile.save()
        self.assertEqual(self.client.get(self.me_url).data["role"], "admin")

    def test_admin_site_username_login_still_works(self):
        self.assertTrue(self.client.login(username="admin_demo", password=STRONG_PASSWORD))


class AdminPermissionTests(APITestCase):
    """TICKET-014: IsAdminRole / IsAdminOrReadOnly read Profile.role from the
    DB on every request - never the token's role claim."""

    def setUp(self):
        from rest_framework.test import APIRequestFactory

        self.factory = APIRequestFactory()
        self.guest = User.objects.create_user("g", "g@example.com", STRONG_PASSWORD)
        self.admin = User.objects.create_superuser("a", "a@example.com", STRONG_PASSWORD)

    def _request(self, method, user=None):
        from rest_framework.request import Request

        req = Request(getattr(self.factory, method)("/"))
        req.user = user if user is not None else __import__(
            "django.contrib.auth.models", fromlist=["AnonymousUser"]
        ).AnonymousUser()
        return req

    def test_is_app_admin(self):
        from .permissions import is_app_admin

        self.assertTrue(is_app_admin(self.admin))
        self.assertFalse(is_app_admin(self.guest))
        self.admin.is_active = False
        self.assertFalse(is_app_admin(self.admin))

    def test_role_not_is_staff_decides(self):
        from .permissions import is_app_admin

        # Staff flag without the admin role -> not an app admin...
        self.guest.is_staff = True
        self.guest.save()
        self.assertFalse(is_app_admin(self.guest))
        # ...and the admin role without staff -> app admin.
        self.guest.is_staff = False
        self.guest.save()
        self.guest.profile.role = Profile.Role.ADMIN
        self.guest.profile.save()
        self.assertTrue(is_app_admin(User.objects.get(pk=self.guest.pk)))

    def test_missing_profile_is_not_admin(self):
        from .permissions import is_app_admin

        Profile.objects.filter(user=self.admin).delete()
        self.assertFalse(is_app_admin(User.objects.get(pk=self.admin.pk)))

    def test_is_admin_role_permission(self):
        from .permissions import IsAdminRole

        perm = IsAdminRole()
        self.assertTrue(perm.has_permission(self._request("get", self.admin), None))
        self.assertFalse(perm.has_permission(self._request("get", self.guest), None))
        self.assertFalse(perm.has_permission(self._request("get"), None))

    def test_is_admin_or_read_only_permission(self):
        from .permissions import IsAdminOrReadOnly

        perm = IsAdminOrReadOnly()
        for method in ["get", "head", "options"]:
            self.assertTrue(perm.has_permission(self._request(method), None))
            self.assertTrue(perm.has_permission(self._request(method, self.guest), None))
        for method in ["post", "put", "patch", "delete"]:
            self.assertFalse(perm.has_permission(self._request(method), None))
            self.assertFalse(perm.has_permission(self._request(method, self.guest), None))
            self.assertTrue(perm.has_permission(self._request(method, self.admin), None))
