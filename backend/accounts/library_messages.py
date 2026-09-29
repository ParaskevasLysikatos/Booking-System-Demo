"""Library messages that have no Greek of their own (TICKET-038).

Django and DRF ship Greek translations, and the API uses them as they are.
Two gaps are filled from our own catalog
(backend/locale/el/LC_MESSAGES/django.po, which Django reads first):

- djangorestframework-simplejwt ships no Greek at all - its login and
  token messages.
- Django 5.2 reworded the "password too short" rule (%(min_length)d -> %d)
  and its Greek catalog hasn't caught up yet.

Listing them here is only so that `makemessages` puts them into the catalog;
nothing in this module runs at request time. Keep the English exactly as
the library writes it - that's the key the translation is looked up by.
"""
from django.utils.translation import gettext_noop, ngettext_lazy

SIMPLEJWT_MESSAGES = [
    gettext_noop("No active account found with the given credentials"),
    gettext_noop("No active account found for the given token."),
    gettext_noop("Given token not valid for any token type"),
    gettext_noop("Token is invalid or expired"),
    gettext_noop("Token is invalid"),
    gettext_noop("Token is expired"),
    gettext_noop("Token is blacklisted"),
    gettext_noop("User not found"),
    gettext_noop("User is inactive"),
]

DJANGO_MESSAGES = [
    # django.contrib.auth.password_validation.MinimumLengthValidator
    ngettext_lazy(
        "This password is too short. It must contain at least %d character.",
        "This password is too short. It must contain at least %d characters.",
        "min_length",
    ),
]
