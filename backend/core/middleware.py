"""The API answers in the caller's language (TICKET-038 step 6).

The Angular app sends `Accept-Language: el` (or `en`) with every API call
(frontend/src/app/core/i18n/language.interceptor.ts). This middleware turns
that header into Django's active language for the request, so every message
wrapped in gettext() - ours, Django's (e.g. password rules) and DRF's
(e.g. "This field is required.") - comes back in that language.

Only for /api/: everything else (Django Admin at /admin/, the health check)
always runs in English - the Django Admin is a developer tool and out of
scope. Unlike Django's own LocaleMiddleware it never redirects, never
looks at URL prefixes and ignores the `django_language` cookie: the header
is the only input, so the answer depends on nothing but the request.

Anything that isn't one of settings.LANGUAGES (fr, a missing header)
falls back to settings.LANGUAGE_CODE (English).
"""
from django.conf import settings
from django.utils import translation
from django.utils.cache import patch_vary_headers

API_PREFIX = "/api/"


def language_from_header(request):
    header = request.META.get("HTTP_ACCEPT_LANGUAGE", "")
    for code, _quality in translation.trans_real.parse_accept_lang_header(header):
        if code == "*":
            break
        try:
            return translation.get_supported_language_variant(code)
        except LookupError:
            continue
    return settings.LANGUAGE_CODE


class ApiLanguageMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        is_api = request.path_info.startswith(API_PREFIX)
        language = language_from_header(request) if is_api else settings.LANGUAGE_CODE
        translation.activate(language)
        request.LANGUAGE_CODE = language
        try:
            response = self.get_response(request)
        finally:
            translation.deactivate()
        if is_api:
            response.headers.setdefault("Content-Language", language)
            patch_vary_headers(response, ("Accept-Language",))
        return response
