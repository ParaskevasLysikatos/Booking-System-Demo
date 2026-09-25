"""App-level role permissions for the DRF API (TICKET-014).

"Admin" here means Profile.role == 'admin' (the choice made in TICKET-007),
deliberately *not* Django's is_staff/is_superuser - those only gate the
dev-only /admin/ site.

The role is always read from the database via request.user.profile, never
from the `role` claim inside the JWT: JWTAuthentication loads the User row
fresh on every request, so a demotion/promotion takes effect on the very
next request instead of lingering until the token expires. The token claim
is only a UI hint for the frontend.
"""

from django.core.exceptions import ObjectDoesNotExist
from rest_framework.permissions import SAFE_METHODS, BasePermission


def is_app_admin(user):
    """True if `user` is a logged-in, active account whose Profile role is
    admin. A user somehow missing a Profile is treated as not-admin rather
    than raising."""
    if not (user and user.is_authenticated and user.is_active):
        return False
    try:
        return user.profile.is_admin
    except ObjectDoesNotExist:
        return False


class IsAdminRole(BasePermission):
    """Only app admins. Anonymous callers get 401 (JWT auth advertises a
    WWW-Authenticate header), logged-in non-admins get 403."""

    message = "Only admin accounts can perform this action."

    def has_permission(self, request, view):
        return is_app_admin(request.user)


class IsAdminOrReadOnly(BasePermission):
    """Anyone may read (GET/HEAD/OPTIONS); only app admins may write
    (POST/PUT/PATCH/DELETE). Used by the public-browse-but-admin-managed
    endpoints such as /api/properties/."""

    message = "Only admin accounts can modify this resource."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return is_app_admin(request.user)
