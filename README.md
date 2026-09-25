# Booking System Demo

Django + Angular booking/property-management demo, running side by side in
Docker with a Postgres database. See `Booking System Demo - Build Plan.md`
for the full project plan (models, API design, day-by-day schedule).

**Status:** Epic 1 (the data layer) is complete - all five models
(`Property`, `PropertyImage`, `Profile`, `Booking`, `Review`), migrations,
Django Admin registration, and a Faker seed script for realistic demo data
are all in place and verified. Epic 2 (the DRF API) is under way: JWT
authentication (register, login, refresh, "who am I"), the shared admin
permission classes, and the Properties API (filtered, paginated list,
detail with availability, admin-only create/edit/soft-delete) and the
Bookings API (race-proof booking creation, locked status changes) are done.
See "Authentication (JWT)", "Permissions", "Properties API" and
"Bookings API". See "Next
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
   URL comes from `frontend/src/environments/environment.ts`).
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
  Dockerfile           Python 3.12 image; runs migrate then runserver on boot
  requirements.txt     Django, DRF, simplejwt, django-cors-headers, django-environ, psycopg2, Faker
  manage.py
  config/              Django project settings
    settings.py        Reads DB/secret/CORS/JWT config from env vars; JWT is the API's default auth
    urls.py            admin/ -> Django admin, api/ -> core.urls + listings.urls, api/auth/ -> accounts.urls
    wsgi.py / asgi.py
  core/                Small app - currently just the health-check endpoint
    views.py           GET /api/health/ - queries Postgres, returns status
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
    views.py           BookingViewSet - /api/bookings/ (own vs all, 409 on overlap, locked status changes)
    urls.py            Router for /api/bookings/
    tests.py           API + DB-constraint + real concurrency tests (Postgres)
    migrations/        0001_initial.py creates the bookings table; 0002 adds guests + btree_gist + no-overlap constraint
  reviews/             A guest's rating/comment on a Property (nice-to-have)
    models.py          Review model (rating 1-5, one review per guest per property)
    admin.py           Filterable/searchable Review list (dev-only DB inspection)
    migrations/        0001_initial.py creates the reviews table

frontend/
  Dockerfile           Node 22 image; runs `ng serve --host 0.0.0.0 --poll 1000`
  src/environments/environment.ts   apiUrl the frontend calls the backend at
  src/app/
    app.ts / app.html / app.config.ts   Root shell + providers (HttpClient, animations, router)
    core/api-health.service.ts          Wraps the /api/health/ call
    api-status/                         Card component showing connectivity status

docker-compose.yml   Wires the four services together
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
| `status` | `pending` / `confirmed` / `cancelled` | Filter by status |
| `property` | property id | **Admin only**, ignored for guests |

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

`backend/bookings/tests.py` has 29 tests. They **must run on Postgres**,
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
  filter, `property` filter is admin-only, `can_cancel`, and `405` for
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
  in TICKET-012). Rebuild the image with `docker compose up --build backend`.
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
guarantees (TICKET-015) are done. Next up: the admin stats endpoint
(TICKET-016), which completes Epic 2. On the frontend, TICKET-017 (auth),
TICKET-018 (listings grid + filters) and then TICKET-020/021 (booking
form, My Bookings) can now be built against these endpoints.
