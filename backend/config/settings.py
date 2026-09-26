from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
env_file = BASE_DIR / '.env'
if env_file.exists():
    environ.Env.read_env(env_file)

DEV_SECRET_KEY = 'dev-only-insecure-secret-key-change-me'
SECRET_KEY = env('DJANGO_SECRET_KEY', default=DEV_SECRET_KEY)
DEBUG = env.bool('DJANGO_DEBUG', default=True)
if not DEBUG and SECRET_KEY == DEV_SECRET_KEY:
    # Tokens are signed with SECRET_KEY: never run in production with the
    # well-known dev key (render.yaml generates a random one).
    raise ImproperlyConfigured('Set DJANGO_SECRET_KEY when DJANGO_DEBUG is False.')

ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=['localhost', '127.0.0.1', 'backend'])
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])

# Render sets this to the service's public hostname
# (e.g. booking-demo-api.onrender.com), so it never has to be typed in.
RENDER_EXTERNAL_HOSTNAME = env('RENDER_EXTERNAL_HOSTNAME', default='')
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)
    # Django Admin's login form (a normal POST with a CSRF cookie) over HTTPS.
    CSRF_TRUSTED_ORIGINS.append(f'https://{RENDER_EXTERNAL_HOSTNAME}')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',

    'rest_framework',
    'corsheaders',

    'core',
    'listings',
    'accounts',
    'bookings',
    'reviews',
    'payments',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Serves collected static files (Django Admin / DRF CSS) under gunicorn,
    # where Django itself doesn't serve them (TICKET-026).
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

if env('DATABASE_URL', default=''):
    # Hosting (Render): one connection string, e.g.
    # postgresql://user:password@host/dbname
    DATABASES = {'default': env.db('DATABASE_URL')}
    DATABASES['default']['CONN_MAX_AGE'] = env.int('DB_CONN_MAX_AGE', default=60)
    DATABASES['default']['CONN_HEALTH_CHECKS'] = True
else:
    # Local Docker / tests: separate POSTGRES_* variables (see .env.example).
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': env('POSTGRES_DB', default='booking_demo'),
            'USER': env('POSTGRES_USER', default='booking_demo'),
            'PASSWORD': env('POSTGRES_PASSWORD', default=''),
            'HOST': env('POSTGRES_HOST', default='db'),
            'PORT': env('POSTGRES_PORT', default='5432'),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Europe/Athens'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
# `collectstatic` (build.sh) copies every app's static files here, and
# WhiteNoise serves them.
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {
        # Production: compressed files with content hashes in their names
        # (safe to cache forever). Dev/tests: the plain default, so nothing
        # needs collecting first.
        'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage' if DEBUG
        else 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Blank entries (e.g. a trailing comma) are dropped: corsheaders rejects them.
CORS_ALLOWED_ORIGINS = [o for o in env.list('CORS_ALLOWED_ORIGINS', default=['http://localhost:4200']) if o]

# Email login for the app (accounts.backends.EmailBackend), with Django's
# default username backend kept for createsuperuser accounts on /admin/.
AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'accounts.backends.EmailBackend',
]

REST_FRAMEWORK = {
    # The Angular app authenticates every API call with a JWT in the
    # `Authorization: Bearer <access>` header (TICKET-012). No session auth:
    # the API is token-only, which also means no CSRF handling for the SPA.
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    # Still open by default; individual views tighten this (IsAuthenticated
    # on /api/auth/me/ now, the admin permission class in TICKET-014).
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
}

# Booking rules (TICKET-015). Bookings store only a check-in *date*; the
# guest cancellation deadline is measured from this check-in time (local
# time, TIME_ZONE) - e.g. check-in Friday 15:00 -> guests can cancel until
# Wednesday 15:00. Admins can cancel at any time.
BOOKING_CHECK_IN_TIME = env('BOOKING_CHECK_IN_TIME', default='15:00')
BOOKING_GUEST_CANCELLATION_HOURS = env.int('BOOKING_GUEST_CANCELLATION_HOURS', default=48)

# Payments: Stripe test-mode Checkout (TICKET-029). With no secret key set,
# payments are simply switched off and booking works exactly as before
# (pending until an admin confirms) - that's also what the test suite and a
# fresh clone without Stripe keys get. The values are checked at startup by
# payments/checks.py (e.g. live keys are refused unless explicitly allowed).
# Prefer a restricted key (rk_test_...) with only "Checkout Sessions: Write".
STRIPE_SECRET_KEY = env('STRIPE_SECRET_KEY', default='')
STRIPE_ALLOW_LIVE_KEYS = env.bool('STRIPE_ALLOW_LIVE_KEYS', default=False)
PAYMENTS_ENABLED = bool(STRIPE_SECRET_KEY)
# Pinned so a Stripe account upgrade can't change response shapes under us.
STRIPE_API_VERSION = env('STRIPE_API_VERSION', default='2026-08-26.dahlia')
# Webhook signing secret (whsec_...). Locally it doesn't need setting: the
# stripe-cli Docker service writes it to STRIPE_WEBHOOK_SECRET_FILE on a
# shared volume, and the webhook reads it from there.
STRIPE_WEBHOOK_SECRET = env('STRIPE_WEBHOOK_SECRET', default='')
STRIPE_WEBHOOK_SECRET_FILE = env('STRIPE_WEBHOOK_SECRET_FILE', default='')
# How long an unpaid booking holds its dates = the Checkout Session's
# lifetime. Stripe allows 30 minutes .. 24 hours.
STRIPE_CHECKOUT_HOLD_MINUTES = env.int('STRIPE_CHECKOUT_HOLD_MINUTES', default=30)
PAYMENTS_CURRENCY = 'eur'
# Where Stripe sends the guest back after paying (or giving up).
FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:4200').rstrip('/')

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=env.int('JWT_ACCESS_MINUTES', default=30)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=env.int('JWT_REFRESH_DAYS', default=1)),
    # Kept simple for the demo: no rotation/blacklist, so /refresh/ returns a
    # new access token and the same refresh token stays valid until expiry.
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': False,
    'UPDATE_LAST_LOGIN': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    # Defaults to SECRET_KEY; spelled out so it's obvious what signs tokens.
    'SIGNING_KEY': SECRET_KEY,
}

# --- Production (DJANGO_DEBUG=False), TICKET-026 -------------------------------
if not DEBUG:
    # Render terminates HTTPS at its proxy (and redirects http -> https there)
    # and tells Django the original scheme in this header.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env.int('DJANGO_HSTS_SECONDS', default=3600)

# Server errors (500s, with tracebacks) go to stdout, so they show up in
# Render's Logs tab. Django's default only prints them while DEBUG is on.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'WARNING'},
    'loggers': {
        'django': {'handlers': ['console'], 'level': env('DJANGO_LOG_LEVEL', default='ERROR'), 'propagate': False},
    },
}
