# Booking System Demo

Django + Angular booking/property-management demo, running side by side in
Docker with a Postgres database. See `Booking System Demo - Build Plan.md`
for the full project plan (models, API design, day-by-day schedule).

**Status:** Epic 1 (the data layer) is complete - all five models
(`Property`, `PropertyImage`, `Profile`, `Booking`, `Review`), migrations,
Django Admin registration, and a Faker seed script for realistic demo data
are all in place and verified. On the frontend, users can register, log
in and out (TICKET-017), browse and search stays on the listings page
(TICKET-018), and open a stay's detail page with its photos, amenities
and an availability calendar (TICKET-019), and book it in two steps
(TICKET-020), then see and cancel their bookings under My bookings
(TICKET-021). Admins have their own area (TICKET-022 to 025): a
dashboard, the properties table and form, and every guest's bookings
with confirm/cancel, which completes Epic 4. The API is live on Render
at https://booking-demo-api.onrender.com (TICKET-026, see "Deploying to Render"), and
the Angular site at https://booking-demo-g4aw.onrender.com (TICKET-027). Epic 2 (the DRF API) is complete: JWT
authentication (register, login, refresh, "who am I"), the shared admin
permission classes, and the Properties API (filtered, paginated list,
detail with availability, admin-only create/edit/soft-delete) and the
Bookings API (race-proof booking creation, locked status changes) and
the admin stats endpoint are done, which completes Epic 2.
See "Authentication (JWT)", "Permissions", "Properties API", "Bookings
API", "Admin stats API" and "Admin bookings". See "Next
steps" at the bottom for what's next.

## Prerequisites

- Docker Desktop (with the WSL2 backend), running.

## Quick start

```bash
docker compose up --build
```

First run pulls base images and runs `npm install` / `pip install`, so it
takes a few minutes. After that, `docker compose up` is fast, and editing
files under `backend/` or `frontend/` hot-reloads inside the containers
(no rebuild needed for code changes - only for new dependencies).

Stop everything with `docker compose down` (add `-v` to also wipe the
Postgres data volume for a clean slate - you'll lose any data in the DB).

## How it fits together

Four containers, defined in `docker-compose.yml`:

| Service | Image / build | Port (host) | Role |
| --- | --- | --- | --- |
| `frontend` | built from `frontend/Dockerfile` (Node 22) | 4200 | Angular dev server (`ng serve`) |
| `backend` | built from `backend/Dockerfile` (Python 3.12) | 8000 | Django + DRF dev server |
| `db` | `postgres:16-alpine` | 5432 | The actual database |
| `pgadmin` | `dpage/pgadmin4` | 5050 | Web GUI for browsing `db` |

Request flow when you load `localhost:4200`:

1. Angular serves the page. Its root component (`app.ts`) renders the
   `ApiStatusComponent`, which immediately calls `ApiHealthService.check()`.
2. That service does `GET http://localhost:8000/api/health/` (the base
   URL comes from `frontend/src/environments/environment.ts`; production
   builds use `environment.production.ts`, i.e. the Render API).
3. Django's `core/views.py:health_check` runs `SELECT 1` against Postgres
   and returns `{"status": "ok", "database": "connected"}` (or an error
   string if the query fails).
4. The card on screen shows "Backend: connected" / "Database: connected" -
   that green result is proof all three pieces are wired together, not
   just that each container happens to be running.

Cross-origin requests from `localhost:4200` to `localhost:8000` are allowed
via `django-cors-headers`, configured in `backend/config/settings.py`
(`CORS_ALLOWED_ORIGINS`, read from `.env`).

Inside the Docker network, containers reach each other by **service name**,
not `localhost`: the backend's `DATABASES` setting points at host `db`
(the Postgres service), and pgAdmin also needs to be told to connect to
host `db` (see the pgAdmin section below). Only the browser, running on
your actual machine outside Docker, uses `localhost:<port>`.

## Project layout

```
backend/
  Dockerfile           Python 3.12 image; runs migrate then runserver on boot (local dev)
  requirements.txt     Django, DRF, simplejwt, django-cors-headers, django-environ, psycopg2, Faker,
                       gunicorn + whitenoise (production server and static files, TICKET-026)
  build.sh             Render build: pip install, collectstatic, migrate, first-deploy seed
  manage.py
  config/              Django project settings
    settings.py        Reads DB/secret/CORS/JWT config from env vars (DATABASE_URL on Render); JWT is the
                       API's default auth; production hardening when DJANGO_DEBUG=False
    urls.py            admin/ -> Django admin, api/ -> core.urls + listings.urls, api/auth/ -> accounts.urls
    wsgi.py / asgi.py
  core/                Small app - currently just the health-check endpoint
    views.py           GET /api/health/ - queries Postgres, returns status (error details only in DEBUG)
    tests.py           Health check + seed --if-empty tests
    urls.py
    pagination.py      StandardPagination - 12 per page, ?page_size= up to 50
    admin.py           No models of its own - just the admin site's global branding (dev-DB-inspection labeling)
    management/commands/seed_demo_data.py   Faker-based demo data generator (see "Seeding demo data" below)
  listings/            Data layer for bookable properties
    models.py          Property + PropertyImage models
    serializers.py     List (card) + detail (images, availability; also the admin write serializer, nested images)
    filters.py         Query-param validation + filtering (location, guests, price, dates, ordering)
    views.py           PropertyViewSet - /api/properties/ (public read, admin write, soft delete)
    urls.py            Router for /api/properties/
    tests.py           API tests for the Properties endpoints
    admin.py           Registers both in Django Admin, images inline on the Property page (dev-only DB inspection, see Epic 4 for the real admin UI)
    migrations/        0001_initial.py (Property), 0002_propertyimage.py (PropertyImage)
  accounts/            Adds a role/phone Profile on top of Django's built-in User
    models.py          Profile model (role: guest/admin, phone)
    signals.py         post_save on User auto-creates a Profile (any creation path)
    backends.py        EmailBackend - authenticate by email (case-insensitive) + password
    serializers.py     RegisterSerializer, UserSerializer, email-login token serializer (custom role claims)
    views.py           RegisterView, LoginView, MeView
    urls.py            /api/auth/ register/, login/, refresh/, me/
    permissions.py     IsAdminRole / IsAdminOrReadOnly - Profile.role checked from the DB
    tests.py           API tests for the auth endpoints
    admin.py           Profile inline on the User admin page, plus its own list
    migrations/        0001_initial.py creates the profiles table
  bookings/            A guest's reservation of a Property for a date range
    models.py          Booking model + the overlap-query manager (no separate Availability model)
    admin.py           Filterable/searchable Booking list (dev-only DB inspection)
    serializers.py     Read shape, create (server-side price/status), status-only PATCH
    views.py           BookingViewSet - /api/bookings/ (own vs all, 409 on overlap, locked status changes); AdminStatsView
    stats.py           compute_stats() - counts, occupancy, revenue, per-property breakdown for a period
    urls.py            Router for /api/bookings/ + /api/admin/stats/
    tests.py           API + DB-constraint + real concurrency tests (Postgres)
    migrations/        0001_initial.py creates the bookings table; 0002 adds guests + btree_gist + no-overlap constraint
  reviews/             A guest's rating/comment on a Property (nice-to-have)
    models.py          Review model (rating 1-5, one review per guest per property)
    admin.py           Filterable/searchable Review list (dev-only DB inspection)
    migrations/        0001_initial.py creates the reviews table

frontend/
  Dockerfile           Node 22 image; runs `ng serve --host 0.0.0.0 --poll 1000`
  src/environments/environment.ts   apiUrl the frontend calls the backend at (dev: localhost:8000)
  src/environments/environment.production.ts   Same for `ng build` (Render API URL, waking-up notice on)
  package-lock.json                 Exact package versions; Render builds with `npm ci`
  src/app/
    app.ts / app.html / app.config.ts   Root shell (toolbar + router outlet) + providers (HttpClient + auth interceptor, router, session restore)
    app.routes.ts                       / -> /listings, /listings, /listings/:id, /booking/:propertyId + /my-bookings (authGuard),
                                        /admin/** (adminGuard), /forbidden, /login, /register (all lazy)
    core/api-health.service.ts          Wraps the /api/health/ call (used by the footer status dot)
    core/server-wake.ts                 ServerWakeService + interceptor: notices when the sleeping API is slow to answer
    core/api-errors.ts                  DRF error response -> per-field + general messages for forms
    core/dates.ts / core/money.ts       Local YYYY-MM-DD helpers (no UTC shift); euro price formatting
    core/properties/                    PropertyService (active-only list + get(id, dates)), params builder, models,
                                        availability.ts (BookedNights: [check_in, check_out) rules),
                                        stay-rules.ts (shared stay validation messages + picker date filter)
    core/amenities.ts                   Amenity labels + Material icons (cards and detail page)
    core/auth/                          AuthService (session signals), authInterceptor (Bearer + refresh-on-401),
                                        authGuard + adminGuard + guestOnlyGuard, TokenStorage (localStorage), jwt.ts, models
    core/bookings/                      BookingService (create/get/list/cancel), models, booking-policy.ts (15:00 check-in, 48h cancel preview)
    core/admin/                         AdminStatsService (/api/admin/stats/), periods.ts (presets, comparison period, deltas),
                                        AdminPropertiesService (list all / create / update / retire / reactivate),
                                        AdminBadgesService (pending-bookings count for the side nav)
    core/unsaved-changes.guard.ts       canDeactivate "Discard unsaved changes?" for forms
    shared/confirm-dialog.ts            Generic confirm dialog (danger variant)
    layout/toolbar/                     Role-aware top bar: Log in / Sign up, or My bookings (+ Admin) and an account menu
    layout/footer/                      Footer with the API/database connectivity dot
    layout/wake-notice/                 "Waking up the demo server" banner under the toolbar (production only)
    pages/listings/                     Listings page: URL-driven search, filters, grid, paginator (+ property-card/)
    pages/property-detail/              Detail page: gallery (+ full-screen lightbox), amenities, availability
                                        calendar, sticky booking panel with live availability + Book now
    pages/booking/                      Booking form: 2-step stepper (trip -> review & confirm), live price,
                                        409/400 handling, confirmation screen
    pages/my-bookings/                  My Bookings: Upcoming/Past/Cancelled tabs (URL), booking cards, cancel dialog
    pages/admin/                        Admin shell (side nav), dashboard/ (stat cards + breakdown table),
                                        properties/ (table + form with amenities picker and drag-drop photos),
                                        bookings/ (every guest's bookings: tabs, filters, confirm/cancel)
    pages/forbidden/                    403 "Admins only" page
    pages/login/, pages/register/       Auth forms (Angular Material)
    testing/fake-jwt.ts                 Test helper that builds JWT-shaped tokens

docker-compose.yml   Wires the four services together
render.yaml          Render Blueprint: free Postgres + the API web service (TICKET-026) + the Angular static site (TICKET-027)
.python-version      Python version Render uses (3.12, same as the Docker image)
.env                 Local dev secrets (gitignored) - real values, ready to use
.env.example         Committed template for .env
```

## Data model

**`Property`** (`listings` app, `listings/models.py`) - a single bookable
listing (apartment or room):

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `CharField` | Guest-facing name |
| `description` | `TextField` | Optional, longer free text |
| `location` | `CharField` | Free-text location (e.g. "Thessaloniki, Greece"), used for search/filtering later |
| `price_per_night` | `DecimalField` | Decimal, not float - money should never lose precision |
| `capacity` | `PositiveIntegerField` | Max guests |
| `amenities` | `JSONField` | List of amenity strings, e.g. `["wifi", "parking"]` - stored as native Postgres `jsonb`, no extra package needed |
| `is_active` | `BooleanField` | Inactive properties are hidden from customer listings but kept for history |
| `created_at` / `updated_at` | `DateTimeField` | Auto-managed timestamps |

**`PropertyImage`** (`listings` app, `listings/models.py`) - a photo
belonging to a `Property`. A property can have many; at most one may be
flagged `is_cover` (used as the listing's thumbnail):

| Field | Type | Notes |
| --- | --- | --- |
| `property` | `ForeignKey -> Property` | `related_name="images"`, `on_delete=CASCADE` |
| `image` | `URLField` | Photo URL. Demo data uses stock photo URLs (Faker seed script); real uploads are TICKET-036, a later nice-to-have |
| `is_cover` | `BooleanField` | Marks the thumbnail photo. At most one `True` per property |
| `created_at` | `DateTimeField` | Auto-managed |

The "exactly one cover image" rule from the ticket is enforced two ways:

- **Application level** - `PropertyImage.save()` un-covers any sibling image
  when one is saved with `is_cover=True`, so callers never have to remember
  to flip the old cover off themselves.
- **Database level** - a partial unique constraint
  (`unique_cover_image_per_property`) on `(property)` where `is_cover=True`
  is the hard backstop, e.g. against a bulk `.update()` that bypasses
  `save()`.

If no image is flagged yet, `Property.cover_image` (a convenience property)
falls back to the earliest-added image - `PropertyImage`'s default
ordering (`-is_cover`, `created_at`) already puts the real cover first when
one exists, so `.images.first()` does the right thing either way. It
returns `None` for a property with no images at all.

Registered in Django Admin (`listings/admin.py`) for quick inspection during
development - `PropertyAdmin` shows title/location/price/capacity/is_active
in the list view and lets you search and filter, and edits its images
inline (add/reorder/flag-as-cover without leaving the property page).
`PropertyImage` also has its own admin list for browsing images across all
properties. This is **not** the demo-facing admin UI (that's the custom
Angular admin dashboard planned for Epic 4) - just a fast way to eyeball
the tables while building.

**`Profile`** (new `accounts` app, `accounts/models.py`) - the
app-specific bits Django's built-in `User` doesn't have:

| Field | Type | Notes |
| --- | --- | --- |
| `user` | `OneToOneField -> User` | `related_name="profile"`, `on_delete=CASCADE` |
| `role` | `CharField` (choices) | `"guest"` or `"admin"` (`Profile.Role` TextChoices), default `"guest"` |
| `phone` | `CharField` | Optional |

`role` is deliberately **separate** from Django's own `is_staff` /
`is_superuser`: those gate the built-in `/admin/` site (dev-only DB
inspection), while `Profile.role` gates the app's own admin dashboard/API
(TICKET-013/014 onward will check `Profile.role == "admin"`, not
`is_staff`). A `Profile.is_admin` convenience property wraps that check.

Every `User` gets a `Profile` automatically via a `post_save` signal
(`accounts/signals.py`, wired up in `AccountsConfig.ready()`) - this covers
every way a user can come into existence (`createsuperuser`, the Django
Admin "Add user" form, and the future `/api/auth/register/` endpoint from
TICKET-012), not just one code path. Staff/superuser accounts are seeded
with role `"admin"` since they're administrative by definition; that's
just the initial value; `role` can be changed independently afterwards
without touching `is_staff`. Verified against a throwaway SQLite DB:
regular user -> guest, superuser -> admin, no duplicate Profile on a
plain re-save, and editing `role` doesn't touch `is_staff`.

Registered in Django Admin as an inline on the built-in User page (role and
phone show up right where you'd edit any other user) plus its own
standalone list for browsing/filtering by role.

**`Booking`** (new `bookings` app, `bookings/models.py`) - one guest's
reservation of a `Property` for a date range:

| Field | Type | Notes |
| --- | --- | --- |
| `property` | `ForeignKey -> Property` | `related_name="bookings"`, `on_delete=PROTECT` - a property with booking history can't be hard-deleted; use `Property.is_active` to retire it instead |
| `guest` | `ForeignKey -> User` | `related_name="bookings"`, `on_delete=CASCADE` |
| `check_in` / `check_out` | `DateField` | Whole-day stays, no time-of-day |
| `guests` | `PositiveSmallIntegerField` | Number of people staying (default 1, at least 1 via a DB `CheckConstraint`; no more than the property's `capacity`, checked in `clean()` and the booking API). Added in TICKET-015 |
| `total_price` | `DecimalField` | Decimal, like `Property.price_per_night` |
| `status` | `CharField` (choices) | `Booking.Status`: `pending` (default) / `confirmed` / `cancelled` |
| `created_at` | `DateTimeField` | Auto-managed |

There's deliberately **no separate `Availability` model** (per the build
plan) - a date range is free exactly when no non-cancelled `Booking`
overlaps it. That query is the model's own manager method,
`Booking.objects.overlapping(property, check_in, check_out)`: two ranges
overlap when each starts before the other ends (the standard interval-
overlap test), a touching-but-not-overlapping range (checkout day == next
check-in day) doesn't count as a conflict, and cancelled bookings are
excluded by default since cancelling frees the dates back up (pass
`exclude_cancelled=False` for a full history view instead).
`POST /api/bookings/` calls it as a friendly pre-check. The actual
guarantee against double bookings is a Postgres **exclusion constraint**
(`booking_no_overlap_per_property`, TICKET-015); see "Bookings API"
below.

`check_out` must be after `check_in`, enforced twice: `Booking.clean()`
raises a friendly `ValidationError` (what forms/admin/serializers will
surface), backstopped by a DB `CheckConstraint`
(`booking_check_out_after_check_in`) for anything that bypasses `clean()`
(e.g. a bulk operation). Verified against a throwaway SQLite DB: overlap
detection, adjacent-range non-overlap, per-property isolation, cancelled-
booking exclusion (and opt-in inclusion), `clean()`'s `ValidationError`,
and the DB constraint all behave as intended.

Registered in Django Admin with a filterable/searchable list
(status, date-hierarchy on `check_in`).

**`Review`** (new `reviews` app, `reviews/models.py`, nice-to-have) - a
guest's rating/comment on a `Property`:

| Field | Type | Notes |
| --- | --- | --- |
| `property` | `ForeignKey -> Property` | `related_name="reviews"`, `on_delete=PROTECT` (same reasoning as `Booking`) |
| `guest` | `ForeignKey -> User` | `related_name="reviews"`, `on_delete=CASCADE` |
| `rating` | `PositiveSmallIntegerField` | 1-5, validated by `MinValueValidator`/`MaxValueValidator` |
| `comment` | `TextField` | Optional |
| `created_at` | `DateTimeField` | Auto-managed |

Two invariants, each enforced at both the application and DB layer (the
established pattern from `PropertyImage`/`Booking`): rating must be 1-5
(field validators for a friendly `ValidationError`, backstopped by a DB
`CheckConstraint`), and one review per guest per property (`full_clean()`'s
built-in uniqueness check, backstopped by a DB `UniqueConstraint`
`unique_review_per_guest_per_property`) - a guest updates their existing
review rather than posting duplicates. Verified against a throwaway SQLite
DB: valid reviews from different guests, both out-of-range ratings and
duplicate (property, guest) pairs rejected at the application level, and
both DB constraints rejecting the same bypassing a bulk `.create()`.

Registered in Django Admin with a filterable/searchable list (by rating).

Domain models live in their own apps rather than in `core` (which stays
infrastructure-only): `listings` holds `Property`/`PropertyImage`,
`accounts` holds `Profile`, `bookings` holds `Booking`, `reviews` holds
`Review`. That's the complete Data Models table from the build plan.

Migrations: `listings/migrations/0001_initial.py` creates `Property`,
`0002_propertyimage.py` creates `PropertyImage`,
`accounts/migrations/0001_initial.py` creates `Profile`,
`bookings/migrations/0001_initial.py` creates `Booking`,
`bookings/migrations/0002_booking_guests_no_overlap.py` adds `guests`, the
`btree_gist` extension and the no-overlap exclusion constraint, and
`reviews/migrations/0001_initial.py` creates `Review`. All apply
automatically the next time the `backend` container starts (the Dockerfile
runs `migrate` on boot - see "Quick start" above); outside Docker, run
`python manage.py migrate` from `backend/` with a reachable Postgres
connection.

## Authentication (JWT)

The API is token-based (TICKET-012), using
[`djangorestframework-simplejwt`](https://django-rest-framework-simplejwt.readthedocs.io/).
There are no sessions or cookies for the Angular app: every authenticated
request carries `Authorization: Bearer <access token>`.

### Endpoints

All under `/api/auth/` (`backend/accounts/urls.py`):

| Method + path | Auth | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/auth/register/` | none | `email`, `password`, optional `first_name`, `last_name`, `phone` | `201` - `{user, access, refresh}` (new user is logged in straight away) |
| `POST /api/auth/login/` | none | `email`, `password` | `200` - `{access, refresh, user}`; `401` on bad credentials |
| `POST /api/auth/refresh/` | none | `refresh` | `200` - `{access}` (a fresh access token); `401` if the refresh token is invalid/expired |
| `GET /api/auth/me/` | Bearer | - | `200` - the current user with their **current** role; `401` without a valid token |

The `user` object (same shape everywhere, `accounts/serializers.py:UserSerializer`):

```json
{"id": 12, "username": "maria@example.com", "email": "maria@example.com",
 "first_name": "Maria", "last_name": "", "role": "guest", "phone": "", "is_admin": false}
```

### How it works

- **Email login.** Users sign up and log in with email + password. Django's
  built-in `User` still needs a `username`, so register derives it from
  the email automatically (users never see it). Login is routed through a
  small custom backend, `accounts/backends.py:EmailBackend`, which looks the
  user up by email (case-insensitive) and checks the password. Django's
  default `ModelBackend` is kept alongside it (`AUTHENTICATION_BACKENDS` in
  `settings.py`) so username login still works where it's still used:
  `createsuperuser` accounts signing in to the dev-only `/admin/` site.
- **Register = guest, always.** `RegisterSerializer` doesn't accept a
  `role` field at all, so nobody can sign themselves up as an admin
  (sending `"role": "admin"` is silently ignored). The `Profile` itself is
  created by the existing `post_save` signal (`accounts/signals.py`) with
  role `guest` - register just fills in the optional `phone` on it. The
  whole create runs in `transaction.atomic()`, so a failure never leaves a
  User without its Profile.
- **Validation.** Emails are normalised to lowercase and must be unique
  (case-insensitively - `Maria@x.com` and `maria@x.com` are the same
  account). Passwords go through Django's existing
  `AUTH_PASSWORD_VALIDATORS` (min length 8, not too common, not
  all-numeric, not too similar to the email/name); errors come back as a
  `400` with per-field messages, e.g. `{"password": ["This password is too common."]}`.
- **Custom token claims.** Besides simplejwt's standard `user_id`/`exp`,
  every token carries `email`, `username`, and `role`, so the frontend can
  decide what to show (Admin link, route guards) by decoding the token,
  without an extra request. These claims are a **UI convenience only**:
  they're as old as the token, so if a user's role changes the claim lags
  until the token expires. The server never trusts the claim for
  authorisation - admin-only endpoints re-check `Profile.role` from the DB
  (TICKET-014) - and `GET /api/auth/me/` is the always-current source of
  truth.
- **Lifetimes.** Access token 30 minutes, refresh token 1 day (override
  with `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` in `.env`). No refresh
  rotation/blacklisting - kept simple for the demo, so there's no
  server-side logout; the frontend "logs out" by discarding its tokens.
  Tokens are signed with `DJANGO_SECRET_KEY`.
- **Stale tokens don't block login.** `register/`, `login/` and `refresh/`
  have authentication turned off (`authentication_classes = []`). Otherwise
  an expired token still attached by the frontend's HTTP interceptor would
  make DRF reject the request with `401` before the login even ran.
- **Default auth for the whole API** is `JWTAuthentication`
  (`REST_FRAMEWORK` in `settings.py`). The default *permission* is still
  `AllowAny` - individual views tighten it (`/me/` uses `IsAuthenticated`;
  admin-only writes use the permission classes described under "Permissions").

Demo accounts from `seed_demo_data` can log in straight away: the demo
admin as `admin_demo@example.com` / `AdminPass123!`, and any seeded guest by
their `...@example.com` email with `DemoPass123!`. Note: a superuser
created with `createsuperuser` and no email can still use `/admin/`, but
can't log in to the API until you give it an email.

### Trying it with curl

```bash
# Register (returns the user + tokens)
curl -X POST http://localhost:8000/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"email": "maria@example.com", "password": "S3cure-Booking-Pass!", "first_name": "Maria"}'

# Log in
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email": "admin_demo@example.com", "password": "AdminPass123!"}'

# Who am I? (paste the "access" value from the login response)
curl http://localhost:8000/api/auth/me/ -H "Authorization: Bearer <access>"

# Get a new access token once it expires
curl -X POST http://localhost:8000/api/auth/refresh/ \
  -H "Content-Type: application/json" -d '{"refresh": "<refresh>"}'
```

### Tests

`backend/accounts/tests.py` (19 API tests) covers: register creates a User
+ exactly one guest Profile and returns tokens; `role` can't be
self-assigned; duplicate emails (any case), weak passwords and invalid
emails are rejected; login returns access + refresh with the right role
claim (guest and admin); case-insensitive email; wrong password / unknown
email / inactive user -> `401`; login by username is rejected; an
ambiguous duplicate email refuses login instead of guessing; refresh
issues a new access token (and rejects garbage or an access token passed
as a refresh token); `/me/` requires a token and reflects a role change
immediately; and username login to `/admin/` still works. Run them with:

```bash
docker compose exec backend python manage.py test accounts
```

## Permissions (admin vs guest)

`backend/accounts/permissions.py` (TICKET-014) holds the shared DRF
permission classes every admin-only endpoint uses:

| Class | Allows |
| --- | --- |
| `IsAdminRole` | Only app admins, for every method |
| `IsAdminOrReadOnly` | Anyone can read (`GET`/`HEAD`/`OPTIONS`); only app admins can write (`POST`/`PUT`/`PATCH`/`DELETE`) |

"App admin" means `Profile.role == "admin"` on an active account (the
TICKET-007 decision). It is **not** `is_staff`/`is_superuser`: a staff user
with the guest role is refused, and an admin-role user without staff is
allowed. The role is always read from the database (`request.user.profile`)
on each request, **never** from the `role` claim inside the JWT. So
promoting or demoting someone takes effect on their very next request,
not when their token expires. There's a test that proves this with a real
token.

Status codes: no or invalid token -> **401**; logged in but not an admin ->
**403**.

## Properties API

`/api/properties/` (TICKET-013): `listings/views.py:PropertyViewSet`,
routed in `listings/urls.py`.

| Method + path | Who | What |
| --- | --- | --- |
| `GET /api/properties/` | anyone | Paginated, filterable list (card shape) |
| `GET /api/properties/{id}/` | anyone | Full detail + images + availability |
| `POST /api/properties/` | admin | Create (optionally with images) |
| `PUT` / `PATCH /api/properties/{id}/` | admin | Full / partial update |
| `DELETE /api/properties/{id}/` | admin | **Soft** delete: sets `is_active=false`, returns 204 |

### Filtering the list

All filters are optional query params and can be combined. They're
validated in `listings/filters.py` (a small DRF serializer, so no
`django-filter` dependency), and bad values get a `400` with a per-field
message (e.g. `{"check_out": ["check_out must be after check_in."]}`).

| Param | Example | Meaning |
| --- | --- | --- |
| `location` | `thessaloniki` | Case-insensitive "contains" match on `location` |
| `search` | `loft` | Case-insensitive match on **title or location** (TICKET-024, used by the admin table) |
| `guests` | `3` | `capacity >= guests` (must be at least 1) |
| `min_price` / `max_price` | `50` / `150` | Price per night range, inclusive (`min_price <= max_price`) |
| `check_in` + `check_out` | `2026-10-10` + `2026-10-14` | Only properties **free** for that stay. Both are required together; `check_out` must be after `check_in`; `check_in` can't be in the past |
| `ordering` | `price`, `-price`, `capacity`, `-capacity`, `newest` | Sort order (default: newest first) |
| `is_active` | `true` / `false` | **Admins only** (ignored for everyone else) |
| `page` / `page_size` | `2` / `24` | Pagination: 12 per page by default, max 50 |

How the date filter works: a property is excluded if it has any
**non-cancelled** booking (pending or confirmed) whose stay overlaps the
requested one. Check-out day is exclusive, so arriving on the day someone
else leaves is allowed. It reuses `Booking.objects.overlapping()` (the same
overlap rule booking creation will use in TICKET-015) as a correlated
`NOT EXISTS` subquery, so it's still one SQL query however many properties
there are.

Response (paginated, via `core/pagination.py:StandardPagination`):

```json
{"count": 13, "next": "http://localhost:8000/api/properties/?page=2", "previous": null,
 "results": [{"id": 13, "title": "Modern Cottage in Ioannina", "location": "Ioannina, Greece",
   "price_per_night": "91.00", "capacity": 2, "amenities": ["wifi", "kitchen"],
   "is_active": true, "cover_image": "https://picsum.photos/seed/13-0/800/600",
   "rating_avg": 3.0, "review_count": 1}]}
```

`rating_avg` (1 decimal, `null` with no reviews) and `review_count` are SQL
annotations, and images are prefetched. The whole list page costs a fixed
3 queries (count, page, images) whatever the page size, and a test checks
this.

**Visibility:** guests and anonymous visitors only ever see active
properties, so an inactive one is a `404` on the detail endpoint too.
Admins see everything and can filter with `?is_active=`.

### Detail + availability

`GET /api/properties/{id}/` adds `description`, all `images` (cover first),
timestamps, and an `availability` block for the TICKET-019 calendar:

```json
"availability": {
  "booked_ranges": [{"check_in": "2026-12-24", "check_out": "2027-01-02"}],
  "check_in": "2026-10-25", "check_out": "2026-11-01", "is_available": true
}
```

`booked_ranges` lists upcoming, non-cancelled stays with **dates only**
(no guest, price or status). The same `check_out`-exclusive rule applies,
so a calendar should treat each range as `[check_in, check_out)`. Add
`?check_in=&check_out=` (same validation as the list filter) and the block
also answers `is_available` for that exact stay.

### Writing (admin)

```json
POST /api/properties/
{"title": "Harbour Loft", "description": "...", "location": "Kavala, Greece",
 "price_per_night": "95.50", "capacity": 3, "amenities": ["wifi", "parking"],
 "images": [{"image": "https://.../1.jpg"}, {"image": "https://.../2.jpg", "is_cover": true}]}
```

- Validation: `price_per_night` > 0, `capacity` >= 1, image URLs must be
  valid URLs, and at most one image can have `is_cover: true`. With none
  flagged, the first image is used as the cover (the model's existing
  fallback). `amenities` are trimmed, and blank or duplicate entries
  (ignoring case) are dropped.
- **Images are nested and writable.** On `POST` they're created with the
  property. On `PATCH`/`PUT`, *sending* `images` **replaces** the whole
  image set (image ids change), and leaving it out leaves the images
  untouched. This lets the TICKET-024 admin form save in one call. It all
  runs in one `transaction.atomic()`, so a failure never leaves a
  half-updated property.
- Create/update responses come back in the full detail shape (re-read with
  the same annotations as a `GET`).
- **DELETE is a soft delete.** Bookings reference properties with
  `on_delete=PROTECT`, and booking/review history should survive anyway,
  so `DELETE` sets `is_active=false` (204). To bring a property back, send
  `PATCH {"is_active": true}`.

### Trying it with curl

```bash
# Free 2+ guest places in Thessaloniki for a week, cheapest first
curl "http://localhost:8000/api/properties/?location=thessaloniki&guests=2&check_in=2026-11-02&check_out=2026-11-09&ordering=price"

# Detail + "is it free for these dates?"
curl "http://localhost:8000/api/properties/3/?check_in=2026-11-02&check_out=2026-11-09"

# Admin: log in, then create / edit / retire
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login/ -H "Content-Type: application/json" \
  -d '{"email":"admin_demo@example.com","password":"AdminPass123!"}' | python -c "import sys,json;print(json.load(sys.stdin)['access'])")
curl -X PATCH http://localhost:8000/api/properties/3/ -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"price_per_night": "79.00"}'
curl -X DELETE http://localhost:8000/api/properties/3/ -H "Authorization: Bearer $TOKEN"
```

### Tests

`backend/listings/tests.py` has 27 API tests covering:

- pagination and page sizes
- each filter alone and combined
- date edge cases: overlapping, contained, back-to-back on either side, cancelled bookings don't block, pending bookings do
- all the bad-parameter `400`s
- rating annotations and the fixed query count
- visibility of inactive properties for guests vs admins
- detail images and cover, `booked_ranges` excluding past and cancelled stays, `is_available`
- `401` for anonymous and `403` for guest writes (including staff-without-admin-role)
- admin create with nested images and validation
- `PATCH` keeping or replacing images
- soft delete plus reactivation
- a role change taking effect on the next request, with a real JWT

`backend/accounts/tests.py` adds 5 permission-class tests (TICKET-014). Run
everything with:

```bash
docker compose exec backend python manage.py test
```

## Bookings API

`/api/bookings/` (TICKET-015): `bookings/views.py:BookingViewSet`,
routed in `bookings/urls.py`. Every endpoint needs a logged-in user
(`Authorization: Bearer <access>`); anonymous callers get `401`.

| Method + path | Guest | Admin |
| --- | --- | --- |
| `GET /api/bookings/` | Own bookings only | All bookings |
| `GET /api/bookings/{id}/` | Own only (someone else's is `404`) | Any |
| `POST /api/bookings/` | Book for themselves | Same |
| `PATCH /api/bookings/{id}/` | Cancel own booking, until 48h before check-in | Change status (see transitions) |
| `PUT` / `DELETE` | `405`: bookings are cancelled, never deleted or rewritten | same |

### Creating a booking

```json
POST /api/bookings/
{"property": 3, "check_in": "2026-11-02", "check_out": "2026-11-06", "guests": 2}
```

The server decides everything else. Any of these fields sent by the client
is ignored:

- `total_price` = nights × the property's current `price_per_night`.
- `status` always starts as **`pending`**. For now an admin confirms it;
  TICKET-029's Stripe webhook will confirm it once payment succeeds.
- `guest` is the logged-in user.

Validation (`bookings/serializers.py:BookingCreateSerializer`) gives a `400`
with a per-field message:

- the property exists and is active
- `check_in` is today or later, and at most 365 days ahead
- `check_out` is after `check_in`, and the stay is at most 30 nights
- `guests` is at least 1 and no more than the property's `capacity`

Response (`201`, the same shape every endpoint returns):

```json
{"id": 41, "property": {"id": 3, "title": "Loft", "location": "Thessaloniki",
   "price_per_night": "80.00", "cover_image": "https://..."},
 "check_in": "2026-11-02", "check_out": "2026-11-06", "nights": 4, "guests": 2,
 "total_price": "320.00", "status": "pending", "can_cancel": true,
 "cancel_deadline": "2026-10-31T15:00:00+02:00", "guest_email": null, "created_at": "..."}
```

`guest_email` is only filled in for admins. `can_cancel` tells the
frontend whether the *current caller* may cancel right now, so it can
show or hide a Cancel button without repeating the rules.
`cancel_deadline` is when free guest cancellation ends, for text like
"Free cancellation until Sat 31 Oct, 15:00".

### No double bookings, even under a race

Two layers:

1. **Friendly pre-check.** `Booking.objects.overlapping()` runs first. If
   the dates clash with a pending or confirmed booking, the API returns
   **`409`** `{"detail": "These dates are no longer available...", "code": "dates_unavailable"}`.
   On its own this is *not* race-proof. Two requests arriving together
   can both pass the check before either one saves (check-then-act).
2. **The real guarantee: a Postgres exclusion constraint.** This is
   `booking_no_overlap_per_property`, added in
   `bookings/migrations/0002_booking_guests_no_overlap.py`:

   ```sql
   EXCLUDE USING gist (property_id WITH =, daterange(check_in, check_out) WITH &&)
   WHERE (status <> 'cancelled')
   ```

   The database itself refuses a second overlapping non-cancelled booking
   for the same property, however the timing works out. `daterange(...)`
   uses `[check_in, check_out)` bounds, so check-out day is exclusive,
   the same rule as `overlapping()`. Combining a plain `=` on
   `property_id` with a range overlap in one GiST index needs the
   `btree_gist` extension. The same migration enables it
   (`BtreeGistExtension()`, a trusted extension, so no superuser is
   needed). The insert runs inside `transaction.atomic()`. When
   Postgres raises the exclusion violation (SQLSTATE `23P01`, checked by
   constraint name), the view turns it into a clean **`409`** "These
   dates were just booked by someone else" instead of a 500. Any other
   database error still surfaces as a real error.

   **Deadlocks, found while testing TICKET-021 and fixed.** When two
   overlapping inserts hit Postgres at *exactly* the same moment, each
   can end up waiting inside the exclusion check for the other's
   uncommitted row. Postgres then aborts one of them with a **deadlock**
   error (SQLSTATE `40P01`) rather than the exclusion violation. The
   real-concurrency test hit this intermittently (about 1 run in 3), and
   it would have been a 500 in production. The view now retries that
   insert **once**. By then the winner has committed, so the retry gets
   the normal exclusion violation (→ `409`). If the winner rolled back
   instead, the retry simply succeeds. A second deadlock is also
   answered with `409`. Two new tests cover this: a deadlock followed by
   a successful retry → `201`, and repeated deadlocks → `409`, not
   `500`. The concurrency test was then run 12 times in a row, all
   green.

Before adding the constraint, the migration checks your existing data. If
you already have overlapping non-cancelled bookings, it stops with a list
of the clashing pairs (instead of a cryptic Postgres error). Cancel one
from each pair and migrate again. Data from `seed_demo_data` never
overlaps.

### Status changes (`PATCH`)

The body is `{"status": "..."}` and nothing else. Sending any other field
(dates, price) is a `400`.

| From → To | Guest (own booking) | Admin |
| --- | --- | --- |
| `pending` → `confirmed` | ✗ | ✓ |
| `pending` → `cancelled` | ✓ until the cancellation deadline | ✓ |
| `confirmed` → `cancelled` | ✓ until the cancellation deadline | ✓ (any time, even after check-in) |
| anything → `pending` | ✗ | ✗ |
| `cancelled` → anything | ✗ | ✗ (**cancelled is final**: the guest books again) |

**Guest cancellation deadline: 48 hours before check-in.** Bookings store
only a check-in *date*, so check-in is taken to be **15:00 local time
(Europe/Athens)** on that date. A guest can cancel online until exactly
48 hours before that moment, e.g. check-in Friday → last cancel Wednesday
15:00. After that the API returns `400` "Online cancellation closed on
2026-10-28 15:00 (48 hours before check-in). Please contact us.", and only
an admin can cancel. The 48 hours are real hours: they're subtracted in
UTC, so across a daylight-saving change the deadline shifts by an hour on
the clock (e.g. 14:00 instead of 15:00) but is still exactly 48h. Both
values are settings, overridable in `.env`: `BOOKING_CHECK_IN_TIME`
(default `15:00`) and `BOOKING_GUEST_CANCELLATION_HOURS` (default `48`).
The logic lives on the model (`Booking.check_in_datetime()`,
`cancel_deadline()`, `guest_can_cancel()`), so the API check, the
`can_cancel` flag and future refund rules all share one definition.

**Refunds are not handled yet.** There are no payments until TICKET-029
(Stripe). Refunding a cancelled booking is its own ticket, TICKET-040, and
will build on this deadline.

Anything not allowed gets a `400` with the reason, e.g. "Booking is
already cancelled.". Because cancelled is final, a status change never
needs an overlap re-check. The exclusion constraint would block
reviving a cancelled booking into taken dates anyway.

**No lost updates.** The change is one atomic read-modify-write. Inside
`transaction.atomic()`, the booking row is loaded with
`select_for_update()` (locking only the booking row, not the joined
property or user). The transition is validated against that locked,
current state before saving. So if a guest cancels just as an admin
confirms or cancels, the second request waits for the first. It is then
judged against the first one's result instead of silently overwriting
it.

### Listing and filters

Paginated like properties (12 per page, `?page=`, `?page_size=` up to 50).
Query params, with bad values giving a `400`:

| Param | Values | Meaning |
| --- | --- | --- |
| `when` | `upcoming` | Not checked out yet (stays in progress count), soonest first. Used by My Bookings (TICKET-021) |
| `when` | `past` | Already checked out, most recent first |
| `status` | `pending` / `confirmed` / `cancelled`, or a comma list like `pending,confirmed` | Filter by status (unknown values → `400`) |
| `mine` | `true` | Only the caller's **own** bookings, even for an admin (whose default list is everyone's). Used by My Bookings |
| `property` | property id | **Admin only**, ignored for guests |
| `search` | `sara` | **Admin only**, ignored for guests: case-insensitive match on the **guest's email or the property title** (TICKET-025) |

Default order is most recent check-in first. The property summary and
cover image are fetched with `select_related`/`prefetch_related`, so a
page doesn't cost one query per booking.

### Trying it with curl

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login/ -H "Content-Type: application/json" \
  -d '{"email":"admin_demo@example.com","password":"AdminPass123!"}' | python -c "import sys,json;print(json.load(sys.stdin)['access'])")

# Book 4 nights for 2 guests
curl -X POST http://localhost:8000/api/bookings/ -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"property": 3, "check_in": "2026-11-02", "check_out": "2026-11-06", "guests": 2}'

# My upcoming bookings
curl "http://localhost:8000/api/bookings/?when=upcoming" -H "Authorization: Bearer $TOKEN"

# Confirm (admin) / cancel
curl -X PATCH http://localhost:8000/api/bookings/41/ -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"status": "confirmed"}'
```

### Tests

`backend/bookings/tests.py` has 35 booking tests (plus the stats tests below). They **must run on Postgres**,
because the exclusion constraint is Postgres-only. That's what
`docker compose exec backend python manage.py test` uses. They cover:

- **The constraint itself:** overlap rejected with SQLSTATE `23P01`;
  back-to-back stays, a different property and cancelled bookings all
  allowed; reviving a cancelled booking into taken dates rejected.
- **Create:**
  - price is computed on the server and any client-sent price, status or
    guest is ignored
  - the pre-check returns `409`
  - with the pre-check switched off, the constraint alone still gives a
    `409`, not a 500
  - every validation rule, and the limits are inclusive (30 nights,
    365 days ahead)
- **List and detail:** a guest sees only their own bookings; the admin
  sees all, with emails; `upcoming`/`past` filters and ordering, status
  filter, `property` and `search` filters are admin-only (a guest's
  search is ignored and never shows anyone else's booking), `can_cancel`, and `405` for
  `PUT`/`DELETE`.
- **Transitions:**
  - guest cancel before and after check-in
  - the 48h deadline: one minute before is allowed, at the deadline it's
    a `400`, and an admin can still cancel after it (time is mocked)
  - the deadline is exactly 48 real hours across a DST change
  - both settings are configurable
  - a guest can't confirm or touch someone else's booking
  - the admin transition table, and cancelled is final
  - only `status` is editable
  - cancelling frees the dates up again
- **Real concurrency**, using separate threads and database connections
  with committed data:
  - two requests are held until *both* have passed the pre-check and then
    insert together: exactly one `201` and one `409`, with one booking
    saved
  - six users booking the same dates at once: exactly one `201` and five
    `409`s
  - a guest cancel and an admin cancel on the same booking at the same
    moment: one `200` and one `400` "already cancelled" (the row lock
    prevents a lost update)

## Admin stats API

`GET /api/admin/stats/` (TICKET-016) returns the numbers for the admin
dashboard (TICKET-023). It is **admin only** (`IsAdminRole`): no token →
`401`, guest → `403`. The view is `bookings/views.py:AdminStatsView` and
the maths is in `bookings/stats.py:compute_stats`.

### Period

`?from=YYYY-MM-DD&to=YYYY-MM-DD` covers a range of **nights**, both ends
included. The night of date D is the one starting on D, so a stay from
the 10th to the 13th occupies the nights of the 10th, 11th and 12th.

- With no params you get the **current calendar month**.
- `from` and `to` must be given together, `to` can't be before `from`,
  and the period can be at most 366 days.
- Bad values get a `400` with a per-field message.

### What the numbers mean

- **Only nights inside the period count**, for both occupancy and revenue.
  A stay that crosses the period's start or end contributes just the
  nights that fall inside it. For example, a 10-night stay over month-end
  is split between the two months.
- **Occupancy rate** = confirmed nights ÷ (active properties × nights in
  the period), from 0 to 1, rounded to 4 decimals.
  - Only **confirmed** nights count as occupied. Pending nights are
    reported separately as `pending_nights`, the pipeline.
  - Only **active** properties count. A retired property's nights aren't
    available any more, so including them would distort the rate.
  - If there are no active properties, the rate is `null` ("no data")
    rather than a misleading 0.
- **Revenue** is spread evenly over a stay's nights (`total_price ÷
  nights` per night).
  - `confirmed` is earned revenue and `pending` is expected revenue.
  - Retired properties' revenue **is** included, because it's still real
    money.
  - The sums are exact decimals, rounded to cents once at the end, so
    thirds don't drift.
- **Cancelled** bookings never count toward occupancy or revenue. They
  only appear in the status counts.
- **`bookings`** counts stays that overlap the period, by status.
  `created_in_period` counts bookings *made* during the period, whatever
  their dates.

### Response

```json
{
  "period":    {"from": "2026-09-01", "to": "2026-09-30", "nights": 30},
  "bookings":  {"total": 4, "pending": 0, "confirmed": 4, "cancelled": 0, "created_in_period": 32},
  "occupancy": {"rate": 0.0545, "booked_nights": 18, "pending_nights": 0,
                "available_nights": 330, "active_properties": 11},
  "revenue":   {"confirmed": "776.00", "pending": "0.00"},
  "properties": [
    {"id": 42, "title": "Spacious Studio in Thessaloniki", "is_active": true,
     "booked_nights": 5, "pending_nights": 0, "occupancy_rate": 0.1667,
     "revenue": "375.00", "pending_revenue": "0.00"}
  ]
}
```

`properties` is the per-property breakdown, sorted by revenue with the
highest first. It includes every active property, even with zero
bookings (an empty row is useful to see). It also includes any retired
property that still earned something in the period. Money values are
strings, the same as the rest of the API, so no float rounding happens
in JSON.

The whole thing is a fixed handful of queries however many properties or
bookings there are: one for the overlapping bookings, one for the
properties, and one count. A test checks this.

```bash
curl "http://localhost:8000/api/admin/stats/?from=2026-10-01&to=2026-10-31" -H "Authorization: Bearer $TOKEN"
```

### Tests

`AdminStatsTests` in `backend/bookings/tests.py` has 10 tests. They use
hand-built data with every number worked out by hand:

- stays crossing both edges of the period
- a stay ending exactly when the period starts, and one starting right
  after it ends (both excluded)
- a cancelled booking, a retired property (revenue yes, occupancy no),
  and an empty property
- a total that divides into thirds (`626.67`)
- a single-night period
- the default current month
- no active properties → `null` rate, and an empty period
- all the bad-parameter `400`s, and 366 days allowed
- `401`/`403`
- a constant query count

## Frontend auth (Angular)

TICKET-017 adds login and registration to the Angular app, plus the
plumbing every later page relies on. It uses standalone components and
signals (the app is zoneless) and **no extra npm packages**, so the
`frontend` container picks it up without a rebuild.

### Pages and routes (`src/app/app.routes.ts`)

| Route | Page | Notes |
| --- | --- | --- |
| `/` | redirects to `/listings` | The listings page is the home page since TICKET-018; see "Listings page" |
| `/login` | `pages/login/` | Email + password (show/hide toggle) |
| `/register` | `pages/register/` | Email, password + confirm (must match), optional first/last name and phone |

The pages are lazy-loaded, so each is its own small chunk. `/login` and
`/register` use `guestOnlyGuard`: a user who is already logged in is sent
to `/`. Any unknown URL redirects to `/listings`.

**Forms** use Angular Material outline fields, and the shared styling is
in `pages/auth-page.scss`.

- **Checks as you type:** each field shows its problem as the user types,
  e.g. "Enter a valid email address.", "At least 8 characters.",
  "Passwords don't match." (re-checked when the first password changes).
- **The backend's own messages** appear under the matching field, e.g.
  `{"email": ["An account with this email already exists."]}` or
  "This password is too common.". Editing that field clears the message.
  Errors not tied to a field (e.g. "No active account found with the
  given credentials", or "Can't reach the server") show in a banner
  above the form. `core/api-errors.ts:parseApiErrors` does the mapping
  for every form.
- **While submitting** the button is disabled and shows a spinner, so a
  double-click can't send two requests.
- **Afterwards** the user goes to `?returnUrl=` if it's a same-app path
  (anything else, like `//evil.com`, is ignored), otherwise to `/`.
  Registering logs the user in straight away, because the API returns
  tokens.

### Toolbar (`src/app/layout/toolbar/`)

A minimal top bar shows the brand (a link home) on the left. On the right
it shows either **Log in / Sign up**, or the user's email and **Log out**.
TICKET-022 turns it into the role-aware navbar with the Admin link. On
phones the brand text and email collapse to icons.

### `AuthService` (`src/app/core/auth/auth.service.ts`)

- **Signals:** `currentUser`, `isLoggedIn`, `isAdmin`. The toolbar reads
  them now, and the guards (TICKET-021/022) will too.
- **Methods:**
  - `login()` and `register()` save the session.
  - `loadMe()` calls `GET /api/auth/me/`.
  - `logout()` clears the session and goes home. There's no server call,
    because tokens aren't blacklisted in this demo.
  - `expireSession()` logs out and goes to `/login?returnUrl=...&reason=expired`,
    where the page shows "Your session expired. Please log in again.".
- **Storage** (`token-storage.ts`) is **localStorage**, under the keys
  `bsd.access`, `bsd.refresh` and `bsd.user`. The user stays logged in
  across reloads and tabs until the 1-day refresh token expires. Every
  read and write is wrapped in try/catch: in private mode or with blocked
  site data the app still works, it just won't remember the session. The
  trade-off with localStorage is XSS exposure. Angular escapes template
  output by default, which is the main defence here.
- **App start** (`provideAppInitializer` → `init()`), before the first
  render:
  - No refresh token, or an expired one: the session is cleared silently,
    with no API call.
  - Otherwise it calls `GET /api/auth/me/`, so the **role always comes
    from the server**. The cached user is only there so the toolbar
    renders instantly. The `role` claim inside the JWT is never trusted
    for anything.
  - If the server rejects the session, it's cleared. If the backend is
    simply unreachable, the cached session is kept until it's back.
- **Reading tokens:** `core/auth/jwt.ts` is a ~20-line base64url decoder,
  used only to read `exp`. There's no `jwt-decode` dependency and no
  signature check; checking the signature is the server's job.

### `authInterceptor` (`src/app/core/auth/auth.interceptor.ts`)

Registered with `provideHttpClient(withInterceptors([authInterceptor]))`.

1. **Adds the token only where it belongs.** Requests to our API
   (`environment.apiUrl + '/'`) get `Authorization: Bearer <access>`.
   Third-party URLs (e.g. picsum image hosts) and look-alike prefixes
   never do. `login/`, `register/` and `refresh/` are left untouched.
2. **Refreshes when the token has expired.** If the API answers **401**
   and a refresh token exists, the interceptor calls `POST /api/auth/refresh/`
   **once** and replays the original request with the new access token.
   The user never notices.
3. **One refresh for many requests.** If several requests get a 401 at
   the same time, they all wait for the **same** refresh call
   (`refreshAccessToken()` shares one in-flight request). They don't each
   fire their own.
4. **No loops.** If the refresh fails, the session is over:
   `expireSession()` runs, and the caller receives the original 401. The
   replayed request goes straight to the next handler rather than back
   through this interceptor, so a second 401 can never trigger another
   refresh. Errors other than 401 (400, 409, 500 and so on) pass through
   untouched.

The refresh is reactive (on 401) rather than on a timer. It has fewer
moving parts, and it behaves correctly after a laptop wakes from sleep.

### Frontend tests

The frontend uses Vitest through the Angular CLI (`npx ng test --watch=false`,
or `docker compose exec frontend npx ng test --watch=false`). There are
34 tests:

- **`jwt.spec.ts`:** decoding, including unicode, and the expiry checks
  with skew.
- **`api-errors.spec.ts`:** field errors, `detail`/`non_field_errors`,
  and network or server failures.
- **`auth.service.spec.ts`:**
  - login and register save the session; a failed login leaves none;
    logout clears everything
  - on `init()`: with no session nothing happens; an expired refresh
    token is dropped with no API call; the role is re-read from `/me/`
    (a cached guest who was promoted becomes admin); an unreachable
    backend keeps the cached session; a rejected session is cleared
  - `safeReturnUrl` blocks open redirects
- **`auth.interceptor.spec.ts`:**
  - the header is sent to our API only, never to login/register/refresh,
    and not when logged out
  - on a 401 it refreshes and retries with the new token saved
  - three simultaneous 401s produce **one** refresh
  - a failed refresh logs out and redirects with `returnUrl`
  - no loop when the retried request also gets a 401; no refresh without
    a refresh token; 409s pass through
- **`login.spec.ts` / `register.spec.ts`:** invalid forms don't submit;
  the request body is trimmed and optional fields are only sent when
  filled in; server errors appear under the right fields; a successful
  submit redirects.
- **`app.spec.ts`:** the toolbar shows Log in / Sign up when logged out,
  and the email / Log out when a session is stored.

## Listings page (Angular)

`/listings` (TICKET-018) is the **home page**: `/` redirects to it, and
so does any unknown URL. It shows a searchable, paginated grid of the
**active** properties. The page is `pages/listings/listings.ts`
(`PropertyListPage`) and each card is `pages/listings/property-card/`.

### The search lives in the URL

Every search is a URL with the same parameter names as the API, e.g.
`/listings?location=chania&guests=2&check_in=2026-11-02&check_out=2026-11-07&ordering=price&page=2`.
So searches can be shared and bookmarked, a reload keeps them, and the
browser's Back/Forward buttons move between searches.

- **One direction only:** the page's data is driven *only* by the URL
  (`ActivatedRoute.queryParamMap` → `PropertyService.list()` via
  `switchMap`, so a newer search cancels an older in-flight one). Form
  actions just change the URL. On every URL change the form is refilled
  from the URL (`emitEvent: false`, so it never loops).
- **Bad values are dropped:** `listing-query.ts` converts both ways and
  drops junk from a hand-edited URL (`guests=lots`, a lone date, an
  unknown sort, `page_size=1000`) rather than sending it to the API.
  Defaults are left out, to keep URLs short.

### Filters and when they apply

| Control | When it applies | Notes |
| --- | --- | --- |
| Check-in – check-out (Material date range picker) | **Search** button / Enter | Can't pick past dates or more than 365 days ahead (same as the API). Both dates are required, and check-out must be after check-in; the error shows under the bar. Displayed as dd/mm/yyyy |
| Where (text) | Search | Case-insensitive "contains", e.g. `thess` |
| Guests (1–16, or Any) | Search | capacity ≥ guests |
| Min / Max €/night | **Automatically**, 0.5 s after you stop typing | Refines the current search. Min can't be above max |
| Sort by (Newest, Price ↑/↓, Most/Fewest guests) | **Immediately** | Refines the current search |
| Clear filters | — | Shown whenever a filter is active |

Starting a search or changing a filter always goes back to page 1. Sort
and price refine what was last *searched*: text typed into "Where" but
not yet searched is not applied by accident.

### Cards

Each card shows:

- the cover photo, lazy-loaded, with a placeholder if it's missing or
  fails to load
- title, location, and "Sleeps N"
- ★ rating (review count), or **New** when there are no reviews
- up to 3 amenities with readable labels (`sea_view` → "Sea view",
  `wifi` → "Wi-Fi") and "+N"
- **price per night**, and the **total for the stay** once dates are
  picked, e.g. "€455 for 5 nights". This total is an estimate; the
  backend computes the real price when booking.

Clicking a card opens `/listings/:id` and carries the dates and guests
along, so the detail page (see "Property detail page") can pre-fill the
booking.

**Prices are shown in euros** (the API has no currency field). All
formatting goes through `core/money.ts` (`formatPrice`, `CURRENCY`),
e.g. `"91.00"` → "€91" and `"95.50"` → "€95.50".

### States

- **Loading:** shimmering skeleton cards.
- **No results:** "No stays match your search." with **Clear filters**.
- **The API rejected the search** (a 400, e.g. a hand-typed URL with
  past dates): the API's message in plain words, "Check-in can't be in
  the past.", with **Clear filters**.
- **Server down or 5xx:** the message with **Try again**, which re-runs
  the same search.
- **Paginator:** appears once there's more than one page, with page sizes
  12/24/48. Paging updates the URL and scrolls back to the top.

### Pieces

- `core/properties/`: `PropertyService.list(filters, page)`,
  `toPropertyParams()` (filters → API params, empty values left out) and
  the models. `list()` always adds `is_active=true`, so an **admin**
  browsing the listings sees the same active-only list as everyone else.
  The admin table (TICKET-024) will list everything.
- `core/dates.ts`: helpers for date-only values. `toIsoDate()` formats
  the **local** date. `toISOString()` would convert to UTC and turn
  midnight in Greece into the *previous* day. `nightsBetween()` counts
  calendar days, so it's correct across daylight-saving changes.
- `layout/footer/`: a footer with a small **connectivity dot**: green =
  "API & database connected", red = "API unreachable". It replaces the
  old home-page card, which was removed together with the temporary home
  page.

### Tests

54 frontend tests (20 new for this ticket):

- **Date helpers:** no UTC shift, rejects roll-overs like Feb 30, night
  counts across DST.
- **`formatPrice`.**
- **`PropertyService`:** params, empty values left out, `is_active=true`.
- **URL ↔ query:** round-trip, and junk dropped.
- **Property card:** price, rating, amenity chips, stay total, "New",
  photo fallback, and the detail link carrying dates and guests.
- **Listings page:**
  - URL → one API call → cards and totals
  - Search → URL, back to page 1
  - a lone date is blocked
  - sort applies instantly, but not unsearched text
  - empty state; a 400 with a readable message and Clear filters; a 500
    with Try again that re-requests
  - paginator and paging → URL

It was also checked by hand in Chrome against the seeded data: a URL
search, typing and Search, price refining, Back, a past-date URL and the
empty state.

## Property detail page (Angular)

`/listings/:id` (TICKET-019) is `pages/property-detail/` (`PropertyDetailPage`).
You reach it by clicking a card on the listings page, which passes along
the searched dates and guests
(`/listings/42?check_in=2027-02-02&check_out=2027-02-04&guests=2`).

### What's on the page

- **Back to results** returns to the *exact* listings search you came
  from. It reads the router's previous navigation, and falls back to
  `/listings` if you opened the page directly. The browser tab title
  becomes the property's name.
- **Header:** title, location, ★ rating · N reviews (or **New**), and
  "Sleeps N".
- **Gallery** (`gallery/`):
  - a large photo with prev/next arrows (they wrap around), a "2 / 5"
    counter and a thumbnail strip
  - clicking the photo opens a **full-screen viewer** (`gallery-lightbox.ts`,
    a Material dialog): ← → keys, swipe on phones, Esc / ✕ / clicking
    the backdrop to close; it closes on the photo you ended on
  - broken or missing photos show a placeholder
- **About this stay** (the description) and **What this place offers**:
  *all* amenities, with icons and readable labels. They come from the
  shared `core/amenities.ts`, which the listing cards use too.
- **Availability** (`availability-calendar/`):
  - an inline **two-month calendar** (one month on phones) with its own
    ‹ › month navigation; booked nights are ~~struck through~~
  - click a check-in date, then a check-out date; "Clear dates" resets.
    The choice fills the booking panel, and the panel's date picker
    updates the calendar too, because the page's form holds the state
    for both
- **Booking panel:** sticky on the right on desktop, below the details on
  phones.
  - € price / night, the date range picker, and guests (1…capacity)
  - a live status: "Checking availability…", **Available for your dates ✓**,
    or **Not available for these dates**
  - price breakdown: "€182 × 2 nights = €364", marked as an estimate
  - **Book now**

### Availability rules (same as the backend)

A booking occupies the nights **`[check_in, check_out)`**. That means:

- a night that's already booked can't be your **check-in**
- your **check-out** can be the day another guest checks in (you leave
  that morning), but every night in between must be free
- stays are at most **30 nights**, from today up to **365 days** ahead
  (the backend's limits)

`core/properties/availability.ts` (`BookedNights`) turns
`availability.booked_ranges` from `GET /api/properties/{id}/` into a set
of booked nights. The calendar, the panel's date picker and the
validation all use this one helper, so they can't disagree. The page
checks locally first and shows problems instantly: "Some of these nights
are already booked.", "Pick a check-out date.", "A stay can be at most 30
nights.". Once the dates pass, it asks the API
(`GET /api/properties/{id}/?check_in=&check_out=` → `is_available`). The
server's answer is what counts; if someone booked those dates a moment
ago, the panel says so.

That request is driven by **one** computed signal (property + dates +
local verdict), not several streams combined. So it never fires with a
half-updated mix of values. A test caught exactly that with the first
version.

### URL and Book now

- The chosen dates and guests are written back into the URL
  (`replaceUrl`, so it doesn't clutter history). A reload or a shared
  link keeps the stay.
- **Book now** is only enabled when the property is active, the dates are
  complete and valid locally, and the API has confirmed they're free. It
  goes to `/booking/:id?check_in=…&check_out=…&guests=…`, the booking
  form (see "Booking form").
- **Not logged in?** Book now goes to `/login?returnUrl=/booking/…`.
  After logging in (or signing up; the Create one link keeps the
  returnUrl), the user lands on the booking form with the stay
  pre-filled.

### States

- **Loading:** skeleton placeholders.
- **404** (unknown id, or an inactive property for guests): "This stay
  doesn't exist or is no longer available." with **Browse stays**.
- **Other errors:** **Try again**.
- **An admin viewing an inactive property:** a "Hidden from guests"
  banner, and Book now stays disabled.

### Tests

76 frontend tests in total (22 new for this ticket):

- **`BookedNights`:** `[check_in, check_out)` nights; checking out on
  someone's check-in day and in on their check-out day; stays that touch
  or span a booking are rejected.
- **Amenity labels and icons.**
- **`PropertyService.get()`** with and without dates.
- **Calendar:**
  - which dates are clickable when picking check-in vs check-out
  - click flow (start → end; clicking before the start restarts)
  - two months shown; Clear
- **Gallery:** wrap-around, thumbnails and counter, opening the viewer at
  the current photo and keeping the photo it closed on, placeholders.
- **Page:**
  - URL pre-fill → the detail call → the availability call with the
    dates → "Available" + €91 × 5 = €455
  - a stay over a booked night is blocked with **no** API call
  - checking out on someone's check-in day is allowed
  - the API says "taken" → "Not available"
  - "Pick a check-out date" and the 30-night cap
  - Book now while logged out → `/login?returnUrl=/booking/5?…`;
    logged in → `/booking/5?…`
  - the inactive-property banner, and the 404 message

Also checked by hand in Chrome against the seeded data:

- card → detail with the search carried over
- struck-through booked nights (Feb 4–15, 2027 on property 42)
- a clash message with Book now disabled
- a calendar pick ending on the 4th (someone's check-in day) → the API
  confirms "Available", €364, and the URL updates
- the full-screen viewer with ← → and Esc, returning on the last photo

## Booking form (Angular)

`/booking/:propertyId?check_in=…&check_out=…&guests=…` (TICKET-020) is
`pages/booking/` (`BookingFormPage`), where **Book now** on the detail
page leads. It is protected by **`authGuard`** (`core/auth/auth.guards.ts`,
reused by My Bookings in TICKET-021). A logged-out visitor is sent to
`/login?returnUrl=<the exact booking URL>`, and after logging in or
signing up lands back here with the stay pre-filled.

### Two steps (Material vertical stepper, linear)

1. **Your trip.** The date range picker (booked nights disabled) and
   guests (1…capacity), pre-filled from the URL and synced back to it.
   Problems show instantly using the same shared rules as the detail
   page (`core/properties/stay-rules.ts`: "Pick a check-out date.",
   "Some of these nights are already booked.", the 30-night and 365-day
   limits). Then the API confirms availability. **Continue** is enabled
   only once it's confirmed.
2. **Review & confirm.** Check-in (from 15:00) and check-out dates,
   guests, and the **cancellation policy**: "Free cancellation until
   Sun 31 Jan, 15:00 (48 hours before check-in). After that, only the
   host can cancel." A note says the booking starts as **pending** and
   nothing is charged. Then **Confirm booking**.

A side card, shown in both steps, holds the photo, title, location,
"Sleeps N", €/night and the **live price**: €182 × 2 nights = €364,
marked as an estimate because the server calculates the real total.

### Confirming

- `BookingService.create()` (`core/bookings/`) sends
  `POST /api/bookings/ {property, check_in, check_out, guests}`, only
  what the API accepts. The server decides the price, the `pending`
  status and the guest.
- **No double bookings from double clicks:** while the request is in
  flight, the button shows a spinner and is disabled, and `confirm()`
  ignores further calls. A test clicks twice and expects exactly one
  POST.
- **409 (dates just taken by someone else):** the server's message is
  shown, the property's booked nights are **reloaded** (the newly taken
  nights appear crossed out, and the stay is flagged "Some of these
  nights are already booked."), and the stepper goes back to step 1. The
  form keeps its values, so the guest can pick new dates. This is the
  frontend side of TICKET-015's exclusion-constraint guarantee.
- **400:** the server's message is shown in plain words, e.g. "This
  property sleeps at most 3 guests.".

### Confirmation screen

After a successful booking, the page switches to **"Booking request
sent"**, built from the server's response:

- reference **#id**, status **Pending**
- stay, dates, guests, nights and the server-calculated **total**
- the **server's** `cancel_deadline` ("Free cancellation until …")
- buttons **My bookings** (the page arrives in TICKET-021; until then it
  lands on the listings page) and **Browse more stays**

### Cancellation policy in one place

`core/bookings/booking-policy.ts` mirrors the backend settings
`BOOKING_CHECK_IN_TIME` (15:00) and `BOOKING_GUEST_CANCELLATION_HOURS`
(48): `cancelDeadline(checkIn)` is exactly 48 real hours before
check-in at 15:00. It is only used for the *preview* before a booking
exists. Afterwards, the server's own `cancel_deadline` is what's shown.
If you change the backend settings, update these two constants too.

### States

- **Loading.**
- **Inactive or unknown property:** "This stay can't be booked" with
  **Browse stays**.
- **Other errors:** **Try again**.
- **Non-numeric property id:** redirects to `/listings`.
- The tab title follows the page, e.g. "Book Modern Room in
  Thessaloniki", then "Booking request sent".

### Tests

91 frontend tests (15 new for this ticket):

- **`BookingService`:** the POST body, and get.
- **Policy:** 15:00 check-in, exactly 48h, the date format.
- **Stay rules:** every message, and the date filter.
- **Guards:**
  - logged out → `/login?returnUrl=/booking/5?…`
  - logged in → allowed through
  - `/login` while logged in → home
- **Booking page:**
  - pre-fill → live price → the API confirms → step 2 unlocked
  - Confirm → exactly one POST despite a double click → confirmation
    with #77, Pending, the total and the deadline
  - 409 → message, booked nights reloaded, dates blocked, no booking
    shown
  - 400 → a readable message
  - no dates → can't continue or confirm
  - inactive or 404 → "can't be booked"
  - bad id → listings

Also checked in Chrome: steps 1 → 2 on property 42 (2–4 Feb 2027, €364,
"Free cancellation until Sun 31 Jan, 15:00").

## My Bookings page (Angular)

`/my-bookings` (TICKET-021) is `pages/my-bookings/` (`MyBookingsPage`),
protected by the same **`authGuard`** as the booking form. A logged-out
visitor goes to login and comes back here. The toolbar has a **My
bookings** link whenever you're logged in (highlighted while you're on
the page), and the booking confirmation screen's "My bookings" button
now lands here.

### Tabs (in the URL: `?tab=past&page=2`)

| Tab | API query (always `mine=true`) | Order |
| --- | --- | --- |
| **Upcoming** (default) | `when=upcoming&status=pending,confirmed`: not checked out yet, not cancelled, including a stay you're in right now | soonest first |
| **Past** | `when=past&status=pending,confirmed` | most recent first |
| **Cancelled** | `status=cancelled` (any dates) | most recent check-in first |

A reload or the browser's Back button keeps the tab and page. The
paginator shows when there are more than 12 bookings.

### Booking cards

Each card shows:

- the cover photo and title, both linking to the property
- a status chip (**Pending** amber, **Confirmed** green, **Cancelled**
  grey), plus **Staying now** during a stay
- location, dates (weekday, date, year), nights and guests
- the server-computed **total**, the reference **#id**, and when it was
  booked
- for pending upcoming stays: "Waiting for the host to confirm."
- for upcoming, not-cancelled stays, one of:
  - **Free cancellation until Sun 31 Jan, 15:00** plus a **Cancel
    booking** button, when the server says `can_cancel` (the 48-hour
    rule from TICKET-015)
  - "Can no longer be cancelled online (less than 48 hours before
    check-in)"

### Cancelling

1. **Cancel booking** opens a confirmation dialog
   (`pages/my-bookings/cancel-dialog.ts`): "Cancel this booking?" with
   the property, dates, nights and total. It notes that this can't be
   undone (cancelled is final; to change your mind you'd book again) and
   that there's nothing to refund yet (refunds come with payments,
   TICKET-040). Buttons: **Keep booking** (the default focus) and a red
   **Cancel booking**.
2. On confirm it sends `PATCH /api/bookings/{id}/ {"status": "cancelled"}`
   (`BookingService.cancel()`). The button shows a spinner, and other
   cancel buttons are disabled until it finishes.
3. **Success:** a snackbar "Booking #56 cancelled.", and the list
   refreshes. The booking leaves Upcoming and appears under Cancelled.
4. **The server refuses** (e.g. the 48h deadline passed while the page
   was open): its exact reason goes in a snackbar ("Online cancellation
   closed on … Please contact us."), and the list refreshes, so the card
   now shows it can no longer be cancelled online.

### Backend additions for this page

`GET /api/bookings/` got two backward-compatible filters (see the
Bookings API table):

- `?mine=true`: only the caller's **own** bookings, **even for an
  admin**. An admin's default list is everyone's; the admin bookings
  table in TICKET-025 keeps using that.
- `?status=` accepts a **comma list**, e.g. `pending,confirmed`, so
  "Upcoming" can leave out cancelled bookings. Unknown values get a
  `400`.

### Tests

- **Backend:** 3 new tests (the comma status list, and `mine` for an
  admin and for a guest). The full backend suite (94 tests) passes on
  Postgres.
- **Frontend:** 100 tests (9 new):
  - service `list()` params and the `cancel()` PATCH
  - each tab's query and the tab in the URL
  - cancel: confirm → PATCH → snackbar → the card leaves the tab;
    "Keep booking" sends nothing; a server refusal shows its reason,
    refreshes, and the card shows it can no longer be cancelled
  - the "Staying now" chip; no actions for past or cancelled bookings
  - the error state with Try again
  - paging through the URL
  - the toolbar link only when logged in

Also checked in Chrome as the demo admin: only the admin's own booking
#56 appears (not everyone's), the Past tab is empty, and the cancel
dialog opens and closes with **Keep booking**, so nothing was cancelled.

## Admin area (Angular)

TICKET-022 adds the admin shell, the guard for it, and a role-aware
navbar. The admin pages themselves are filled in by TICKET-023 (dashboard),
TICKET-024 (properties) and TICKET-025 (bookings).

### Routes (`app.routes.ts`)

| URL | Page | Notes |
| --- | --- | --- |
| `/admin` | → `/admin/dashboard` | The whole `/admin` group is lazy-loaded and guarded **once** by `adminGuard` |
| `/admin/dashboard` | `pages/admin/dashboard/` | Stat cards, period picker, comparison, per-property table; see "Admin dashboard" |
| `/admin/properties` | `pages/admin/properties/` | Table of all properties; `/new` and `/:id/edit` form (unsaved-changes guard); see "Admin properties" |
| `/admin/bookings` | `pages/admin/bookings/` | Every guest's bookings, Upcoming / Past / Cancelled, confirm and cancel; see "Admin bookings" |
| `/forbidden` | `pages/forbidden/` | The friendly 403 page |

### `adminGuard` (`core/auth/auth.guards.ts`)

- **Logged out** → `/login?returnUrl=/admin/…`, the same as `authGuard`.
- **Logged in:** before deciding, it **re-reads the user from the
  server** (`GET /api/auth/me/`). A user demoted since their page loaded
  is stopped, even though the role cached in their browser still says
  "admin". If the server can't be reached, it decides on the cached role.
- **Not an admin** → `/forbidden?from=/admin/…`. That page says "Admins
  only" and who you're logged in as (e.g. "guest@example.com (guest)").
  Its buttons are **Back to stays** and **Log in as someone else**, which
  logs out and then returns to the admin page you wanted after logging
  in.
- **This is navigation, not security.** The data is protected by the
  backend: `IsAdminRole` / `IsAdminOrReadOnly` (checked against the
  database on every request) return 403. The bookings list is always
  narrowed to the caller's own bookings for guests. Hiding the Admin
  link or passing the guard grants nothing on its own.

### Admin layout (`pages/admin/admin-layout.ts`)

- A left **side nav**: Dashboard, Properties, Bookings, with the current
  page highlighted and marked `aria-current="page"`.
- **Back to site**, and the admin's email at the bottom.
- On phones the side nav becomes a scrollable bar across the top.

- A **pending badge** on Bookings (e.g. an amber "7"): how many upcoming
  bookings are still waiting for confirmation. `AdminBadgesService` reads
  it when the admin area opens, and again after every confirm or cancel.
  It asks for a 1-item page and uses the total `count`, so it's cheap. If
  the request fails, the last known number stays.

The placeholder page used while the admin screens were being built was
removed in TICKET-025, when the last one was filled in.

### Role-aware navbar (`layout/toolbar/`)

- **Logged out:** Log in / Sign up.
- **Logged in:**
  - **My bookings**, plus **Admin** for admins only; the current section
    is highlighted
  - an **account button** (icon + email ▾) that opens a menu with your
    email, a Guest/Admin role badge, and **Log out**
- The Admin link follows the `AuthService.isAdmin` signal, which is
  refreshed from `/api/auth/me/` on app start and whenever `adminGuard`
  runs. A role change on the server shows up without reloading.
- On phones, the links move into the account menu, and the brand text
  and email collapse to icons.

### Tests

112 frontend tests (12 new):

- **`adminGuard`:** logged out → login with no API call; an admin
  confirmed by `/me/` gets in; a guest → `/forbidden?from=…`; cached
  "admin" but demoted on the server → 403 (the server wins); server
  unreachable → cached role.
- **Toolbar:** logged-out links; guest: My bookings only; admin: My
  bookings + Admin; the Admin link disappears when the role changes;
  the account menu shows email, role and Log out.
- **Admin layout:** `/admin` → dashboard, the nav items, the
  active/`aria-current` state, the child page.
- **Forbidden page:** shows who's logged in; "Log in as someone else"
  logs out and keeps the returnUrl.

Also checked in Chrome as the demo admin: `/admin` → Dashboard, the side
nav, the highlighted Admin link, and the account menu with the Admin
badge and Log out. The guest-side 403 is covered by the tests; to see it
yourself, log in as a guest and open `/admin`.

The production bundle-size warning threshold in `angular.json` was
raised from 500 kB to 700 kB. The toolbar's Material menu pushed the
initial bundle to about 523 kB (about 127 kB over the wire). The hard
error limit stays at 1 MB.

## Admin dashboard (Angular)

`/admin/dashboard` (TICKET-023) is `pages/admin/dashboard/`
(`AdminDashboardPage`). It replaces the placeholder and reads
`GET /api/admin/stats/?from=&to=` (TICKET-016) through
`core/admin/admin-stats.service.ts`. All definitions (only nights inside
the period count, occupancy = confirmed nights of active properties,
revenue spread per night) come from the backend; see "Admin stats API".

### Choosing the period

The buttons are **This month** (the default), **Last month**, **Next
month**, **Next 30 days**, **Last 12 months** and **Custom…**. Custom
opens a date range picker limited to 366 days, the API's maximum, and
applies as soon as both dates are picked.

- **The period lives in the URL**, e.g. `?period=last-12` or
  `?period=custom&from=2026-07-10&to=2026-08-08`. Reloads and shared
  links keep it. Invalid or too-long ranges fall back to This month.
- **The header** shows the range and length, e.g. "1 – 30 Sept 2026 ·
  30 nights · changes shown vs August".
- **What it's compared with:** a whole calendar month is compared with
  the previous calendar month (September vs August, even though August
  has an extra day). Any other range is compared with the equally long
  window right before it ("vs previous 30 days"). "Last 12 months" is 12
  whole calendar months and never exceeds 366 days, even across a leap
  year.
- **Two requests:** each period loads its stats and the comparison
  period's stats in parallel (`forkJoin`). If the comparison request
  fails, the numbers still show, just without the changes.

### Stat cards

| Card | Main value | Also shows |
| --- | --- | --- |
| **Revenue** (the one large "hero" figure) | Confirmed revenue for nights in the period | Change vs the previous period; "+ €X expected from pending bookings" |
| **Occupancy** | e.g. 26.7% | Change in **percentage points**; a meter bar; "8 of 30 nights booked · 3 active properties"; "+ N nights pending confirmation" |
| **Stays in period** | Confirmed + pending stays | Change; the confirmed / pending / cancelled split; "N new bookings made in this period" |
| **Avg. revenue per booked night** | Confirmed revenue ÷ confirmed nights, across all properties that earned something (retired ones included, to match the revenue figure) | Change |

- **Changes are never colour-only.** They're written as **▲ / ▼ + a
  number + "vs August"**, and colour (green = better, red = worse) only
  reinforces that. Screen readers hear "(better)" / "(worse)".
  - "No change" appears below 0.5% (or 0.05 points).
  - "New" appears when the previous period was zero.
  - The change is hidden when there's nothing to compare.
- **Meter bars** use the theme's primary colour for the filled part and
  a lighter shade of the same colour for the track.
- **Big numbers** use normal proportional digits. Table columns use
  aligned `tabular-nums` digits.

### Per-property breakdown

A table under the cards, "By property · sorted by revenue", with one row
per property: booked nights, **occupancy** (a small meter + %), revenue,
and expected revenue from pending bookings.

- Every active property is listed, including ones with zero bookings.
  Retired properties that still earned something are marked
  **Retired**.
- Property names link to their public page. The admin property editor
  arrives in TICKET-024.
- The table scrolls sideways on narrow screens.

### States

- Skeleton cards while loading.
- "No bookings in this period." when the period is empty.
- "Couldn't load the stats." with **Try again**.

### Tests

126 frontend tests (14 new):

- **Presets:** month and year edges, and "Last 12 months" fitting in 366
  days across a leap year.
- **Comparison periods:** calendar month vs same-length window,
  including February in a leap year.
- **URL ↔ period:** with fallbacks for reversed, too-long and garbage
  ranges.
- **Range formatting.**
- **Changes:** % and points, better/worse, and the "No change" / "New" /
  none cases.
- **Stats service:** request params.
- **Every card value from a fixed response:** €626.67, €300 expected,
  ▲ 25%, 26.7%, ▲ 6.7 pts, 6 stays (▼ 25%), and €62.67 per night from
  626.67 ÷ 10 nights.
- **The page:**
  - the current and comparison requests, and the rendered cards and
    table, including the Retired badge
  - preset → URL
  - a failed comparison still shows the numbers
  - the error state with Try again, and the empty-period hint

Also checked in Chrome against the seeded data: This month (€78, 0.5%
occupancy ▼ 5.5 pts vs August) and Last 12 months (€2,283, 6 stays,
€84.56 per night), with the breakdown table.

## Admin properties (Angular)

TICKET-024 replaces the Properties placeholder with the real admin UI:
a table of every property, and one form for creating and editing. The
backend's `IsAdminOrReadOnly` is what actually allows the writes;
`adminGuard` only controls navigation.

### Table: `/admin/properties` (`pages/admin/properties/admin-property-list.ts`)

- **Everything an admin can see:** active **and** retired properties
  (`AdminPropertiesService.list()`). Unlike the public listings, it
  doesn't force `is_active=true`.
- **Columns:** cover thumbnail, title (links to Edit), location, €/night,
  sleeps, rating ("★ 4.5 (2)" or "New"), a **status chip** (Active /
  Retired, with retired rows greyed), and actions.
- **Filters, all in the URL** (`?status=retired&search=corfu&ordering=-price&page=2`):
  - status **All / Active / Retired**
  - search box over **title or location**, applied 300 ms after you stop
    typing
  - sort (newest, price ↑/↓, most guests)
  - paginator, 12 per page
- **Actions per row:** **Edit** (pencil), and a ⋮ menu with **View
  public page** and **Retire…** or **Reactivate**.
  - **Retire** asks first, in a red confirm dialog: "It will be hidden
    from guests and can't be booked any more. Existing bookings, reviews
    and stats are kept…". It then calls `DELETE`, which the backend
    treats as a soft delete (`is_active=false`, since bookings use
    `on_delete=PROTECT`).
  - **Reactivate** sends `PATCH {"is_active": true}`.
  - Both show a snackbar and refresh the table. The row's menu is
    disabled while its request runs.
- **+ New property** button; skeleton rows; "No properties match." and
  an error with Try again.

### Form: `/admin/properties/new` and `/admin/properties/:id/edit` (`property-form.ts`)

- **Details:**
  - title (required, ≤ 200 characters) and location (required)
  - description
  - price per night (€, > 0)
  - sleeps (whole number ≥ 1)
  - an **Active** switch ("Active - visible and bookable" / "Retired -
    hidden from guests")
- **Amenities** (`amenities-picker.ts`, a form control):
  - a checklist of the 13 known amenities with icons
    (`core/amenities.ts:KNOWN_AMENITIES`)
  - an **Other amenity** field: "Hot tub" is stored as `hot_tub` and
    shown as "Hot tub" everywhere, like the built-in keys
    (`toAmenityKey()`); custom ones appear as removable chips
  - the order is stable: known amenities first, then custom ones
- **Photos** (`images-editor.ts`, a form control):
  - paste a URL → **Add photo**. The URL must start with
    `http(s)://`, and duplicates are refused.
  - **drag to reorder** (Angular CDK drag & drop, using the handle)
  - **★ to choose the cover**. There's always exactly one cover: the
    first photo you add, or the next one if you remove the cover.
  - **remove**
  - broken URLs show a "Couldn't load this image" warning
  - URLs only for now. Real uploads to S3 are TICKET-036, which only
    needs to replace the "add" part of this component.
- **Saving:**
  - new properties are `POST`ed; edits are `PATCH`ed with the full body.
    The backend then **replaces** the image set with the list as shown,
    in this order.
  - the button shows a spinner and blocks double-submits
  - the server's 400 messages land under the right fields, including
    nested ones like `images: [{image: ["Enter a valid URL."]}]`
  - on success: a snackbar "Saved "Harbour Loft"." and back to the table
- **Unsaved changes:** `core/unsaved-changes.guard.ts` (`canDeactivate`)
  asks **"Discard unsaved changes?"** (Keep editing / Discard changes)
  if you navigate away with edits. Closing or reloading the tab triggers
  the browser's own "Leave site?" prompt (`beforeunload`).
- **States:** loading, "This property doesn't exist." for an unknown id,
  and an error with Try again. Edit mode has a **View public page**
  link.

### Backend addition

`GET /api/properties/?search=` is a case-insensitive match on the
**title or location**, backward compatible. A blank value is ignored.
It works together with `is_active` for admins. There are 2 new backend
tests (96 in total, all passing on Postgres).

### Tests

149 frontend tests (23 new):

- **Service:**
  - list params per status, search, sort and page (nothing forced by
    default)
  - create → POST, update → PATCH, retire → DELETE, reactivate → PATCH
    `is_active`
- **Unsaved-changes guard:** a clean form leaves freely; Discard →
  leave; Keep editing or Esc → stay.
- **Images editor:**
  - the first photo becomes the cover; URL and duplicate validation
  - exactly one cover, including after removing it
  - drag reorder, and fixing up the cover when loading data
- **Amenities picker:** stable ordering and de-duplication;
  checkbox toggles; custom keys.
- **Table:**
  - retired properties are listed
  - URL ↔ status, search (debounced) and sort
  - retire: confirm → DELETE → snackbar → refresh; declining does
    nothing
  - reactivate → PATCH
  - empty and error states
- **Form:**
  - nested error flattening
  - new: an invalid form is blocked, then the exact POST body, then back
    to the list with nothing marked unsaved
  - edit: loads into the form, then PATCH with the price as `99.00`
    and the ordered images
  - server errors land under price and photos
  - 404 → not found

Also checked in Chrome as the admin:

- the table with the retired property
- search "corfu" (2 results)
- the edit form for property 42: amenities ticked, 5 photos with the
  cover starred
- a photo dragged to the top
- "All properties" → the "Discard unsaved changes?" dialog → Discard,
  so **nothing was saved**

## Admin bookings (Angular)

TICKET-025 replaces the Bookings placeholder with the admin's view of
**every guest's** bookings, at `/admin/bookings`
(`pages/admin/bookings/admin-bookings.ts`). The backend is what makes it
safe: the bookings list only returns everyone's bookings to an admin
(guests always get their own), and only an admin can confirm.
My bookings stays personal for everyone, admins included (`?mine=true`).

### Tabs and filters, all in the URL

`/admin/bookings?tab=past&search=sara&property=42&pending=1&page=2`

| Control | URL | Sent to `GET /api/bookings/` |
| --- | --- | --- |
| **Upcoming** tab (default) | `tab` absent | `when=upcoming&status=pending,confirmed`: not checked out yet, soonest first. Stays in progress count as upcoming |
| **Past** tab | `tab=past` | `when=past&status=pending,confirmed`, most recent first |
| **Cancelled** tab | `tab=cancelled` | `status=cancelled` (any date) |
| **Search** box | `search=` | `search=`: guest email or property title (admin-only on the backend), applied 300 ms after you stop typing |
| **Property** dropdown | `property=` | `property=`: every property, retired ones marked "(retired)" |
| **Pending only** toggle | `pending=1` | `status=pending` (hidden on the Cancelled tab) |
| Paginator | `page=` | `page=`, 12 per page |

`mine` is **never** sent, so an admin sees everybody. Changing a tab or
filter goes back to page 1. Because the URL is the source of truth, the
browser's back button and shared links restore the exact view.
`parseAdminBookingsQuery()` and `toApiQuery()` are pure functions, so
this mapping is unit-tested on its own.

### The table

- **Columns:** booking #, guest email, property (links to its Edit
  page), stay ("2 Nov – 6 Nov 2026 · 4n", plus a **Staying now** chip
  while the guest is in), guests, total (€), a status chip (Pending /
  Confirmed / Cancelled), and when it was booked.
- Pending rows are tinted, so they stand out in a mixed list.
- The count ("20 bookings") sits above the table. It shows skeleton rows
  while loading, "No bookings match." when empty, and "Couldn't load the
  bookings." with **Try again** on an error.

### Confirm and cancel

The backend decides what's allowed, using the transition table from the
Bookings API: pending → confirmed / cancelled, confirmed → cancelled,
and cancelled is final. Unlike guests, an admin can cancel **after** the
48-hour deadline.

- **Confirm** (only on pending rows) asks first: "Confirm booking #54?",
  with the property, dates, guest, head count and total, then
  **Confirm booking** / **Not now**. It sends `PATCH {"status": "confirmed"}`
  (`BookingService.confirm()`).
- **Cancel** (on anything not already cancelled) uses the red dialog:
  "The dates will be released and this can't be undone. No payment is
  taken yet, so there's nothing to refund." (refunds are TICKET-040),
  then **Cancel booking** / **Keep booking**. It sends `PATCH {"status": "cancelled"}`.
- On success: a snackbar ("Booking #54 confirmed."), then the table
  **and** the side-nav badge refresh.
- If the server refuses (e.g. another admin cancelled it a moment ago),
  its message is shown in the snackbar and the table refreshes, so you
  see the real state. The buttons are disabled while a request runs.

### Backend addition

`GET /api/bookings/?search=` (see "Listing and filters" above): for an
admin, a case-insensitive match on the guest's email or the property
title. For a guest it is **ignored**, so it can never be used to look
at other people's bookings. There are 2 new tests (98 backend tests in
total, all passing on Postgres).

### Tests

159 frontend tests (10 new or extended):

- **Query mapping:** URL → tab/search/property/pending/page, and each
  tab → the right `when`/`status`, never `mine`.
- **Page:**
  - by default it asks for everyone's upcoming pending + confirmed
    bookings
  - rows show the guest, property link, status and the right actions
  - tabs, Pending only and the property dropdown update the URL
  - confirm: dialog → `PATCH confirmed` → snackbar → list and badge
    refreshed
  - cancel: danger dialog → `PATCH cancelled`; declining sends nothing
  - a server refusal shows its reason and refreshes
  - empty and error states
- **Service:** `search`/`property` params and `confirm()`.
- **Badge:** the service counts upcoming pending bookings from a 1-item
  page and keeps its number on errors; the side nav shows "3" with
  `aria-label="3 pending bookings"`.

Also checked in Chrome as the admin: 20 upcoming bookings, the badge
showing 7, searching "sara" with Pending only down to booking #54, and
the Confirm dialog, closed with **Not now**, so **nothing was changed**
in the database.

## Django Admin (dev-only)

Every model has a working admin registration, verified against the live
admin registry (`admin.site._registry`), not just assumed from having
written the code:

| Model | Registered in | Notable admin config |
| --- | --- | --- |
| `Property` | `listings/admin.py` | Inline `PropertyImage` editor on the property page |
| `PropertyImage` | `listings/admin.py` | Also has its own standalone list |
| `Profile` | `accounts/admin.py` | Inline on the built-in `User` admin page |
| `Booking` | `bookings/admin.py` | Filterable by status, date-hierarchy on `check_in` |
| `Review` | `reviews/admin.py` | Filterable by rating |

The admin site itself is relabeled (`core/admin.py` - `core` has no models
of its own, so that's just where the site-wide branding lives) so it reads
unmistakably as a dev tool wherever it's opened, not the product: header
"Booking System Demo — Dev DB Inspection". This is **not** the demo-facing
admin UI - that's the separate custom Angular app planned for Epic 4.

## Seeding demo data

`core/management/commands/seed_demo_data.py` is a Django management
command (`python manage.py seed_demo_data`) that fills the database with
realistic-looking data using [Faker](https://faker.readthedocs.io/), so
the demo never starts out empty:

- **Properties** - 14 by default, titled from curated adjective/noun/city
  combinations (e.g. "Cozy Studio in Thessaloniki") across a dozen Greek
  locations, with a realistic nightly price, capacity, and a random subset
  of amenities.
- **Images** - 2-5 per property, deterministic `picsum.photos` URLs (free,
  no API key), with the first one flagged as the cover image.
- **Guest users** - 10 by default, usernames `guest_<n>_<fakename>`,
  emails `...@example.com`, all sharing one known password so you can log
  in as any of them while testing: **`DemoPass123!`**.
- **One demo admin** - a fixed-credential superuser, `admin_demo` /
  **`AdminPass123!`**. Being a superuser makes the existing signal
  (`accounts/signals.py`) set `Profile.role="admin"` automatically - the
  same path a real admin account goes through - so it's ready for both
  Django Admin and the app's own admin-only checks once those land.
  Idempotent: re-running the command without `--clear` leaves an existing
  `admin_demo` untouched instead of erroring on the duplicate username.
  The same password is used on the hosted Render copy (a deliberate choice
  for the demo, see "Deploying to Render").
- **Bookings** - 0-5 per property, spread from 60 days in the past to 300
  days in the future, reusing `Booking.objects.overlapping()` (the same
  helper `POST /api/bookings/` will use later) so seeded bookings never
  conflict for the same property. Past stays are mostly `confirmed` with a
  few `cancelled`; future ones are a mix of `pending`/`confirmed`/
  `cancelled`.
- **Reviews** - only generated for a guest who actually had a past,
  non-cancelled booking for that property (mirrors the real-world rule the
  API will eventually enforce), with a rating distribution skewed positive
  (mostly 4-5 stars) and realistic per-rating comment text rather than
  Faker's default lorem-ipsum, so it looks authentic in front of an
  audience.

Usage:

```bash
docker compose exec backend python manage.py seed_demo_data
```

Options:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--clear` | off | Delete previously seeded data first (reviews, bookings, images, properties, `guest_*`/`@example.com` users, and the demo admin) before re-seeding. Real accounts are never touched. |
| `--properties N` | 14 | How many properties to create |
| `--guests N` | 10 | How many guest users to create |
| `--seed N` | none | Fix the random seed for reproducible output |

The whole command runs inside one `transaction.atomic()` block, so a
failure partway through leaves the database untouched rather than
half-seeded. Verified against a throwaway SQLite DB: correct counts, every
property ends up with exactly one cover image, no overlapping
non-cancelled bookings per property, every review traces back to a real
past booking, ratings stay in range, `--clear` wipes only seeded data
(confirmed a manually-created superuser survives it), and re-running
`--clear` plus reseeding works repeatedly without errors.

## Deploying to Render

TICKET-026 puts the API (Django + Postgres) online on
[Render](https://render.com): **https://booking-demo-api.onrender.com**
(try `/api/health/` or `/api/properties/`). The whole setup is written down in
`render.yaml` (a Render **Blueprint**), so there's nothing to configure
by hand except the first click. TICKET-027 adds the Angular site:
**https://booking-demo-g4aw.onrender.com** (see "Frontend on Render" below).

### What gets created

| Resource | Name | Plan / region | Notes |
| --- | --- | --- | --- |
| Postgres 16 | `booking-demo-db` | free, Frankfurt | Same major version as `docker-compose.yml`. Render's free Postgres **expires 30 days after it's created** (then a 14-day grace period), so upgrade or recreate it after the meetup |
| Web service (Python) | `booking-demo-api` | free, Frankfurt | Frankfurt is the closest region to Greece. `rootDir: backend`. **Sleeps after 15 min without traffic**, and the first request then takes about a minute |
| Static site | `booking-demo` | free, Render's CDN | The Angular app (TICKET-027). Never sleeps |

Per deploy (every push to `master`, `autoDeployTrigger: commit`):

1. **Build** (`bash build.sh`, in `backend/`):
   - `pip install -r requirements.txt`
   - `collectstatic` → `backend/staticfiles/` (gitignored), which WhiteNoise serves
   - `migrate`. Free services have no shell, so migrations run here. The
     first one creates the `btree_gist` extension the no-double-booking
     constraint needs; Render supports it.
   - `seed_demo_data --if-empty` when `SEED_DEMO_DATA=true`: the **first**
     deploy fills the empty database with the same demo data as locally.
     Every later deploy sees properties already exist and skips it, so
     nothing is wiped or duplicated.
2. **Start:** `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`, with
   2 workers (`WEB_CONCURRENCY=2`, since the free instance has 512 MB).
   Django's `runserver` is for development only.
3. **Health check:** Render calls `/api/health/`, which round-trips through
   Postgres, before switching traffic to the new version.

### Environment variables on Render

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Filled in by Render from `booking-demo-db` (internal connection string). When set, `settings.py` uses it instead of the `POSTGRES_*` variables |
| `DJANGO_SECRET_KEY` | Generated by Render (random). It also signs the JWTs. With `DEBUG` off, the app **refuses to start** if it's missing |
| `DJANGO_DEBUG` | `false` |
| `SEED_DEMO_DATA` | `true` (only matters while the database is empty) |
| `WEB_CONCURRENCY` | `2` gunicorn workers |
| `RENDER_EXTERNAL_HOSTNAME` | Set by Render itself (e.g. `booking-demo-api.onrender.com`). Added to `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` automatically |
| `CORS_ALLOWED_ORIGINS` | `https://booking-demo-g4aw.onrender.com`, the Angular site (TICKET-027). Without it the browser blocks the site's calls to the API |

### What changes when `DJANGO_DEBUG=False`

- **HTTPS:** Render handles HTTPS (and redirects `http://` to `https://`) at
  its proxy and passes on `X-Forwarded-Proto`. With
  `SECURE_PROXY_SSL_HEADER`, Django knows the request was HTTPS, so e.g.
  pagination `next` links are `https://…`.
- **Headers and cookies:** secure cookies (Django Admin session and CSRF),
  and HSTS for an hour (`DJANGO_HSTS_SECONDS`).
- **Static files:** stored with a content hash in the name
  (`base.96c479cedf7a.css`) and compressed, so browsers can cache them
  safely. Dev and tests keep Django's plain storage, so nothing has to be
  collected first.
- **Hosts:** requests for any other host name get a `400`.
- **Error pages:** no debug pages. Server errors and their tracebacks go to
  stdout, which is Render's **Logs** tab (`LOGGING`, level
  `DJANGO_LOG_LEVEL`, default `ERROR`).
- **Health check:** it only says `"database": "error"` publicly; the real
  reason is in the logs.

Local Docker is unchanged: no `DATABASE_URL` and `DEBUG` on.

### First deploy (one time, in the browser)

1. Sign in to render.com with **GitHub**, and allow Render access to the
   `Booking-System-Demo` repo.
2. **New → Blueprint**, pick the repo (branch `master`). Render reads
   `render.yaml` and lists the database and the web service. Click
   **Apply**.
3. Wait for the database, then the build (a few minutes; the log shows
   the migrations and "Seeded 14 properties and 10 guests.").
4. Open `https://<service>.onrender.com/api/health/`. It should show
   `{"status":"ok","database":"connected"}`.

**Logins on the hosted copy:** the same demo accounts as locally
(`admin_demo@example.com` / `AdminPass123!`, guests `DemoPass123!`). The
repo is public, so anyone who reads it can log in as the admin there.
That's accepted for a demo; to lock it down later, change the password in
Django Admin on the hosted site.

### Trying the production setup locally

`build.sh` and gunicorn were run locally before the first deploy, against a
fresh Postgres database with only `DATABASE_URL`, `DJANGO_DEBUG=false`
and `RENDER_EXTERNAL_HOSTNAME` set:

- the build migrated and seeded; a second build skipped the seed
- health reported `connected`
- the Django Admin CSS came back hashed through WhiteNoise
- admin login and `/api/admin/stats/` worked
- a foreign `Host` got a `400`, and HSTS and `nosniff` headers were present

After the real deploy, the same checks passed from a browser against
https://booking-demo-api.onrender.com: health `connected`, the property
list and detail, `401` without a token on protected endpoints, no debug
404 pages, and the Django Admin login page styled.

### Tests

`backend/core/tests.py` (5 new, 103 backend tests in total):

- `--if-empty` seeds an empty database and leaves an existing one
  untouched
- the health check reports `connected`; it shows the database error in
  DEBUG, but in production only says `error` and logs the details

## Frontend on Render

TICKET-027 serves the Angular app as a free Render **static site**,
`booking-demo` in `render.yaml` → **https://booking-demo-g4aw.onrender.com**.
Render added the `-g4aw` suffix because another user already had
`booking-demo.onrender.com`. If the site is ever recreated and gets a new
address, update `CORS_ALLOWED_ORIGINS` in `render.yaml` to match.
It talks to the API at https://booking-demo-api.onrender.com.

### Build

- `rootDir: frontend`, `buildCommand: npm ci && npx ng build`, publish
  `dist/frontend/browser`, Node 22 (`NODE_VERSION`, the same as the Docker
  image).
- `npm ci` installs exactly what `frontend/package-lock.json` pins, the
  same versions the tests ran against.
- `ng build` uses the **production** configuration: `angular.json`'s
  `fileReplacements` swaps `environment.ts` for `environment.production.ts`.
  That file has `apiUrl: 'https://booking-demo-api.onrender.com/api'` and
  turns the waking-up notice on. `ng serve` and Docker keep
  `localhost:8000`. The built bundle was checked: it contains the Render
  URL and no `localhost:8000`.

### Routing and headers

- **Deep links:** a rewrite sends every path to `/index.html`, so
  reloading `/listings/42` or `/admin/bookings` works and Angular's router
  takes over. Real files (JS chunks, `favicon.ico`) are served as they
  are, because Render never rewrites a path that exists.
- **Headers:** `X-Frame-Options: DENY` (the site can't be embedded in
  other sites), `X-Content-Type-Options: nosniff`, and
  `Referrer-Policy: strict-origin-when-cross-origin`.

### CORS

The site and the API are on different origins, so the API must allow the
site. `CORS_ALLOWED_ORIGINS=https://booking-demo-g4aw.onrender.com` is set on
the API in `render.yaml`. Requests carry the JWT in the `Authorization`
header, which makes the browser send a preflight `OPTIONS` first;
`django-cors-headers` answers it. No cookies are involved.

### "Waking up the demo server" notice

The free API sleeps after 15 idle minutes, and the first request then
takes ~50 s. Instead of a page that looks frozen:

- `serverWakeInterceptor` (`core/server-wake.ts`) watches **our API's**
  requests only. If one has had no answer for **4 s**
  (`wakeNoticeAfterMs`), `ServerWakeService.slow` turns on.
- `layout/wake-notice` then shows a slim amber banner under the toolbar:
  "Waking up the demo server - this can take up to a minute on the free
  plan." It uses a live region, so screen readers announce it too.
- It disappears as soon as the server answers anything (an error status
  also proves it's awake), or when nothing is waiting any more. "No answer
  at all" (status 0) doesn't count as awake.
- Dev has `wakeNoticeAfterMs: null`, so it's off locally.
- **App start:** `AuthService.init()` used to wait for `/auth/me/` before
  the first render, which on a sleeping server meant up to a minute of
  blank page for returning logged-in users. It now waits at most
  **3 s** (`INIT_MAX_WAIT_MS`), then renders with the cached user while
  the check finishes in the background, so the banner can show. This
  doesn't weaken security: the server still checks every request, and
  `adminGuard` re-reads `/me/` itself.

### Checked live

In Chrome on https://booking-demo-g4aw.onrender.com:

- 13 stays load from the live API, with photos
- the footer says "API & database connected"
- `/listings/14` opens directly (the rewrite works)
- `/admin/bookings` while logged out goes to the login page
- all three security headers are present

Before the CORS setting reached the API, the page showed "Can't reach the
server", which is exactly what a wrong or missing `CORS_ALLOWED_ORIGINS`
looks like. The waking-up banner can only be seen after the API has been
idle for 15 minutes.

### Tests

167 frontend tests (8 new):

- **Wake service + interceptor** (fake timers):
  - slow only after the delay, and cleared by the answer
  - a quick answer never shows it
  - an HTTP error clears it, but status 0 doesn't
  - a cancelled request clears it
  - off when the delay is `null`
  - other hosts are ignored
- **Banner:** hidden → shown after 4 s → hidden on answer; the live region
  is always present.
- **`AuthService.init()`:** with `/me/` hanging, it resolves after 3 s with
  the cached user, and the late answer still updates it.

## Environment variables

Real values already live in `.env` (gitignored, working local-dev
defaults). `.env.example` is the committed template - copy it to `.env` if
you ever need to regenerate it.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | backend | Django's cryptographic signing key |
| `DJANGO_DEBUG` | backend | Debug mode (verbose error pages) |
| `DJANGO_ALLOWED_HOSTS` | backend | Hostnames Django will respond to |
| `CORS_ALLOWED_ORIGINS` | backend | Origins allowed to call the API (the Angular dev server) |
| `DATABASE_URL` | backend (Render) | One connection string; when set it replaces the `POSTGRES_*` variables. See "Deploying to Render" |
| `CSRF_TRUSTED_ORIGINS` | backend | Optional extra `https://…` origins for Django Admin's login form (Render's own hostname is added automatically) |
| `SEED_DEMO_DATA` / `WEB_CONCURRENCY` / `DJANGO_LOG_LEVEL` / `DJANGO_HSTS_SECONDS` | backend (Render) | First-deploy seed, gunicorn workers, log level (default `ERROR`), HSTS seconds (default 3600) |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` | backend | Optional token lifetimes (defaults 30 minutes / 1 day) |
| `BOOKING_CHECK_IN_TIME` / `BOOKING_GUEST_CANCELLATION_HOURS` | backend | Optional: check-in time used for the guest cancellation deadline, and how many hours before it guests can still cancel (defaults `15:00` / `48`) |
| `POSTGRES_DB/USER/PASSWORD` | db, backend, pgadmin | Database name and credentials |
| `PGADMIN_DEFAULT_EMAIL/PASSWORD` | pgadmin | Login for the pgAdmin web UI itself |

## Using pgAdmin

1. Open http://localhost:5050 and log in with `PGADMIN_DEFAULT_EMAIL` /
   `PGADMIN_DEFAULT_PASSWORD` from `.env`.
2. Right-click **Servers** -> **Register** -> **Server**.
3. **General tab**: Name can be anything (e.g. `booking-demo`) - it's just
   a label, not used for the connection.
4. **Connection tab** (this is the part that trips people up - the values
   here are *not* the same as the name you just chose):
   - Host name/address: **`db`** (the Docker service name - not
     `localhost`, and not whatever you typed in the Name field)
   - Port: `5432`
   - Maintenance database: `booking_demo`
   - Username: `booking_demo` (from `POSTGRES_USER` - not `admin` or
     the pgAdmin login email)
   - Password: from `POSTGRES_PASSWORD` in `.env`
5. Save. You should see the `booking_demo` database with its tables -
   Django's built-ins (`auth_user`, `auth_group`, `django_migrations`,
   `django_session`, etc.) plus app-specific tables as they're added
   (e.g. `listings_property` - see "Data model" above), all created
   automatically by the `migrate` step that runs when the backend
   container boots.

pgAdmin's own settings (including this server registration) are stored in
a named Docker volume (`pgadmin_data`), so they survive `docker compose
down` / `up` - only `docker compose down -v` wipes them.

## Troubleshooting

- **pgAdmin: "failed to resolve host"** - you put the connection's display
  name (or `localhost`) in the Host field instead of `db`. See the pgAdmin
  section above.
- **Frontend doesn't hot-reload on file changes**: can happen with Windows
  bind mounts into a Linux container. The frontend container already runs
  `ng serve` with `--poll 1000` to cover this; if it's still not picking
  up changes, try increasing the poll interval or restarting the
  `frontend` container.
- **`backend` keeps restarting on first boot**: check `docker compose logs
  backend` - usually means Postgres wasn't ready yet or a migration
  failed. `depends_on` + the Postgres healthcheck should prevent the first
  case; if you see it anyway, share the log output and it can be fixed.
- **After pulling new code: `ModuleNotFoundError`, or the backend won't
  start**: a ticket added a Python package (e.g. `djangorestframework-simplejwt`
  in TICKET-012, or gunicorn + whitenoise in TICKET-026). Rebuild the image
  with `docker compose up -d --build backend`.
- **After pulling new code: "relation/column does not exist"**: a ticket
  added a migration (e.g. TICKET-015's `bookings/0002`). The container runs
  `migrate` only when it starts, and hot reload doesn't. Either restart it
  (`docker compose restart backend`) or run
  `docker compose exec backend python manage.py migrate`.
- **Ports already in use**: something else on your machine is using 4200,
  8000, 5432, or 5050. Either stop it or change the left-hand side of the
  port mapping in `docker-compose.yml` (e.g. `"4300:4200"`).

## Next steps (per the build plan)

Epic 1 (the data layer) is complete: all five models, migrations, Django
Admin registration, and the Faker seed script (see "Seeding demo data"
above) are all in place and verified. Epic 2 is under way: JWT auth
(TICKET-012), the admin permission classes (TICKET-014) and the
Properties API (TICKET-013) and the Bookings API with its double-booking
guarantees (TICKET-015) and the admin stats endpoint (TICKET-016) are
done, so **Epic 2 (the backend API) is complete**. On the frontend,
TICKET-017 (login/register, `AuthService`, the JWT interceptor with
refresh-on-401, and a minimal toolbar) and TICKET-018 (the listings page:
URL-driven search, filters, cards, paginator) are done; see "Frontend
auth" and "Listings page"; and TICKET-019 (the property detail page:
gallery, amenities, availability calendar, live availability check,
Book now) and TICKET-020 (the two-step booking form with confirmation
screen) and TICKET-021 (My Bookings with tabs and cancelling) are done
too; see "Property detail page", "Booking form" and "My Bookings page".
**Epic 3 (the customer experience) is complete.** The admin area has
started: TICKET-022 (the `/admin` shell with side nav, `adminGuard` + 403
page, role-aware navbar with account menu) and TICKET-023 (the admin
dashboard: period presets, stat cards with changes vs the previous period,
per-property breakdown) and TICKET-024 (the properties table + create/edit
form with amenities checklist and drag & drop photos) and TICKET-025
(every guest's bookings with tabs, filters, confirm/cancel and a pending
badge) are done; see "Admin area", "Admin dashboard", "Admin properties"
and "Admin bookings". **Epic 4 (the admin area) is complete.** Hosting
has started: TICKET-026 (the API + Postgres on Render from `render.yaml`)
is live at https://booking-demo-api.onrender.com, and TICKET-027 adds the
Angular site at https://booking-demo-g4aw.onrender.com; see "Deploying to Render"
and "Frontend on Render". Next up: the pre-demo hosted-URL check
(TICKET-028).
