"""The demo logins the seeder creates (TICKET-041).

Kept in one place so the seeder (`seed_demo_data`), the login page's
"Demo logins" hint (served by the API) and the README can't drift apart.

Simple, easy-to-type values on purpose - for the meetup table, not for
real accounts. The seeder sets them with `set_password()`, which skips
Django's password validators; sign-up still enforces them for everyone
else.

Emails are not special-cased anywhere: a booking made as a demo guest is
emailed to that guest's address like any other account's (demo.com is a
real domain - change DEMO_EMAIL_DOMAIN here if that ever matters).
"""
import hashlib
import re

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db.models import Q

DEMO_EMAIL_DOMAIN = "demo.com"

# The admin logs in to the app/API by email; Django Admin (/admin/) asks
# for the username instead.
DEMO_ADMIN_USERNAME = "admin"
DEMO_ADMIN_EMAIL = f"admin@{DEMO_EMAIL_DOMAIN}"
DEMO_ADMIN_PASSWORD = "admin123"

# guest1@demo.com, guest2@demo.com, ... - all with the same password.
DEMO_GUEST_PASSWORD = "guest123"

_DEMO_GUEST_EMAIL_REGEX = rf"^guest[0-9]+@{re.escape(DEMO_EMAIL_DOMAIN)}$"

# The accounts older versions of the seeder created (before TICKET-041):
# guest_<n>_<faker name>@example.com and admin_demo.
LEGACY_ADMIN_USERNAME = "admin_demo"
LEGACY_GUEST_USERNAME_PREFIX = "guest_"
LEGACY_GUEST_EMAIL_SUFFIX = "@example.com"


def demo_guest_email(number):
    """The login email of demo guest `number` (1-based): guest1@demo.com."""
    return f"guest{number}@{DEMO_EMAIL_DOMAIN}"


def demo_guest_users():
    """The seeded demo guests. Their username is their email (the same rule
    sign-up uses), so both must match the guest<N>@demo.com pattern."""
    return User.objects.filter(
        username__iregex=_DEMO_GUEST_EMAIL_REGEX, email__iregex=_DEMO_GUEST_EMAIL_REGEX
    )


def demo_admin_users():
    """The seeded demo admin - matched on username AND email, so an owner's
    own superuser that happens to be called "admin" is never mistaken for
    it (and never deleted by --clear)."""
    return User.objects.filter(username=DEMO_ADMIN_USERNAME, email__iexact=DEMO_ADMIN_EMAIL)


def legacy_demo_users():
    """Demo accounts left by the old seeder (admin_demo, guest_*@example.com)."""
    return User.objects.filter(
        Q(username=LEGACY_ADMIN_USERNAME)
        | Q(
            username__startswith=LEGACY_GUEST_USERNAME_PREFIX,
            email__endswith=LEGACY_GUEST_EMAIL_SUFFIX,
        )
    )


def _number(user):
    """7 for guest7@demo.com."""
    return int(re.search(r"[0-9]+", user.username).group())


def _password_still_works(user, password):
    """user.check_password(password), cached. The check runs the password
    hasher (deliberately slow), and this backs a public endpoint, so the
    answer is remembered per account *and* per stored password hash: a
    password changed in Django Admin changes the hash, hence the key, and is
    picked up straight away."""
    digest = hashlib.sha256(f"{user.pk}:{user.password}:{password}".encode()).hexdigest()
    key = f"demo-login-ok:{digest}"
    ok = cache.get(key)
    if ok is None:
        ok = user.check_password(password)
        cache.set(key, ok, timeout=None)
    return ok


def demo_logins():
    """What the login page's "Demo logins" box shows (TICKET-041), served by
    GET /api/auth/demo-logins/.

    Only accounts that exist, are active and still have the seeded password
    are listed - so a database without demo data (a real deployment) or a
    demo admin whose password was changed to lock it down shows nothing
    for it. The guest entry is the lowest-numbered demo guest, plus how many
    there are and the last one's email (for "guest1 ... guest10")."""
    logins = []

    guests = sorted(
        (u for u in demo_guest_users().filter(is_active=True) if not u.is_staff),
        key=_number,
    )
    if guests and _password_still_works(guests[0], DEMO_GUEST_PASSWORD):
        logins.append({
            "role": "guest",
            "email": guests[0].email,
            "password": DEMO_GUEST_PASSWORD,
            "count": len(guests),
            "last_email": guests[-1].email,
        })

    admin = demo_admin_users().filter(is_active=True).first()
    if admin is not None:
        from accounts.permissions import is_app_admin  # avoids an import cycle at startup

        if is_app_admin(admin) and _password_still_works(admin, DEMO_ADMIN_PASSWORD):
            logins.append({
                "role": "admin",
                "email": admin.email,
                "password": DEMO_ADMIN_PASSWORD,
            })
    return logins
