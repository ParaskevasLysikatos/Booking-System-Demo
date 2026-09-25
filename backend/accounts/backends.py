from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """Lets users authenticate with their email address instead of their
    username - the app's login form (and POST /api/auth/login/) asks for
    email + password.

    Added *alongside* Django's default ModelBackend (see
    AUTHENTICATION_BACKENDS in settings), not instead of it, so username
    login keeps working where it's still used: `createsuperuser` accounts
    signing in to the dev-only /admin/ site.

    Matching is case-insensitive (`Foo@Example.com` == `foo@example.com`).
    Django's built-in User doesn't enforce unique emails at the DB level, so
    if two accounts somehow share an email, login is refused rather than
    guessing which account was meant - the register endpoint prevents new
    duplicates from being created in the first place.
    """

    def authenticate(self, request, email=None, password=None, **kwargs):
        if email is None or password is None:
            return None

        UserModel = get_user_model()
        try:
            user = UserModel._default_manager.get(email__iexact=email.strip())
        except UserModel.DoesNotExist:
            # Run the password hasher anyway so a missing account takes about
            # as long as a wrong password (same mitigation ModelBackend uses
            # against user-enumeration timing attacks).
            UserModel().set_password(password)
            return None
        except UserModel.MultipleObjectsReturned:
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
