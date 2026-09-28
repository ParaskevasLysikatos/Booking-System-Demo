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
API", "Admin stats API" and "Admin bookings". Guests now **pay online
with Stripe (test mode)** - Confirm and pay, a 30-minute date hold, the
webhook confirming bookings, Pay now, refunds flagged for the host
(TICKET-029, tested end to end locally and on Render); see "Payments
(Stripe)". The site works on phones and tablets and can be installed
as an app (TICKET-031, see "Mobile & PWA"). Guests who have stayed can
**rate and review** a place, everyone sees the reviews with a star
summary, and admins can hide a review (TICKET-032, see "Reviews API",
"Property detail page → Reviews section" and "Admin reviews"). Guests can
**save places** with a heart (TICKET-033, done): the API is done - logged-in guests save and
remove places, every card knows whether the caller saved it, and admins
see how many accounts saved each place (see "Favorites API") - and every
listing card and the property page have a **heart** to save a place
(logged out, it goes through login and saves afterwards; see "Favorites:
the heart") - and a **Saved** page (`/favorites`) lists them, with Undo,
and places that were deactivated greyed out (see "Saved page"). Admins see
how many guests saved each place ("Saved by" in admin Properties).
**TICKET-034 (map view) is in progress:** step 1 is done - every property
can have a map position (exact for admins; everyone else only gets a
~500 m area), existing and seeded places get one near their city; see
"Map positions API (TICKET-034)"; step 2 is done - `GET
/api/properties/map/` returns every matching stay as a map pin; see "Map
pins API (TICKET-034)"; step 3 is done - admins can look up an address in
Greece (`GET /api/admin/geocode/`) to place a pin; see "Admin place search
API (TICKET-034)"; step 4 is done - the shared map component
(`<app-map>`: Leaflet with a softened OpenStreetMap map, price tags,
numbered bubbles for nearby stays, approximate-area circles, pop-ups),
loaded only when a page shows a map; see "Shared map component"; step 5 is
done - `/listings` shows the list and a map side by side on wide screens
(a Show map / Show list button on phones), with a pop-up card per price
tag; see "Listings map". See "Next steps" at the bottom for
what's next.

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

Services: `db` (Postgres), `backend` (Django, :8000), `frontend` (Angular,
:4200), `pgadmin` (:5050), `mailpit` (catches the app's emails - read them
at http://localhost:8025; see "Emails") and `stripe-cli` (forwards Stripe's test-mode
webhooks to the backend - only active when `STRIPE_CLI_API_KEY` is set; see
"Payments (Stripe)" → "Local webhook forwarding").

## How it fits together

Four containers, defined in `docker-compose.yml`:

| Service | Image / build | Port (host) | Role |
| --- | --- | --- | --- |
| `frontend` | built from `frontend/Dockerfile` (Node 22) | 4200 | Angular dev server (`ng serve`) |
| `backend` | built from `backend/Dockerfile` (Python 3.12) | 8000 | Django + DRF dev server |
| `db` | `postgres:16-alpine` | 5432 | The actual database |
| `pgadmin` | `dpage/pgadmin4` | 5050 | Web GUI for browsing `db` |
| `mailpit` | `axllent/mailpit` | 8025 | Catches every email the backend sends locally (TICKET-030) |

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
    models.py          Property + PropertyImage models (Property has optional latitude/longitude, TICKET-034)
    geo.py             Map helpers: the approximate point guests see, the demo city centres (TICKET-034)
    serializers.py     List (card) + detail (images, availability; also the admin write serializer, nested images)
    filters.py         Query-param validation + filtering (location, guests, price, dates, ordering)
    views.py           PropertyViewSet - /api/properties/ (public read, admin write, soft delete) + /map/ pins,
                       GeocodeView - /api/admin/geocode/ (TICKET-034)
    geocoding.py       "Find on map" place search: OpenStreetMap Nominatim, Greece only, cached, 1 request/s (TICKET-034)
    queries.py         property_cards() - the annotated queryset (rating, is_favorite, admin favorite_count)
                       shared by the properties API and the Saved list (TICKET-033)
    urls.py            Router for /api/properties/
    tests.py           API tests for the Properties endpoints
    admin.py           Registers both in Django Admin, images inline on the Property page (dev-only DB inspection, see Epic 4 for the real admin UI)
    migrations/        0001_initial.py (Property), 0002_propertyimage.py (PropertyImage),
                       0003_property_coordinates.py + 0004_backfill_coordinates.py (map positions, TICKET-034)
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
  reviews/             A guest's rating/comment on a Property - see "Reviews API (TICKET-032)"
    models.py          Review model (rating 1-5, one per guest per property, is_hidden) + has_finished_stay() (the review rule)
    serializers.py     Public review, create (rule checks), the caller's own review, admin row + filters
    views.py           GET /api/properties/{id}/reviews/ (+ summary), POST /api/reviews/, /api/admin/reviews/ (list, hide/unhide)
    urls.py            The three routes above
    admin.py           Filterable/searchable Review list (dev-only DB inspection)
    tests.py           Rule, public list, create, viewer/booking fields and admin tests
    migrations/        0001_initial.py creates the reviews table; 0002 adds is_hidden
  favorites/           Places a user has saved ("hearted") - see "Favorites API (TICKET-033)"
    models.py          Favorite model (user, property, created_at; one per user per property)
    serializers.py     SavedPropertySerializer - a listings card + saved_at
    views.py           GET /api/favorites/ (my saved places), PUT/DELETE /api/favorites/{property_id}/
    urls.py            The two routes above
    admin.py           Searchable Favorite list (dev-only DB inspection)
    tests.py           Save/remove, the Saved list, is_favorite / favorite_count on properties
    migrations/        0001_initial.py creates the favorites table
  payments/            Stripe test-mode Checkout for bookings (TICKET-029)
    models.py          Payment (one per booking: Checkout Session, amount, status, hold expiry) + StripeEvent (webhook de-dup)
    services.py        start_hold() at booking time; start_checkout() - idempotent Checkout Session creation
    views.py + urls.py POST /api/payments/stripe/webhook/ - signature check, event de-dup
    webhooks.py        What each Stripe event does (paid -> confirmed, expired/failed -> cancelled, ...)
    stripe_client.py   The one StripeClient (pinned API version); payments_enabled(); webhook_secret()
    management/commands/release_stale_holds.py   Settle holds whose webhook was missed (asks Stripe first)
    serializers.py     The `payment` block in booking responses (incl. can_pay)
    checks.py          Startup checks for the Stripe settings (live keys refused, hold length, missing webhook secret)
    admin.py           Read-only Payment / StripeEvent lists (dev-only DB inspection)
    tests.py           Model, settings-check, hold, checkout and webhook tests (Stripe mocked, real signatures)
    migrations/        0001 creates the payments and stripe events tables; 0002 makes the session optional until checkout; 0003 adds the `cancelled` payment status
    (views.py also serves GET /api/payments/config/ - public: enabled, hold minutes, currency)
  notifications/       Booking emails (TICKET-030) - see "Emails"
    models.py          BookingEmail - the outbox: one row per (booking, kind), status pending/sending/sent/failed/skipped
    outbox.py          enqueue() inside the booking's transaction; send_email() after commit (claim -> send -> record)
    messages.py        Builds each email (subject, text + HTML) for a row: email_context(), money/date formatting
    templates/notifications/emails/   <kind>.html (extends base.html) + <kind>.txt for the 4 emails, shared _pieces
    backends.py        GmailApiEmailBackend - Django email backend for the Gmail API (OAuth refresh token, stdlib only)
    checks.py          Startup warnings for the email settings (never errors)
    admin.py           Read-only outbox list with a "Retry sending" action + an inline on the Booking admin page
    management/commands/send_pending_emails.py   Send pending / failed / stuck emails (--max-attempts, --dry-run)
    management/commands/gmail_authorize.py       One-time: get GMAIL_REFRESH_TOKEN (sign in with Google, paste the address back)
    management/commands/send_test_email.py       Send one test email through the configured provider
    tests.py           Gmail API backend + commands, settings checks, outbox, email flow and retry tests
    migrations/        0001 creates the booking emails table; 0002 adds the cancel reason

frontend/
  Dockerfile           Node 22 image; runs `ng serve --host 0.0.0.0 --poll 1000`
  src/environments/environment.ts   apiUrl the frontend calls the backend at (dev: localhost:8000)
  src/environments/environment.production.ts   Same for `ng build` (Render API URL, waking-up notice on)
  package-lock.json                 Exact package versions; Render builds with `npm ci`
  src/app/
    app.ts / app.html / app.config.ts   Root shell (toolbar + router outlet) + providers (HttpClient + auth interceptor, router, session restore)
    app.routes.ts                       / -> /listings, /listings, /listings/:id, /booking/:propertyId + /my-bookings + /favorites (authGuard),
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
    core/payments/                      PaymentService (config, checkout), payment models + labels, countdown clock,
                                        BrowserRedirect (to Stripe) - TICKET-029
    core/admin/                         AdminStatsService (/api/admin/stats/), periods.ts (presets, comparison period, deltas),
                                        AdminPropertiesService (list all / create / update / retire / reactivate),
                                        AdminBadgesService (pending-bookings count for the side nav)
    core/unsaved-changes.guard.ts       canDeactivate "Discard unsaved changes?" for forms
    shared/confirm-dialog.ts            Generic confirm dialog (danger variant)
    shared/booking-summary.ts           Booking summary card after booking (confirmation + paid screens)
    shared/star-rating.ts               Read-only ★★★★½ stars (one labelled image for screen readers) - TICKET-032
    shared/favorite-button.ts           The heart: a toggle button (overlay on card photos, or "Save/Saved" in a header) - TICKET-033
    shared/map/                         The map used everywhere (Leaflet + softened OpenStreetMap, price tags, clusters, areas, pop-ups), lazy-loaded - TICKET-034
    core/favorites/                     FavoriteService: save/remove, the heart state per place, logged-out -> login -> save - TICKET-033
    core/reviews/                       ReviewService (a property's reviews page by page) + review models - TICKET-032
    layout/toolbar/                     Role-aware top bar: Log in / Sign up, or Saved (guests) + My bookings (+ Admin) and an account menu
    layout/footer/                      Footer with the API/database connectivity dot
    layout/wake-notice/                 "Waking up the demo server" banner under the toolbar (production only)
    pages/listings/                     Listings page: URL-driven search, filters, grid, paginator (+ property-card/);
                                        map split view / ?view=map + map-popup-card/ (TICKET-034)
    pages/property-detail/              Detail page: gallery (+ full-screen lightbox), amenities, availability
                                        calendar, sticky booking panel with live availability + Book now,
                                        reviews/ (star summary + reviews, Show more - TICKET-032)
    pages/booking/                      Booking form: 2-step stepper (trip -> review & confirm), live price,
                                        409/400 handling, confirmation screen
    pages/favorites/                    Saved page (/favorites): the guest's saved places, Undo, deactivated places greyed out - TICKET-033
    pages/my-bookings/                  My Bookings: Upcoming/Past/Cancelled tabs (URL), booking cards, cancel dialog,
                                        payment line per card (countdown + Pay now, paid, refund)
    pages/payment-return/               /bookings/:id/payment - back from Stripe: confirming (polling), confirmed,
                                        processing, not completed (countdown, Pay now, Cancel), time ran out
    pages/admin/                        Admin shell (side nav), dashboard/ (stat cards + breakdown table),
                                        properties/ (table + form with amenities picker and drag-drop photos),
                                        bookings/ (every guest's bookings: tabs, filters, confirm/cancel),
                                        reviews/ (every review: filters, Hide / Show again - TICKET-032)
    pages/forbidden/                    403 "Admins only" page
    pages/login/, pages/register/       Auth forms (Angular Material)
    testing/fake-jwt.ts                 Test helper that builds JWT-shaped tokens
  src/styles/_responsive.scss         Shared breakpoints (phone ≤ 600, tablet ≤ 960) + table-cards mixin (TICKET-031)
  src/app/core/pwa/                   InstallService ("Install app": browser prompt or iOS steps) + the iOS steps dialog (TICKET-031)
  public/manifest.webmanifest         Web app manifest (installable app, no service worker) + public/icons/ (TICKET-031)

docker-compose.yml   Wires the four services together
scripts/hosted-check.sh           Wakes the hosted demo and smoke-checks it (TICKET-028)
.github/workflows/hosted-check.yml  "Hosted demo check" - runs that script from a Run workflow button
scripts/keep-awake.sh             Pings the API every 10 minutes for N minutes, so it doesn't fall asleep
.github/workflows/keep-awake.yml  "Keep demo awake" - the check, then 3 h (1-5 h) of keep-alive pings; started by hand
docs/booking-demo-qr.png          QR code of the hosted site, for the meetup
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
| `latitude` / `longitude` | `DecimalField(9, 6)`, nullable | Map position (TICKET-034). Optional; **both or neither**, latitude -90..90, longitude -180..180 - checked in `clean()` and by three DB `CheckConstraint`s. Exact values are admin-only, see "Map positions API (TICKET-034)" |
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
`unique_review_per_guest_per_property`) - no duplicates (and since
TICKET-032 reviews are final: no editing either). Verified against a throwaway SQLite
DB: valid reviews from different guests, both out-of-range ratings and
duplicate (property, guest) pairs rejected at the application level, and
both DB constraints rejecting the same bypassing a bulk `.create()`.

Registered in Django Admin with a filterable/searchable list (by rating).

TICKET-032 added `is_hidden` (`BooleanField`, default `False`, migration
`0002_review_is_hidden`) so an admin can hide a review without deleting
it, and `Review.objects.visible()` for the public side. See "Reviews API
(TICKET-032)".

**`Favorite`** (new `favorites` app, `favorites/models.py`, TICKET-033) - a
property a user has saved:

| Field | Type | Notes |
| --- | --- | --- |
| `user` | `ForeignKey -> User` | `related_name="favorites"`, `on_delete=CASCADE` |
| `property` | `ForeignKey -> Property` | `related_name="favorites"`, `on_delete=CASCADE` (safe: properties are only soft-deleted) |
| `created_at` | `DateTimeField` | Auto-managed; shown as `saved_at` |

One favorite per user per property (DB `UniqueConstraint`
`unique_favorite_per_user_per_property`). Deactivating a property keeps
its favorites. Registered in Django Admin (searchable by user and
property). Migration: `favorites/migrations/0001_initial.py`. See
"Favorites API (TICKET-033)".

Domain models live in their own apps rather than in `core` (which stays
infrastructure-only): `listings` holds `Property`/`PropertyImage`,
`accounts` holds `Profile`, `bookings` holds `Booking`, `reviews` holds
`Review`. That's the complete Data Models table from the build plan.

Migrations: `listings/migrations/0001_initial.py` creates `Property`,
`0002_propertyimage.py` creates `PropertyImage`,
`0003_property_coordinates.py` adds `latitude`/`longitude` and
`0004_backfill_coordinates.py` gives existing places a position (TICKET-034),
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
| `GET /api/properties/map/` | anyone | Every matching stay as a map pin, not paginated (TICKET-034, see "Map pins API") |

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
   "rating_avg": 3.0, "review_count": 1, "is_favorite": false}]}
```

`is_favorite` (TICKET-033) says whether the **caller** has saved the
property (always `false` when logged out). Admins also get
`favorite_count` - how many accounts saved it - on the list and the
detail; guests never see it. Both are part of the same SQL query (see
"Favorites API").

`rating_avg` (1 decimal, `null` with no reviews) and `review_count` are SQL
annotations that skip reviews an admin has hidden (TICKET-032), and images are prefetched. The whole list page costs a fixed
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

It also has a `viewer_review` block, `{"can_review": ..., "my_review": ...}`,
for the caller (TICKET-032, see "Reviews API"), and `is_favorite` (plus
`favorite_count` for admins, TICKET-033).

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
| `POST /api/bookings/{id}/checkout/` | Stripe payment page for their own booking (TICKET-029, see "Payments (Stripe)") | Same - only for their *own* bookings |
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
- `status` always starts as **`pending`**. With payments on, the Stripe
  webhook confirms it once the money has arrived (TICKET-029) and the
  booking starts a 30-minute **payment hold** in the same transaction;
  without payments an admin confirms it.
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
 "cancel_deadline": "2026-10-31T15:00:00+02:00",
 "payment": {"status": "open", "amount": "320.00", "currency": "eur",
             "expires_at": "2026-10-01T18:32:00+03:00", "paid_at": null, "can_pay": true},
 "can_review": false, "my_review": null,
 "guest_email": null, "created_at": "..."}
```

`payment` is `null` for a booking that doesn't take online payment
(seeded, or booked while payments were off) - see "Payments (Stripe)".

`can_review` / `my_review` drive the "Leave a review" button (TICKET-032,
see "Reviews API").

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

**Admins have no deadline.** An admin can cancel a `pending` or
`confirmed` booking at any time - before the guest deadline, after it,
after check-in, even after the stay - and confirm a `pending` one at any
time. The only thing an admin can never do is change a **cancelled**
booking (cancelled is final for everyone). The only moments an admin's
change is *held back* are the payment-safety cases below: each is
temporary (retry in a moment, or once the bank has finished), and each
exists so that nobody - admin included - can accidentally leave a guest
paying for a booking that no longer exists.

**Refunds are not automatic yet.** Since TICKET-029 guests pay online, but
cancelling a *paid* booking (guest or admin) only cancels it: the payment
stays `paid`, and the money goes back with TICKET-040 (refunds), which
builds on this deadline.

#### Every case at a glance (guest vs admin, with online payments)

"✓" = allowed (`200`). The payment column says what happens to the
booking's online payment, if it has one (see "Payments (Stripe)").

| Booking's situation | Guest cancels (own booking) | Admin cancels | Admin confirms (`pending` only) | What happens to the payment |
| --- | --- | --- | --- | --- |
| `pending`, no online payment (seeded, or booked while payments were off) | ✓ until the deadline | ✓ any time | ✓ any time | - (there is none) |
| `pending`, awaiting payment, guest never opened the payment page | ✓ until the deadline | ✓ any time | ✓ any time (payment waived) | `cancelled`; no Stripe call needed |
| `pending`, **payment page open** at Stripe | ✓ until the deadline | ✓ any time | ✓ any time (payment waived) | the page is **closed at Stripe first**, then `cancelled`; Stripe's later "expired" event changes nothing |
| `pending`, the guest **paid a moment ago** (page already completed) | `409` `payment_completed` | `409` `payment_completed` | `409` `payment_completed` | recorded as `paid` on the spot and the booking is now `confirmed`; the same cancel then works (next row) |
| `confirmed` and **paid** online | ✓ until the deadline | ✓ any time | - | stays `paid` → refund in TICKET-040 |
| `confirmed` without an online payment (confirmed by hand, or seeded) | ✓ until the deadline | ✓ any time | - | nothing to do: it was already `cancelled` (waived) when the admin confirmed, or there is none |
| a **delayed payment is processing** at the bank (e.g. SEPA) | `409` `payment_processing` (`can_cancel: false`) | `409` `payment_processing` | `409` `payment_processing` | wait: the bank's result arrives by webhook (paid → confirmed, failed → cancelled) |
| **Stripe unreachable** while a payment page is open | `502` `payment_provider_error` | `502` `payment_provider_error` | `502` `payment_provider_error` | untouched - the page might still take money; retry |
| the guest **opened the payment page during** the cancel | `409` `checkout_just_opened` | `409` `checkout_just_opened` | `409` `checkout_just_opened` | untouched; retry closes the new page |
| payments were **switched off** after a page was opened | ✓ until the deadline | ✓ any time | ✓ any time | `cancelled` (Stripe can't be reached at all; logged) |
| **after the guest deadline** (48h before 15:00 on check-in day) | `400` "Online cancellation closed on …" | ✓ any time | ✓ any time | as in the rows above |
| after check-in, or the stay is over | `400` (deadline passed) | ✓ | ✓ | as in the rows above |
| already **cancelled** | `400` (final) | `400` (final) | `400` (final) | - |
| someone else's booking | `404` (guests only see their own) | ✓ (admins see all) | ✓ | - |

The order inside a `PATCH` is always: (1) check the transition is allowed
at all (without a lock, so a refused change never contacts Stripe); (2)
close an open payment page at Stripe (a network call, outside the lock);
(3) under the row lock, re-check the transition, mark the payment
`cancelled`, change the booking. Details in "Payments (Stripe)" →
"Cancelling or confirming by hand while a payment page is open".

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

## Reviews API (TICKET-032)

Guests rate a place 1-5 stars (with an optional comment) after they've
stayed there; everyone can read the reviews under a property; admins can
hide a review. Code: `backend/reviews/` (`models.py`, `serializers.py`,
`views.py`, `urls.py`, `tests.py`).

### Business rules

| Rule | How it's enforced |
| --- | --- |
| **Who can review:** a logged-in guest with a **confirmed** booking at that property whose **check-out date has arrived** (check-out today counts) | `reviews.models.has_finished_stay()`, checked in `ReviewCreateSerializer.validate()`. Pending (unpaid), cancelled, future and in-progress stays never count. |
| **One review per guest per property** | Checked in `validate()`; the DB `UniqueConstraint` (from TICKET-009) is the backstop - two quick submits that both pass validation get a `400`, never a `500` (the `IntegrityError` is caught). |
| **Reviews are final** | There is no edit or delete: `/api/reviews/` only accepts `POST`. A guest with several stays at the same place still has one review. |
| **Rating 1-5, comment optional (max 1,000 characters)** | Serializer validation (the DB `CheckConstraint` is the backstop for the rating). The comment is trimmed. |
| **Only active properties** | Reviewing a retired property is a `400`; its reviews list is a `404` for everyone but admins (same as the property page). |
| **Admins hide, not delete** | `Review.is_hidden` (migration `0002_review_is_hidden`). A hidden review disappears from the public list **and** from `rating_avg`/`review_count` everywhere (cards, detail, admin properties table). The guest still can't post a second one, and still sees their own rating. Unhide puts it back. |
| **Privacy** | Reviewers are shown as first name + last initial (`Maria K.`), or `Guest` without a first name. Emails appear only in the admin list. |

### Endpoints

| Method | URL | Who | What |
| --- | --- | --- | --- |
| `GET` | `/api/properties/{id}/reviews/` | anyone | Visible reviews, newest first, **5 per page** (`?page=`, `?page_size=` up to 50), plus a `summary` over all visible reviews |
| `POST` | `/api/reviews/` | logged in | `{property, rating, comment?}` → `201` with the review; `400` if not allowed |
| `GET` | `/api/admin/reviews/` | admin | Every review incl. hidden, newest first, 12 per page. Filters: `?rating=1-5`, `?property=<id>`, `?hidden=true\|false`, `?search=` (property title, guest email/name, comment) |
| `PATCH` | `/api/admin/reviews/{id}/` | admin | `{"is_hidden": true\|false}` - the only writable field (anything else is ignored). No `PUT`/`DELETE` (`405`). |

Public list response:

```json
{
  "count": 7, "next": ".../reviews/?page=2", "previous": null,
  "results": [
    {"id": 41, "rating": 5, "comment": "Spotless and central.", "author_name": "Maria K.",
     "created_at": "2026-09-20T10:12:00Z"}
  ],
  "summary": {
    "rating_avg": 4.3, "review_count": 7,
    "breakdown": [{"rating": 5, "count": 4}, {"rating": 4, "count": 1}, {"rating": 3, "count": 2},
                  {"rating": 2, "count": 0}, {"rating": 1, "count": 0}]
  }
}
```

Errors from `POST /api/reviews/` (shown by the frontend as the form's
general message):

- `"You can review a place once a confirmed stay there has ended."`
- `"You've already reviewed this place."`

### What the frontend uses to show the buttons

So the frontend never re-implements the rule, two existing responses gained
fields (both computed for the **caller**):

- **Property detail** (`GET /api/properties/{id}/`) - `viewer_review`:
  `{"can_review": true|false, "my_review": {id, rating, comment, created_at} | null}`.
  Anonymous callers always get `false` / `null`.
- **Each booking** (`GET /api/bookings/`) - `can_review` (this is my
  booking, it's confirmed, check-out has arrived, and I haven't reviewed
  the place) and `my_review` (my review of that property, from any of my
  stays there). An admin looking at someone else's booking gets `false` /
  `null`. The caller's reviews are loaded **once per response** (one extra
  query, not one per row) - a test checks the query count doesn't grow with
  the number of bookings.

### Try it with curl

```bash
# Anyone: the reviews under property 1
curl http://localhost:8000/api/properties/1/reviews/

# A guest with an ended, confirmed stay at property 1
curl -X POST http://localhost:8000/api/reviews/ \
  -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
  -d '{"property": 1, "rating": 5, "comment": "Lovely view"}'

# Admin: hidden reviews only, then hide review 41
curl "http://localhost:8000/api/admin/reviews/?hidden=true" -H "Authorization: Bearer $ADMIN_ACCESS"
curl -X PATCH http://localhost:8000/api/admin/reviews/41/ \
  -H "Authorization: Bearer $ADMIN_ACCESS" -H "Content-Type: application/json" -d '{"is_hidden": true}'
```

### Tests

`docker compose exec backend python manage.py test reviews` - 37 tests:

- the name format (`Maria K.`, first name only, `Guest`)
- the stay rule: confirmed + ended counts (check-out today too); pending,
  cancelled, future, in-progress, another property or another guest don't
- public list: hidden excluded, newest first, no emails, the summary and
  breakdown, 5 per page with the summary over all pages, `404` for a
  retired or unknown property (admin still sees a retired one), a fixed
  query count
- hidden reviews left out of `rating_avg`/`review_count` on the list and
  the detail
- posting: `401` anonymous, `201` after a stay (comment trimmed, optional,
  `guest` in the body ignored), `400` for each not-allowed stay, a second
  review (even if the first is hidden), bad rating/comment/property, a
  retired property, and the race (`IntegrityError` → `400`)
- reviews are final: no `GET`/`PUT`/`PATCH`/`DELETE`
- `viewer_review` for anonymous, no stay, eligible, then after posting
- bookings: `can_review`/`my_review` per row, nothing for an admin looking
  at another guest's booking, the same query count for 4 or 8 bookings
- admin: `401`/`403`, hidden included, every filter, bad filters `400`,
  hide → gone from the public list → unhide → back, only `is_hidden`
  writable, no `PUT`/`DELETE`

## Favorites API (TICKET-033)

Logged-in guests save ("heart") places and see them again on a Saved page;
admins see how many accounts saved each place. Code: `backend/favorites/`
(`models.py`, `serializers.py`, `views.py`, `urls.py`, `tests.py`) and
`backend/listings/queries.py`.

### Decisions (agreed before building)

| Decision | What it means |
| --- | --- |
| **Stored on the server, per account** | A `Favorite` row per user + property, so saved places follow the guest to any device. Logged-out visitors can't save (the frontend sends them to log in first). |
| **Saved page** | A new `/favorites` page (TICKET-033 step 3) uses `GET /api/favorites/`. |
| **Deactivated places stay** | If an admin deactivates a saved place, it stays in the Saved list with `is_active: false` (shown greyed out, "No longer available", with Remove). It can't be *newly* saved, but it can always be removed. |
| **Admins see a count** | `favorite_count` on the admin properties list/detail ("Saved by N", step 4). Guests never see it. |

### Endpoints

| Method | URL | Who | What |
| --- | --- | --- | --- |
| `GET` | `/api/favorites/` | logged in | My saved places, **most recently saved first**, 12 per page (`?page=`, `?page_size=` up to 50) |
| `PUT` | `/api/favorites/{property_id}/` | logged in | Save it: `201` the first time, `200` if already saved (same `saved_at`). Inactive or unknown property → `404`. No body needed (any body is ignored). |
| `DELETE` | `/api/favorites/{property_id}/` | logged in | Remove it: always `204` - also if it wasn't saved, or the property was deactivated since |

Anonymous callers get `401`. `PUT` and `DELETE` are **safe to repeat**, so
a double tap or a retry never errors or creates duplicates - and a race
between two quick taps is settled by the unique constraint (the loser just
reads the winner's row, `200`). There is no `POST` (`405`).

`PUT` response:

```json
{"property": 14, "is_favorite": true, "saved_at": "2026-09-28T17:11:30.144687+03:00"}
```

`GET /api/favorites/` returns **the same card shape as `GET
/api/properties/`** (so the frontend reuses the listing card) plus
`saved_at`:

```json
{"count": 2, "next": null, "previous": null,
 "results": [{"id": 14, "title": "Stylish Room in Corfu", "location": "Corfu, Greece",
   "price_per_night": "74.00", "capacity": 2, "amenities": ["wifi"],
   "is_active": true, "cover_image": "https://picsum.photos/seed/14-0/800/600",
   "rating_avg": 4.5, "review_count": 2, "is_favorite": true,
   "saved_at": "2026-09-28T17:11:30.144687+03:00"}]}
```

### `is_favorite` and `favorite_count` on properties

- `GET /api/properties/` and `GET /api/properties/{id}/` now include
  **`is_favorite`** for the caller (`false` when logged out), so the hearts
  on the listings and the property page show the right state straight away.
- Admins also get **`favorite_count`** on both (and in create/update
  responses). The field is removed from the response for everyone else.

How it stays one query: `listings/queries.py:property_cards()` builds the
annotated queryset used by both `PropertyViewSet` and the Saved list -
`is_favorite` is an `EXISTS` subquery for the caller, and `favorite_count`
is a `COUNT` **subquery**, not another `JOIN`: a second joined table next
to the reviews join would multiply rows and skew the rating aggregates (a
test checks the rating stays right). Tests also check that the query count
doesn't grow with the number of favorites or saved places.

### Try it with curl

```bash
# Save property 14, save it again (200), list, remove
curl -X PUT http://localhost:8000/api/favorites/14/ -H "Authorization: Bearer $ACCESS"
curl -X PUT http://localhost:8000/api/favorites/14/ -H "Authorization: Bearer $ACCESS"
curl http://localhost:8000/api/favorites/ -H "Authorization: Bearer $ACCESS"
curl -X DELETE http://localhost:8000/api/favorites/14/ -H "Authorization: Bearer $ACCESS"

# The heart state for the caller, and the admin-only count
curl http://localhost:8000/api/properties/14/ -H "Authorization: Bearer $ACCESS"        # "is_favorite": ...
curl http://localhost:8000/api/properties/14/ -H "Authorization: Bearer $ADMIN_ACCESS"  # + "favorite_count": ...
```

### Tests

`docker compose exec backend python manage.py test favorites` - 33 tests:

- model: one per user per property (DB constraint), other users can save
  the same place, deleting a user removes their favorites, deactivating a
  property keeps them
- save/remove: `401` anonymous, `201` then `200` (one row, first date
  kept), `saved_at` formatted like the list, `404` for inactive/unknown
  properties, the body can't save for someone else, `204` for remove,
  remove twice / never saved / deactivated since, only the caller's row
  removed, `405` for other methods
- Saved list: `401`, empty, only mine and newest first, the listing card
  shape + `saved_at` (cover, rating, no `favorite_count`), deactivated
  places kept with `is_active: false`, 12 per page, fixed query count
- properties: `is_favorite` false when anonymous and per caller on the
  list and detail, flips after save/remove; `favorite_count` hidden from
  guests, right for admins (list, detail, inactive places, write
  responses), doesn't skew the rating, fixed query count

One existing test (`listings`: the list card's exact fields) now expects
`is_favorite` too.

## Map positions API (TICKET-034)

Step 1 of the map view: every property can have a map position. Code:
`backend/listings/geo.py`, `models.py`, `serializers.py`
(`CoordinateField`, `CoordinatesMixin`), `views.py` and the migrations
`0003_property_coordinates.py` / `0004_backfill_coordinates.py`.

### Decisions (agreed before building)

| Decision | What it means |
| --- | --- |
| **Latitude/longitude on `Property`** | Two optional fields, both or neither. A place without them simply isn't on the map. |
| **Find on map (step 3)** | The admin form will look the `location` text up with OpenStreetMap Nominatim, through the backend. |
| **Leaflet + OpenStreetMap** | Free tiles, no API key. The public tile server is fine for a low-traffic demo (with its attribution). |
| **Split view on desktop** | Listings on the left and a sticky map on the right; a List / Map button on phones (step 5). |
| **The map shows every matching stay** | Not only the 12 on the current page (step 2's pins endpoint). |
| **Approximate location** | Only admins see the exact point. Everyone else (logged out, guests, even after booking) gets a ~500 m area. |
| **Also** | A map on the property page (step 6) and click/drag to place the pin in the admin form (step 7). |

### What the API returns

`GET /api/properties/`, `GET /api/properties/{id}/` and the Saved list
(`GET /api/favorites/`) now include four fields:

| Field | Admin | Everyone else |
| --- | --- | --- |
| `latitude`, `longitude` | The exact point (JSON numbers, 6 decimals) | An **approximate point**: 100-400 m away from the real one |
| `location_is_approximate` | `false` | `true` |
| `location_radius_m` | `null` | `500` - the circle the map draws around the approximate point |

Both coordinates are `null` when the place has no position.

```json
// guest / logged out
{ "id": 7, "location": "Chania, Greece",
  "latitude": 35.511902, "longitude": 24.021105,
  "location_is_approximate": true, "location_radius_m": 500, ... }
// admin, same place
{ "id": 7, "latitude": 35.510484, "longitude": 24.017487,
  "location_is_approximate": false, "location_radius_m": null, ... }
```

### How the approximate point works (`listings/geo.py:approximate_point`)

- The real point is moved **100-400 m** in a direction and by a distance
  that come from an HMAC of `SECRET_KEY` + the property id. Because the
  offset is at most 400 m and the circle is 500 m, **the real place is
  always inside the circle, but never at its centre**.
- The offset is **fixed per property**, so the circle doesn't move between
  page loads. A random offset per request could be averaged away by
  reloading the page many times.
- Without `SECRET_KEY`, the offset can't be worked out from public data.
  Changing `SECRET_KEY` moves every circle once, which is harmless.
- The exact coordinates **never reach a guest's browser**. The serializer
  swaps them before the response is built (a test checks the raw response
  body).
- Which one a caller gets is decided in `PropertyViewSet`
  (`context["exact_location"] = is admin`). Any other serializer that
  reuses the property card (like the Saved list) gets the approximate
  point by default.

### Setting a position (admin)

`POST` / `PUT` / `PATCH /api/properties/{id}/` accept `latitude` and
`longitude`:

- **Numbers or numeric strings.** Any number of decimals is accepted and
  rounded to 6 (about 11 cm), because a map click gives about 15.
- **Both or neither.** A `PATCH` with just one is checked against the
  stored other value: sending only `latitude` to a place that has no
  position → `400 {"longitude": ["Set a longitude too, or clear the
  latitude."]}`; sending only `latitude` to a place that has one just
  moves it.
- **Clearing.** Send `null` (or `""`) for both.
- **Rejected with `400`:** latitude outside -90..90, longitude outside
  -180..180, `"abc"`, `NaN`, `Infinity`, `true`.
- Guests can't write (`403`, like every other property field).

Django Admin shows the two fields in a "Map position" section of the
Property page.

### Existing and seeded places

- **`0004_backfill_coordinates`** (a data migration) gives every place
  whose `location` starts with one of the seeder's 12 cities
  ("Chania, Greece" → Chania, case and spaces ignored) a random point
  near that city. The point is seeded by the property id, so it's
  repeatable. Other places are left without a position, and places that
  already have one are left alone. The hosted copy on Render gets its
  positions from this migration on the next deploy (`build.sh` runs
  `migrate`), with no re-seed.
- **`seed_demo_data`** gives each new place a point near its city (see
  "Seeding demo data").
- The migration keeps its **own frozen copy** of the city table, so a
  later edit to `geo.py` can't change what an old migration does.

### Tests

- `listings/tests.py` has 24 new tests:
  - `CoordinateModelTests`: `clean()` and the DB constraints.
  - `ApproximatePointTests`: 300 ids all land 100-400 m away and inside the
    circle; the point is the same on every call, differs per property and
    depends on `SECRET_KEY`; demo points stay inside their city's radius.
  - `CoordinateAPITests`: guests/anonymous/Saved list get the approximate
    point (and the exact value isn't in the body), admins get the exact
    one, rounding, both-or-neither on `PATCH`, clearing, bad values, and
    guests can't write.
  - `BackfillMigrationTests`: migrates to `0003`, creates places, then
    runs `0004`.
- `core/tests.py`: `SeedCoordinatesTests` (every seeded place is near its
  city).
- **Results:** all **359** backend tests pass on Postgres, and
  `makemigrations --check` is clean. On a fresh database, `migrate` +
  `seed_demo_data` gave all 14 places a position, and the API showed each
  place exactly for the admin and 230-360 m off, with the 500 m radius,
  for a logged-out visitor.

## Map pins API (TICKET-034)

Step 2 of the map view: `GET /api/properties/map/` gives the listings map
**every stay that matches the search**, not only the 12 cards on the
current page. Code: `listings/views.py:PropertyViewSet.map` and
`listings/serializers.py:PropertyPinSerializer`.

### Request

- **Same query parameters as `GET /api/properties/`:** `check_in` +
  `check_out`, `location`, `guests`, `min_price`, `max_price`, `ordering`,
  and `is_active` (admins only).
- **Same `400`s:** it goes through the same `apply_property_filters()`, so
  the map and the list can never disagree about which stays match.
- **The frontend sends exactly what it sends for the list,** including
  `is_active=true` for an admin browsing the site.
- **No pagination:** `page` and `page_size` are ignored.
- **Read-only:** anything other than `GET` returns `405`.

### Response

```json
{
  "count": 13,
  "missing_position": 1,
  "truncated": false,
  "results": [
    { "id": 13, "title": "Cozy Loft in Chania", "location": "Chania, Greece",
      "latitude": 35.511902, "longitude": 24.021105,
      "location_is_approximate": true, "location_radius_m": 500,
      "price_per_night": "126.00", "capacity": 6, "is_active": true,
      "cover_image": "https://picsum.photos/seed/13-0/800/600",
      "rating_avg": 4.5, "review_count": 2, "is_favorite": false }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `count` | Matching stays **with** a map position (the pins) |
| `missing_position` | Matching stays **without** one. They're in the list but not on the map, so the page can say "N stays not shown on the map". |
| `truncated` | `true` only if there are more than 500 pins (`MAP_PIN_LIMIT` in `views.py`); `results` then holds the first 500 in the requested order. The demo never gets near this; it's only a safety limit. |
| `results` | One small item per pin: what the price tag and its pop-up card need, including `is_favorite` (added in step 5 for the pop-up's heart). There's no description or amenities; the pop-up links to the property page for those. |

- **Location precision:** same rule as the cards. Admins get the exact
  point; everyone else gets the approximate one with
  `location_radius_m: 500`. It's the same approximate point the card and
  the property page get, so the pin, the pop-up and the property page's
  circle always agree.
- **Pin order:** follows `ordering` (default newest first), so if the
  limit ever kicks in, it keeps the same stays the list shows first.
- **Size:** 14 seeded stays are about 4 kB.

### Queries

Four, however many pins there are:

- the pin count
- the `missing_position` count
- the pins with their ratings (one aggregated query)
- the cover images (one prefetch)

A test compares 2 pins with 22 pins.

### Try it with curl

```bash
# Stays in Chania free for these dates, 2+ guests, as pins
curl "http://localhost:8000/api/properties/map/?location=chania&guests=2&check_in=2027-03-10&check_out=2027-03-14"
```

### Tests

- `listings/tests.py:MapPinTests` has 13 tests:
  - only active stays with a position, plus the `missing_position` count
  - the pin shape and cover
  - guests get the approximate point (the same one as the detail page, with
    the exact value not in the body)
  - admins get exact points and inactive stays unless `is_active=true` is
    sent
  - location, price, guests and date filters, and `missing_position`
    following the filters
  - the same `400`s as the list
  - not paginated, the limit → `truncated`, ordering
  - constant query count
  - `405` on `POST`
  - `/map/` isn't read as a property id
- **Results:** **372** backend tests pass on Postgres. Against seeded data,
  the endpoint returned 13 approximate pins to a logged-out visitor, 14
  pins to the admin (13 with `is_active=true`), 1 pin for Athens + 2
  guests, and a `400` for min > max price.

## Admin place search API (TICKET-034)

Step 3 of the map view: the admin property form's **Find on map** (built
in step 7) needs to turn text like "Tsimiski 45, Thessaloniki" into a
point. `GET /api/admin/geocode/?q=…` does that with OpenStreetMap
**Nominatim**, which is free and needs no API key. Code:
`listings/geocoding.py` and `listings/views.py:GeocodeView`.

### Decisions (agreed before building)

- **Greece only.** Nominatim is called with `countrycodes=gr`, so short
  names like "Volos" match the Greek town, and places abroad can't be
  found.
- **Specific places, several to choose from.** It returns up to **5**
  matches, most relevant first: addresses, streets, neighbourhoods,
  villages, towns. Region- or country-level matches ("Crete", "Central
  Macedonia") are dropped, because they would drop the pin in the middle
  of nowhere. The admin picks the one they mean in step 7.

### Request and response

`GET /api/admin/geocode/?q=Tsimiski 45, Thessaloniki` (admin only):

```json
{
  "query": "Tsimiski 45, Thessaloniki",
  "results": [
    { "label": "45, Tsimiski, Center, Thessaloniki, 546 23, Greece", "name": "45",
      "latitude": 40.632711, "longitude": 22.943158, "precision": "address", "kind": "house" },
    { "label": "Tsimiski, Thessaloniki, Greece", "name": "Tsimiski",
      "latitude": 40.6311, "longitude": 22.9468, "precision": "street", "kind": "road" }
  ],
  "attribution": "Search by OpenStreetMap Nominatim · © OpenStreetMap contributors"
}
```

**`precision`** comes from Nominatim's `place_rank` and tells the form
how exact the point is:

| `precision` | `place_rank` | Examples |
| --- | --- | --- |
| `address` | 28-30 | a house number, a building, a named place (hotel, square) |
| `street` | 26-27 | a road |
| `area` | 17-25 | a village, suburb, neighbourhood, island |
| `city` | 13-16 | a city or town |
| *(dropped)* | below 13 | country, region, county |

`kind` is Nominatim's own label (`house`, `road`, `suburb`, `city`, ...).
Duplicates (the same point twice) are removed, and items without a valid
point are skipped.

| Status | When |
| --- | --- |
| `200` | Found something, or `"results": []` for nothing found |
| `400` | `q` missing, or shorter than 2 / longer than 200 characters (after trimming) |
| `401` / `403` | Not logged in / not an admin |
| `429` | More than 30 searches a minute by one admin (`GeocodeThrottle`) |
| `503` `geocoding_unavailable` | Nominatim couldn't be reached, timed out (5 s), refused (e.g. its own 429) or sent something unusable. The admin can still click the map or type the numbers. |
| `503` `geocoding_disabled` | `GEOCODING_URL` is empty (search switched off) |

### Following Nominatim's usage policy

The search runs on the server, not in the browser, so the rules of the
[usage policy](https://operations.osmfoundation.org/policies/nominatim/)
are kept in one place:

- **An identifying User-Agent:**
  `BookingSystemDemo/1.0 (+https://github.com/ParaskevasLysikatos/Booking-System-Demo)`
  (`GEOCODING_USER_AGENT`).
- **At most 1 request per second** per server process. A lock and a
  timestamp make a second search wait for its turn.
- **Caching:** results are kept for 24 hours, and "nothing found" for
  1 hour, in Django's cache (the default in-memory cache). The key ignores
  case and extra spaces, so searching the same text again never reaches
  Nominatim. Errors are not cached.
- **Attribution:** returned with every response, for the form to show.
- **Settings:** see "Environment variables" (`GEOCODING_*`). The defaults
  work, so nothing needs to be set locally or on Render.

### Try it with curl

```bash
curl -H "Authorization: Bearer $ADMIN_ACCESS" \
  --get --data-urlencode "q=Tsimiski 45, Thessaloniki" http://localhost:8000/api/admin/geocode/
```

### Tests

- `listings/tests.py:GeocodeAPITests` has 16 tests. Nominatim is mocked,
  so the tests never touch the network. They cover:
  - specific results in order, with region-level ones dropped
  - the request asks for Greece only, in English
  - at most 5 results and no duplicates
  - the precision labels
  - broken items skipped, and nothing found
  - caching ignores case and spaces
  - the 1-second spacing
  - network, timeout and HTTP 429 errors, and an unexpected reply → `503`,
    which isn't cached
  - the User-Agent header and the URL
  - switched off → `503`
  - query validation
  - admin only
  - the per-admin limit
- **Results:** **388** backend tests pass on Postgres.
- **Checked on Render** (after deploying `5e4ad97`, from the live site in
  Chrome):
  - Steps 1-2 are live. The migration gave all 13 active stays a position:
    `/api/properties/map/` → 13 pins, `missing_position: 0`, approximate
    points with `location_radius_m: 500` for a guest.
  - `/api/admin/geocode/` → `401` logged out, and `403` for a demo guest.
- **Still to check live:** the lookup against the real Nominatim needs an
  admin session on the live site. This sandbox can't reach Nominatim
  (outbound traffic is blocked here), so it's done with the owner in the
  step 8 Render check.

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
- a **heart** in the photo's top-right corner to save the place
  (TICKET-033, see "Favorites: the heart"). It sits *next to* the card's
  link, not inside it, so tapping it never opens the stay.

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
  "Sleeps N". The rating is a link that scrolls to **Reviews** (it doesn't
  change the URL, so the chosen dates stay in it). On the right of the
  title, a **♡ Save / ♥ Saved** button (TICKET-033, see "Favorites: the
  heart").
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
- **Reviews** (`reviews/property-reviews.ts`, TICKET-032) - see below.

### Reviews section (TICKET-032)

The last section of the page, under Availability. It loads its own data
from `GET /api/properties/{id}/reviews/` (see "Reviews API"), so the page
itself is still one request.

- **Summary:** the average in large type (e.g. **3.9**) with stars
  (rounded to the nearest half star), "8 reviews", and one bar per star
  rating (5 to 1) showing the share of reviews that gave it, with the
  count printed beside each bar. The bars use the app's primary colour on
  a lighter track of the same hue - the same meter style as the admin
  dashboard - and each row reads e.g. "5 stars: 3 reviews" to screen
  readers.
- **Reviews:** two columns on wide screens, one on phones. Each has the
  initial in a circle, the name ("Maria K."), the month ("September
  2026"), the stars and the comment (a review without a comment shows
  only the stars). Hidden reviews never reach the page.
- **Show more reviews** loads the next 5 and adds them under the others,
  with "Showing 5 of 8" beside it; it disappears once all are shown. If a
  review is posted in between (which shifts the pages by one), the one
  already shown isn't repeated. If loading more fails, the shown reviews
  stay and the button becomes **Try again**.
- **States:** a skeleton while loading; "No reviews yet. Guests can leave
  one after their stay."; "Couldn't load the reviews." + Try again.
- `reload()` re-reads from page 1 - used after a review is posted.

**Writing a review (step 3).** The section's heading row shows, from the
property's `viewer_review` (the server decides - the page never works out
the rule itself):

- **Write a review** when `can_review` is true (logged in, a confirmed
  stay here has ended, not reviewed yet). It opens the review dialog
  (below). After posting: the button becomes **"✓ You rated this place
  ★★★★☆"**, the reviews reload (the new one on top), the header rating
  follows the new summary (e.g. 8 → 9 reviews), and a snackbar says
  "Thanks - your review is posted."
- **"✓ You rated this place ★★★★☆"** when `my_review` is set.
- Nothing for visitors who aren't logged in or haven't stayed.

The header's "★ 3.9 · 9 reviews" uses the summary the Reviews section
last loaded (the property's own `rating_avg`/`review_count` until then),
so it never disagrees with the section below it.

### The review dialog (`shared/review-dialog.ts`, TICKET-032)

Shared by the property page and My bookings; `data` is the property's id
and title.

- "How was your stay at **Modern Villa in Rhodes**?"
- **Star picker:** five real radio buttons drawn as stars (so arrow keys,
  Tab and screen readers work as usual; each is labelled "4 stars -
  Good"), 44 px targets, the stars light up on hover, and the word
  (Terrible / Poor / Okay / Good / Excellent) appears beside them.
  Posting without a rating says "Choose a rating from 1 to 5 stars." and
  sends nothing.
- **Comment** (optional), with a "56 / 1000" counter; typing stops at
  1,000 characters. Sent trimmed.
- The note **"Reviews are final: once posted you can't edit or delete
  it. It shows your first name and last initial."**
- **Post review** shows a spinner and the dialog can't be closed while
  posting. On success it closes with the new review. If the server
  refuses (e.g. "You've already reviewed this place." from another tab),
  the message is shown in the dialog, which stays open; a comment error
  is shown under the comment.

Checked in a headless Chrome against a seeded property with 8 reviews,
at 1280 px and 390 px (no sideways scroll, the header link scrolls to
the section).

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

**TICKET-032 step 2** added 9 tests (234 frontend tests in total):

- `starIcons()` rounding to half stars (and clamping), the stars' screen
  reader label
- `ReviewService` sends `?page=` only after page 1
- Reviews section: the summary, per-star bar labels and widths, month
  dates, a review without a comment; Show more appends, skips a
  duplicate and disappears at the end; a failed Show more keeps the list
  and retries; no reviews; a failed load + Try again
- the page: the Reviews section renders, and the header rating scrolls
  to it without changing the URL

**TICKET-032 step 3** added 13 tests (247 frontend tests in total):

- review dialog (6): the question, 5 labelled star radios and the "final"
  note; no rating → message and nothing sent; stars + word + counter;
  posts rating + trimmed comment, blocks closing while posting, closes
  with the review; a refusal stays in the open dialog; a comment error
  under the comment
- property page (3): no button without `viewer_review`; "You rated this
  place" with the stars; Write a review → posted → the rating replaces the
  button, the reviews reload and the header follows (3.7 · 3 reviews)
- My bookings (4): Leave a review / You rated / nothing, per past card;
  nothing on upcoming bookings; Leave a review → snackbar + reload;
  closing the dialog changes nothing

Checked end to end in a headless Chrome against the real API (a guest
with two ended, confirmed stays): Write a review → no rating → message;
4 stars + comment → posted, header 8 → 9 reviews, the new review first,
"You rated this place"; My bookings → Past shows "You rated" on that stay
and Leave a review on the other → posted from a 390 px phone (no sideways
scroll).

## Favorites: the heart (Angular, TICKET-033)

Guests save a place with a heart on every listing card and on the
property page. Uses the "Favorites API (TICKET-033)".

### Where it is

| Place | Looks like |
| --- | --- |
| Listing cards (`pages/listings/property-card/`) | A round white 44×44 px button in the photo's top-right corner: ♡ empty, ♥ filled (pink) when saved |
| Property page header (`pages/property-detail/`) | "♡ Save" / "♥ Saved" to the right of the title |
| Admin accounts | **No hearts at all** - admins manage listings, they don't book them |

Both use one component, `shared/favorite-button.ts`
(`<app-favorite-button [property]="p" variant="overlay|labeled" />`), and
all the logic is in `core/favorites/favorite.service.ts`.

### How a tap works (`FavoriteService`)

- **Starting state from the server:** each card and the detail carry
  `is_favorite` for the caller, so hearts are right on first paint.
- **Optimistic:** the heart changes at once, then `PUT` (save) or `DELETE`
  (remove) `/api/favorites/{id}/` runs. If it fails, the heart switches
  back and a snackbar says why - e.g. "This place is no longer available,
  so it can't be saved." (the place was deactivated meanwhile, `404`), or
  "Couldn't remove this place. Can't reach the server. …".
- **One place, one state:** taps made in this session are remembered per
  place (`overrides`), so the card and the property page always agree -
  save on the property page, go back, and the card's heart is filled too.
  They're forgotten when the account changes (log out / another account).
- **No double requests:** a second tap on the same heart while its request
  is still running is ignored (`aria-busy` is set meanwhile); other hearts
  keep working.
- The tap never reaches the card link (`preventDefault` +
  `stopPropagation`, and the button isn't inside the `<a>` anyway - a
  button inside a link is invalid HTML).

### Logged out: log in, then it's saved

1. A visitor taps a heart. The place (id + title + time) is parked in
   `sessionStorage` (`bsd.pendingFavorite`, this tab only).
2. They go to `/login?returnUrl=<this page>&reason=favorite`; the login
   page says "Log in to save this place - it's saved as soon as you're
   in." ("Create one" keeps the same link, so signing up works too.)
3. As soon as someone is logged in, the service completes the parked save
   (`PUT`), the heart is filled on the page they return to, and a snackbar
   says **Saved "Harbour Loft".** - even if the page loaded before the
   save finished.
4. A parked save older than **30 minutes** is dropped, and so is one when
   an **admin** logs in. It also survives a reload of the login page.

### Accessibility

- A real `<button type="button">` with `aria-pressed` (a toggle button)
  and a fixed label, "Save Harbour Loft", so a screen reader says "Save
  Harbour Loft, toggle button, pressed / not pressed". (The label doesn't
  switch to "Remove …": with `aria-pressed`, the pressed state already
  says it, and a changing label would be read as a different button.)
- Keyboard: Tab to it, Space/Enter toggles; a visible focus ring.
- 44×44 px touch target on the cards and the header button.

### Tests

- **`favorite.service.spec.ts`** (13): starts from the server's flag;
  optimistic save then remove; a second tap while busy is ignored; other
  places aren't blocked; `404` and network failures switch back with the
  right message; logged out → parked + login with `returnUrl` and
  `reason`; the parked save completes after login (with the snackbar),
  after a reload on the login page, but not when too old/broken or for an
  admin; admins can't toggle; taps are forgotten on logout.
- **`favorite-button.spec.ts`** (6): toggle button + label, saved state,
  a tap fills it at once and saves (and doesn't bubble), labeled variant
  text, shown to visitors, hidden from admins.
- **`property-card.spec.ts`** (+2): the heart is outside the link and a tap
  doesn't open the stay; filled for a saved place.
- **`property-detail.spec.ts`** (+3): Saved in the header and a tap
  removes it; logged out → login; no heart for admins.
- **`login.spec.ts`** (+1): the "Log in to save this place" message.

Browser check against the real API (headless Chrome, 1280 and 390 px,
27/27): a heart on every card (44×44, not inside the link); visitor tap →
login with the message → back to the listings with the heart filled, the
snackbar and the favorite on the server; save/remove on the listings and
on the property page (both stay in sync, reload keeps the server's state,
keyboard Space works, a tap never opens the stay); a place deactivated
meanwhile → the heart switches back with the message; no sideways scroll
on phones; no hearts for the admin.

## Saved page (Angular, TICKET-033)

`/favorites` (`pages/favorites/`, behind `authGuard`, tab title "Saved ·
Booking System Demo") - the logged-in guest's saved places, from `GET
/api/favorites/` (see "Favorites API").

### Getting there

- **Toolbar:** a **♡ Saved** link before My bookings, for guests (admins
  have no hearts, so no Saved link either). On phones, where the inline
  links are hidden, **Saved** is in the account menu.
- Logged out, `/favorites` goes to login and comes back afterwards.

### The page

- "Saved" + **"N saved places"**, then the **same cards as the listings**
  (the API returns the same shape, so it reuses `PropertyCard`), **most
  recently saved first**, 12 per page with a paginator (`?page=` in the
  URL) when there are more.
- **Un-hearting a card removes it from the page at once**, and a snackbar
  says **Removed "Harbour Loft" from saved.** with **Undo** for 5 seconds.
  Undo saves it again and the card comes back **in the same spot** (the
  page keeps the list it loaded and only hides removed cards, so nothing
  jumps around). If the request fails, the card comes back by itself with
  the error message (the heart logic in `FavoriteService`).
- **Places an admin deactivated** stay on the page, **greyed out** with a
  **No longer available** badge. They're not a link (they can't be opened
  or booked) and have a **Remove** button instead of the heart. Removing
  one shows the snackbar with OK instead of Undo, because a deactivated
  place can't be saved again.
- If you remove every card on the page but you have more saved places, the
  page **refills itself from the server** (or steps back a page when the
  last page empties) - after the Undo snackbar is gone, so Undo still
  works.
- **States:** skeleton cards while loading; "Couldn't load your saved
  places." + Try again; empty: "No saved places yet. Tap the heart on any
  stay to save it here." + **Browse stays**.

### Pieces

- `pages/favorites/favorites.ts` - the page (URL page → `FavoriteService.list(page)`,
  the visible cards and count, Undo, refill).
- `PropertyCard` gained a `favoriteToggled` output (from the heart or
  Remove) and the greyed-out "No longer available" look for
  `is_active: false` - the listings never return those, so only the Saved
  page shows it.
- `FavoriteService.toggle()` now returns the new state (or `null` when a
  tap changed nothing) and `FavoriteService.list()` loads the page;
  `FavoriteButton` emits `toggled`.

### Tests

- **`favorites.spec.ts`** (9): skeleton then the cards in the server's
  order with the count; empty state; error + Try again; un-heart → card
  gone at once + Undo snackbar → Undo → back in the same spot; a failed
  remove brings the card back; a deactivated place (greyed, Remove, no
  Undo); removing the only place → empty state, Undo still works; an
  emptied page refills only after the Undo bar is gone; the last page
  emptied → back to page 1.
- **`property-card.spec.ts`** (+2): the deactivated look (no link, badge,
  Remove, no heart) and Remove sends `DELETE` and tells the page.
- **`toolbar.spec.ts`** (+1, 2 updated): Saved for guests (inline and in
  the account menu), not for admins.
- **`favorite.service.spec.ts`** (+2): `list()` with `?page=`, and what
  `toggle()` returns. **`favorite-button.spec.ts`** (+1): `toggled` is
  emitted once per real change.

Browser check against the real API (headless Chrome, 1280 and 390 px,
24/24): visitor → login → back to `/favorites`; the tab title and the
toolbar link marked current; "14 saved places", 12 cards + paginator,
server order; the deactivated place greyed with Remove → gone without
Undo, also on the server; un-heart → gone at once, removed on the server
→ Undo → same spot and saved again; left alone → still removed after a
reload; page 2 in the URL; a heart on the listings → first on the Saved
page; phones: Saved in the account menu, the Undo bar fits, no sideways
scroll; the empty state; no Saved link or menu item for the admin.

## Shared map component (Angular, TICKET-034)

Step 4 of the map view: one `<app-map>` for the three places that show a
map. Steps 5-7 put it on:

- the `/listings` split view
- the property page
- the admin form

Code: `frontend/src/app/shared/map/`:

- `map.ts`: the component
- `map.scss`
- `map-markers.ts`: types, tile settings and small pure helpers
- `map-loader.ts`: lazy loading

### Decisions (agreed before building)

- **Map style: a light, low-contrast base map**, so the price tags stand
  out. The first choice was CARTO Voyager. **Changed in step 5:** CARTO no
  longer serves those tiles without an API key. Every tile came back as an
  "API KEY REQUIRED" placeholder, checked from the browser, whatever the
  referrer.
  - The map now uses **OpenStreetMap's standard tiles**, softened with a
    CSS filter on the tile layer only (`.app-map-tiles { filter:
    saturate(0.35) brightness(1.05) contrast(0.9) }` in `map.scss`), so it
    stays light without any account or key.
  - The credit line reads "© OpenStreetMap contributors".
  - OSM's [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
    asks for that credit and light use, which fits a demo.
  - To switch provider later, change `TILE_URL` / `TILE_ATTRIBUTION` in
    `map-markers.ts`.
- **Nearby stays merge into numbered bubbles.** This uses the
  `leaflet.markercluster` package. Clicking a bubble zooms in; stays at the
  exact same spot fan out.

### New packages

- `leaflet` ^1.9.4 and `leaflet.markercluster` ^1.5.3, plus their types
  (`@types/leaflet`, `@types/leaflet.markercluster`, dev only).
- Both ship as CommonJS, so they're listed in `angular.json`'s
  `allowedCommonJsDependencies`. That's expected, and it's fine because
  they're lazy.
- **Docker:** the frontend container keeps `node_modules` in its own
  volume. After pulling this change, rebuild it and renew that volume:

  ```bash
  docker compose up -d --build -V frontend
  ```

  Without the rebuild, `ng serve` can't find `leaflet`. Outside Docker,
  `npm install` in `frontend/` is enough.

### Using it

```html
<app-map
  style="height: 480px"
  ariaLabel="Stays on a map"
  [markers]="markers"          <!-- MapMarker[] -->
  [highlightedId]="hoveredId"  <!-- lift one marker (or its bubble) -->
  [cluster]="true"             <!-- merge nearby markers (default) -->
  [fitToMarkers]="true"        <!-- refit when markers change (default) -->
  [maxFitZoom]="15"            <!-- how far a fit may zoom in (default) -->
  [scrollWheelZoom]="true"     <!-- off for small embedded maps -->
  (markerSelect)="onPick($event)"
  (mapClick)="onClick($event)" <!-- { lat, lng } -->
>
  <ng-template let-marker>     <!-- optional pop-up, any Angular content -->
    <a [routerLink]="['/listings', marker.id]">{{ marker.title }}</a>
  </ng-template>
</app-map>
```

The host element needs a height. The component is 200 px high at minimum,
with rounded corners.

**`MapMarker`** (`map-markers.ts`):

| Field | Meaning |
| --- | --- |
| `id` | Used by `highlightedId` and handed back in `markerSelect` |
| `lat`, `lng` | The point. Markers with `null`, `NaN` or out-of-range coordinates are skipped, since the API sends `null` for a place without a position |
| `title` | The accessible name (`aria-label`) and hover title, e.g. "Cozy Loft in Chania, €126 a night" |
| `label` | Text of a **price tag** ("€126"). Without it, the marker is a **round pin** (property page, admin form) |
| `areaRadiusM` | Draws a **shaded circle** of that radius instead of a marker. This is the approximate-location area (`location_radius_m` from the API) |
| `data` | Anything the page wants back in `markerSelect` or the pop-up |

### What it does

- **Lazy loading (`MapLoader`):**
  - The first map in the app loads Leaflet and the cluster plugin with
    dynamic `import()`, and adds a `<link>` to `map-styles.css`. That file
    is Leaflet's CSS plus the cluster CSS, which `angular.json` builds as a
    separate, non-injected bundle.
  - It's loaded once per app. If it fails, the next try starts again.
  - The map doesn't wait for the stylesheet forever (at most 8 s).
  - The cluster plugin extends the global `L`. Leaflet sets `window.L`
    itself, and the loader makes sure it's there before loading the plugin.
- **States:**
  - A spinner while the map code loads.
  - If it fails: "The map couldn't load." with **Try again**.
- **Fitting the view:**
  - The view fits all markers and circles, with 32 px of padding.
  - A single point is shown at zoom 15 (`maxFitZoom`).
  - With nothing to show, it shows all of Greece (zoom 6).
  - It refits whenever `markers` changes.
- **Price tags:**
  - A white pill whose bottom-centre sits on the point. It turns dark on
    hover, on keyboard focus and when highlighted.
  - Labels are HTML-escaped.
- **Bubbles:**
  - A blue circle with the count and the accessible name "N stays here -
    zoom in".
  - `highlightedId` highlights the bubble when the stay is inside one, and
    is re-applied after every zoom or pan, because the plugin re-creates
    the bubbles.
- **Pop-up:** clicking a marker emits `markerSelect`. If the page gave an
  `<ng-template>`, it's rendered as a real Angular view (so `routerLink`
  etc. work) inside a Leaflet pop-up. The view is destroyed when the pop-up
  closes, and the pop-up closes when `markers` changes.
- **Keyboard and screen readers:**
  - The map is a `region` with `ariaLabel`.
  - Every marker and bubble is a focusable `role="button"` with a name.
  - Enter opens a marker's pop-up.
  - Leaflet's own zoom buttons and keyboard panning stay available.
- **Resizing:** a `ResizeObserver` tells Leaflet when the box changes size,
  for example when the split view or the List/Map toggle changes it without
  a window resize.
- **Styles:** Leaflet builds its markers outside Angular's templates, so
  the component's styles aren't encapsulated. Every selector is prefixed
  `app-map-` and scoped under `.app-map`.

### Bundle size

- **Production build before and after:** the initial bundle is
  byte-identical (same `main` hash, 146 kB transferred).
- **With a map on a page** (tried with a throwaway `<app-map>` on
  `/listings`): Leaflet (37.6 kB transferred) and the cluster plugin
  (8.0 kB) are separate **lazy** chunks, and the initial total moves by
  0.3 kB.
- **Stylesheet:** `map-styles.css` is 11.8 kB and is only downloaded when a
  map is shown.
- **Warnings:** the build has none.

### Tests

- `map-markers.spec.ts` has 4 tests:
  - HTML escaping
  - price tag vs pin
  - the bubble label
  - skipping markers without a position
- `map.spec.ts` has 16 tests. They use the **real Leaflet** in jsdom,
  with element sizes stubbed so it can fit and cluster, and a loader that
  skips the stylesheet. They cover:
  - spinner → a labelled region
  - OpenStreetMap tiles, the softening class and the credit
  - keyboard-reachable, named price tags, and a pin without a label
  - markers without a position skipped
  - fitting to all points, to one point, and to Greece
  - a circle for an approximate area, fully in view
  - nearby stays → a "2" bubble with its name
  - highlighting a marker and its bubble
  - click → `markerSelect` and the pop-up template, closed on close and
    when `markers` changes
  - `mapClick`
  - load failure → Try again → the map
  - the Leaflet map removed on destroy
  - `MapLoader` adds the stylesheet once, caches the load and retries
    after a failure
- **Results:** **318** frontend tests pass (298 before), and the
  production build is clean.
- **In a browser:** the component is checked in Chrome in step 5, when the
  listings page first uses it.

## Listings map (Angular, TICKET-034)

Step 5 of the map view: `/listings` shows every stay that matches the
search on a map, next to the list. Code: `pages/listings/` (`listings.ts`,
`.html`, `.scss`, `listing-query.ts`, `map-popup-card/`),
`PropertyService.mapPins()` and the shared `<app-map>` (see "Shared map
component").

### Decisions (agreed before building)

- **Layout (the recommended one):**
  - From **1100 px** wide: about **60% list**, with 2 cards per row, and
    **40% map**. The map is sticky, just below the toolbar, and fills the
    screen's height.
  - Narrower screens: the list only, with a floating **Show map** button.
- **Pop-up card:** a photo, the title, the rating, the location and the
  price per night. When dates are picked it also shows **the total for the
  stay**, like the listing cards, and it has the **♡ heart**.
- **Base map:** softened OpenStreetMap. CARTO Voyager now needs an API key;
  see "Shared map component" → Decisions.

### Wide screens: the split view (≥ 1100 px)

- `section.listings.split` widens to 1600 px. The results become a grid,
  `3fr` for the list and `2fr` for the map.
- **The map column is sticky:** `top: 80px`, below the 64 px toolbar, and
  `height: calc(100vh - 96px)`. It stays in view while the list scrolls.
- The breakpoint is `SPLIT_VIEW_QUERY` in `listings.ts`, the same as
  `$wide` in `styles/_responsive.scss`. It's watched with the CDK
  `BreakpointObserver`, so the layout switches live when the window is
  resized.
- `?view=map` in the URL is ignored here, because both are already shown.

### Phones and tablets: Show map / Show list

- A round **Show map** button floats at the bottom centre, above the
  safe area. Tapping it adds **`?view=map`** to the URL, so **Back** returns
  to the list and the link can be shared.
- In map view, the cards and paginator make way for the map, which fills
  the screen below the search (`calc(100dvh - 240px)`, at least 360 px).
  The "N stays" count stays visible, and the button reads **Show list**.
- **A new search, Clear filters and paging keep the view you're in.**
  `view` is part of `ListingQuery`, so every navigation carries it along.
- The page has extra room at the bottom, so the button never covers the
  last card or the paginator.

### What's on the map

- **One price tag per matching stay**, not just the 12 on the current page.
  The pins come from `GET /api/properties/map/` with the **same filters**
  as the list, and `is_active=true` like the list sends.
- **Tag text and name:** the tag shows the nightly price ("€126"). Its
  accessible name is "Cozy Loft in Chania, €126 a night".
- **Nearby stays** merge into numbered bubbles; click one to zoom in.
- **Which requests run when:**
  - The **list** reloads only when the search or the page changes, not on
    Show map / Show list (`listKey()`).
  - The **pins** reload only when the filters change, not the page
    (`pinsKey()`), and **only while the map is shown**. On a phone in list
    view, no pins are requested at all.
- **While new pins load:** a thin progress bar runs across the top of the
  map, and the old tags stay until the new ones arrive, so the map never
  flashes empty.
- **Hover or keyboard focus on a card** lifts that stay's tag: it turns
  dark and moves on top. If the stay is inside a bubble, the bubble is lit
  up instead.
- **Notes above the map:**
  - "2 stays aren't on the map (no location set yet)." when some matching
    stays have no position (`missing_position`).
  - "Showing the first N stays - narrow the search to see the rest." if the
    500-pin limit is ever hit.
  - If the pins fail to load: "Couldn't load the map's stays." with **Try
    again**, which reloads only the pins.

### The pop-up card (`map-popup-card/`)

- **Clicking a tag** (or Enter on it) opens a 260 px card:
  - the cover photo (a placeholder if it's missing or fails)
  - the title and ★ rating ("New" without reviews)
  - the location and "€126 / night"
  - with dates picked, **"€630 for 5 nights"**
- **The whole card links to the stay** and keeps the search's dates and
  guests, exactly like the listing cards (`cardLinkParams()`).
- **The ♡ heart** sits over the photo, next to the round close button, and
  outside the link. It's the same `FavoriteService` as the cards, so saving
  from the map also fills the card's heart. Admins get no heart, and a
  logged-out visitor goes through login first, as everywhere.
- For the heart to start in the right state, **map pins now include
  `is_favorite`** (a backend change in this step: `PropertyPinSerializer`,
  plus 1 new backend test).

### Tests

- `listings-map.spec.ts` has 9 tests. The map loader is stubbed; the map
  itself is tested in `shared/map`.
  - Wide screens:
    - list and map side by side, with the right tags and names
    - paging reloads the list but not the pins, and a new search reloads
      both
    - card hover or focus → `highlightedId`
    - the missing and truncated notes
    - old pins kept while loading, then an error and Try again
    - `?view=map` ignored
  - Phones:
    - no map and no pins request until Show map
    - Show map → `?view=map`, the list isn't refetched and the cards make
      way for the map; Show list goes back
    - a new search keeps the map view
- `map-popup-card.spec.ts` has 4 tests:
  - content and the link with the search
  - the stay total
  - "New" and the missing photo
  - the heart for guests, outside the link, and none for admins
- `listing-query.spec.ts` (+2) and `property.service.spec.ts` (+1) cover
  `?view=map`, `listKey`/`pinsKey` and the `/map/` request.
- **Results:** **334** frontend tests and **389** backend tests pass. The
  production build is clean; the initial bundle grew by 0.6 kB, and Leaflet
  is still a lazy chunk.
- **Checked in Chrome** against the local app (Docker, your data):
  - At 2560 px: a 946/630 px split, capped at 1600 px, with 2 cards per
    row and the sticky map.
  - Tags and bubbles over Greece.
  - Clicking €66 opened the Rhodes card (photo, heart, close button,
    "New", €66 / night).
  - Hovering each of 4 cards lit the right bubble, and the highlight
    cleared when the mouse left.
  - The tags have names.
  - A "3" bubble zoomed in and split into €169 and a "2".
  - A Kalamata search narrowed the map to its 2 tags.
  - In a 390 px frame: list only with Show map → `?view=map`, a 343×520
    map with 6 tags or bubbles, Show list, and no sideways scroll.
  - No console errors.
  - This check is also what caught the CARTO key problem.

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

### Reviews on past stays (TICKET-032)

On a past (not cancelled) booking card, from the booking's `can_review`
/ `my_review` fields:

- **"How was your stay?" + Leave a review** when `can_review` is true →
  the review dialog (see "Property detail page → The review dialog") →
  snackbar "Thanks - your review is posted." and the list reloads.
- **"✓ You rated this place ★★★★☆"** once the place is reviewed - on
  every past stay there, since it's one review per place.
- Nothing on Upcoming or Cancelled bookings.

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
| `/admin/reviews` | `pages/admin/reviews/` | Every review (hidden too), filters, Hide / Show again; see "Admin reviews" (TICKET-032) |
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

- A left **side nav**: Dashboard, Properties, Bookings, Reviews (TICKET-032),
  with the current page highlighted and marked `aria-current="page"`.
  On phones it's five equal tabs (icon above an 11 px label; "Back to site"
  wraps onto two lines) - checked at 320 px, no sideways scroll.
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
  sleeps, rating ("★ 4.5 (2)" or "New"), **Saved by** (TICKET-033: ♥ N,
  how many guests saved the place - a pink heart when N > 0, a grey ♡ 0
  otherwise; screen readers hear "Saved by 3 guests"; it comes from the
  API's admin-only `favorite_count`), a **status chip** (Active /
  Retired, with retired rows greyed), and actions. On tablets and phones
  (cards) the line under the title ends with "· Saved by 3 guests".
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

## Admin reviews (Angular, TICKET-032)

`/admin/reviews` (`pages/admin/reviews/admin-reviews.ts`, "Reviews" in the
admin nav) - review moderation. It uses `GET /api/admin/reviews/` and
`PATCH /api/admin/reviews/{id}/` (see "Reviews API") through
`core/admin/admin-reviews.service.ts`; the backend's `IsAdminRole` is the
real protection.

- **Filters**, all in the URL (`?status=hidden&rating=1&property=5&search=noisy&page=2`),
  and any change goes back to page 1:
  - **All / Visible / Hidden** toggle
  - a search box (guest name or email, property title, comment text;
    applied 0.3 s after typing stops)
  - Property (all properties, retired ones marked) and Rating (1-5 stars)
- **Table** (12 per page), newest first: Posted, Property (links to its
  public page), Guest (name, email underneath), Rating (stars), Comment
  (two lines, the full text on hover; "No comment" when empty), Status
  chip (**Visible** / **Hidden**), and the action button. Hidden rows are
  greyed.
- **Hide** (red) asks first: "Hide this review? - Maria K.'s 2-star review
  of Harbour Loft will no longer be shown to guests or counted in the
  property's rating. Nothing is deleted - you can show it again any
  time." → PATCH → snackbar "Review hidden from guests." → the list
  refreshes. **Show** does the reverse ("Show this review again?" →
  "Review shown again."). A refusal from the server shows its reason and
  refreshes the list.
- **States:** skeleton rows, "No reviews yet.", "No reviews match these
  filters." + Clear filters, and "Couldn't load the reviews." + Try again.
- **Layout:** laptops (961-1440 px) drop the Posted column and shorten
  emails so the table never scrolls sideways; tablets and phones show one
  card per review (property + status on top, then labelled rows, the
  button at the bottom); on phones Property and Rating sit side by side.

**Checked** in headless Chrome as the demo admin against the real API:
13 reviews listed; search "air conditioning" → 1 row and `?search=` in
the URL; Hide → the property's public summary went from 3.9 / 9 reviews
to 4.1 / 8; Hidden filter → that one review, greyed; Show → back to 3.9 /
9. No sideways scroll at 1280, 768, 390 and 320 px (nor inside the table
at 1280).

**Tests** (10 new, 257 frontend tests in total): URL parsing (junk
dropped), API params, the PATCH body; the table (Visible/Hidden rows,
stars, email, "No comment"); URL filters → API params and the "no match"
state; a filter change → URL + page 1, Clear filters; Hide asks (text,
red button) → PATCH → snackbar → refresh; Keep hidden sends nothing, Show
→ PATCH; a refused change; error + Try again → empty state. The admin
layout test now expects the Reviews item.

## Reviews: final check (TICKET-032)

Run on 28 Sep 2026 on the final `master` (`cc63916`).

**Automated:** all **297 backend tests** pass on Postgres (37 in
`reviews`), `makemigrations --check` is clean; all **257 frontend
tests** pass; the production build is clean (no budget warnings).

**Fresh database:** `migrate` from zero (reviews `0001` + `0002`) and
`seed_demo_data` → every seeded review is backed by an ended, confirmed
stay of that guest.

**Browser regression** (headless Chrome against the real API on that
fresh database; a seeded guest given one ended *confirmed* stay at
property Y and one ended *pending* stay at property X) - **27/27 passed**:

| # | Check | Result |
| --- | --- | --- |
| A1-A3 | Visitor: reviews + summary shown, no Write a review, header rating = card rating | ✅ |
| A4-A5 | No reviews → "No reviews yet" + header "New"; anonymous `POST` → 401 | ✅ |
| B1-B3 | Pending (unpaid) past stay: no button, `POST` → 400 with the rule; guest → admin API 403 | ✅ |
| C1-C2 | Confirmed ended stay: Write a review; rating chosen with the **keyboard** (Space, →) | ✅ |
| C3-C5 | Posted: "You rated this place" replaces the button, new review first (comment trimmed, name not email), header "2.0 · 1 review" | ✅ |
| C6-C9 | After reload still "You rated"; listing card count updated; second review → 400; no edit route | ✅ |
| D1-D3 | My bookings: "You rated" on the stay, nothing on the pending one; guest → `/admin/reviews` → 403 page | ✅ |
| E1-E4 | Admin hides it: public summary + card back to 0; the guest still sees "You rated" and can't post again | ✅ |
| E5-E7 | Hidden filter lists it; Show → back in the summary; admin properties table shows ★ 2.0 (1) | ✅ |

(E7 first failed because of the test itself - the property was on page 2
of the admin table; re-checked with the table's search: passed.)

**Render** (auto-deployed from the pushes): the **Hosted demo check**
workflow run on `cc63916` passed. In Chrome on the live site: the API
answers `/api/properties/{id}/reviews/` with the summary (matching the
card), anonymous `POST /api/reviews/` → 401 and `/api/admin/reviews/` →
401; property 2's page shows the Reviews section (4.0, 2 reviews, per-star
bars) and the header link scrolls to it; `/admin/reviews` exists and
sends a non-admin to "Admins only".

**Render as admin** (the owner logged in as the demo admin, then the checks
ran in that Chrome tab): `/admin/reviews` lists the 5 live reviews with
the Reviews tab active and no sideways scroll; Hidden → "No reviews match
these filters." → Clear filters → 5; search "street" → 2 (URL
`?search=street`); Rating 5 stars → 2; + Property "Quiet House in
Nafplio" → no match (its reviews are 4 stars); browser Back restores the
previous filter. **Hide** on Breezy Villa in Chania (confirm dialog →
Hide review) → the row turned Hidden/greyed with a Show button, the live
API summary and the listing card went from 5.0 / 1 review to none, and
the public page showed "New" + "No reviews yet". **Show** (via the Hidden
filter) → back to 5.0 / 1 review; all 5 live reviews visible again, as
before the test.

## Favorites: final check (TICKET-033)

Run on 28 Sep 2026 on the final `master` (`d841349` for the code; this
section is the only change after it).

**Automated:** all **334 backend tests** pass on Postgres (33 in
`favorites`, 4 seeder tests in `core`), `makemigrations --check` is
clean; all **298 frontend tests** pass; the production build is clean (no
budget warnings).

**Fresh database:** `migrate` from zero (favorites `0001`) and
`seed_demo_data` → ~40 saved places, every guest with 2-5 active ones, the
first guest also with one retired place, the admin with none.

**Browser regression** (headless Chrome against the real API on that
fresh database, 1280 / 768 / 390 / 320 px) - **68/68 passed**:

| Part | Checks | Result |
| --- | --- | --- |
| The heart (step 2) | a heart on every card (44×44, outside the link); visitor → login with the message → back, saved + snackbar; save/remove on cards and the property page stay in sync; reload keeps the server's state; keyboard Space; a tap never opens the stay; place deactivated meanwhile → switches back with the message; phones: no sideways scroll; admin: no hearts - **27** | ✅ |
| Saved page (step 3) | visitor → login → back; tab title + toolbar link current; count, 12 per page + paginator, server order; deactivated place greyed with Remove (no Undo); un-heart → gone at once → Undo → same spot; left alone → still gone after reload; page 2; phones: menu link, Undo bar fits; empty state; admin: no Saved link - **24** | ✅ |
| Admin "Saved by" (step 4) | counts rise with new saves; every row matches the API at 4 widths; column fits at 1280; card line on tablets/phones - **14** | ✅ |
| Seeded data (step 5) | the first guest's Saved page shows the retired place greyed out and first; the admin table shows the seeded counts - **3** | ✅ |

(The step 3 and step 4 scripts first failed on the fresh data because of
the tests themselves - they assumed no other favorites and 14 active
places; after adjusting the scripts, all passed.)

**Render** (auto-deployed from the pushes): the **Hosted demo check**
workflow run on `d841349` passed. The live API answers `/api/favorites/`
and `PUT /api/favorites/1/` with 401 when logged out, and the cards carry
`is_favorite` (no `favorite_count` for guests) - so the migration ran.
The live database isn't re-seeded (`--if-empty`), so it has no seeded
favorites until TICKET-041's one-off re-seed.

**Render in Chrome** (the owner logged in, the checks ran in that tab):

- As the **demo admin:** no hearts on the 12 listing cards, no Saved
  link; admin Properties shows the **Saved by** column (all 0 on the live
  data) and fits without sideways scrolling.
- As a **demo guest** (`guest_0_…`, logged in by the owner): 12 hearts,
  none inside a link, **Saved** in the toolbar; two hearts tapped → filled,
  the page stayed on the listings, still filled after a reload (saved on
  the server); the property page header said **♥ Saved**; the toolbar link
  opened **Saved** ("Saved · Booking System Demo", link marked current):
  "2 saved places", newest first; un-hearting one → gone at once +
  "Removed "…" from saved. Undo" → left alone → still gone after a reload;
  un-hearting the other → the empty state → **Undo** → back, and still
  there after a reload. Finally the test save was removed again, leaving
  the guest with no saved places, as before.

## Payments (Stripe, TICKET-029)

Guests pay for a booking with **Stripe Checkout in test mode** (no real
money - pay with the test card `4242 4242 4242 4242`, any future expiry,
any CVC). Built in steps - data model + settings, the payment hold +
checkout endpoint, the webhook, stale holds + cancelling with a payment
page open, the frontend, webhook forwarding in Docker + the Render setup -
and **tested end to end, locally and on Render**; see "End-to-end results".

### How it will work (agreed design)

1. **Confirm and pay** creates the booking as `pending` exactly as before
   (`POST /api/bookings/`, same overlap checks and race protection).
2. Only once that row is committed, `POST /api/bookings/{id}/checkout/`
   creates a Stripe **Checkout Session** (Stripe's hosted payment page) and
   the guest is redirected there. The session is created with an
   **idempotency key derived from the booking id**, so a double click or a
   network retry can never create a second payment for the same booking.
3. **Stripe's webhook decides**, never the browser: `checkout.session.completed`
   / `async_payment_succeeded` with the money actually paid → booking
   **confirmed**; the session expiring unpaid (or a delayed payment failing)
   → booking **cancelled**, which frees the dates.
4. An unpaid booking **holds its dates for 30 minutes** (the session's
   lifetime). The guest can come back and **Pay now** from My Bookings
   within that window.
5. Bookings without a payment (the seeded ones, or everything when
   payments are switched off) keep the old behaviour: pending until an
   admin confirms.

### Switching payments on

Payments are **off unless `STRIPE_SECRET_KEY` is set** - a fresh clone, the
test suite and CI need no Stripe account at all. To switch them on locally,
put these in `.env` (see `.env.example`):

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | A **restricted key** `rk_test_...` (Stripe recommends it over the full `sk_test_` key); it needs **Checkout Sessions: Write** and, for refunds (TICKET-040), **Charges and Refunds: Write** |
| `STRIPE_CLI_API_KEY` | Your full `sk_test_...` key - only for the local `stripe-cli` webhook forwarder (added in a later step), never on Render |
| `STRIPE_PUBLISHABLE_KEY` | Not used by Stripe's hosted page; harmless to keep |

Then rebuild the backend image once (the `stripe` Python package is new):
`docker compose up -d --build backend`. The container runs `migrate` on
start, which creates the two new tables.

Optional settings (defaults shown): `STRIPE_CHECKOUT_HOLD_MINUTES=30`
(Stripe allows 30 minutes to 24 hours), `FRONTEND_URL=http://localhost:4200`
(where Stripe sends the guest back), `STRIPE_API_VERSION=2026-08-26.dahlia`
(pinned so an account upgrade can't change response shapes), and
`STRIPE_WEBHOOK_SECRET` (Render only - locally the `stripe-cli` service
provides it through `STRIPE_WEBHOOK_SECRET_FILE`).

### Safety checks at startup (`payments/checks.py`)

Django system checks run on `manage.py check`, `runserver` and `migrate` -
and `migrate` runs on every container start and every Render deploy, so a
bad configuration fails loudly:

| Check | Level | When |
| --- | --- | --- |
| `payments.E001` | error | The "secret" key is a publishable key (`pk_...`) |
| `payments.E002` | error | A **live** key (`sk_live_`/`rk_live_`) - this demo only takes test payments. Override only on purpose with `STRIPE_ALLOW_LIVE_KEYS=True` |
| `payments.E003` | error | Doesn't look like a Stripe key at all (e.g. a `whsec_` pasted into the wrong variable) |
| `payments.E004` | error | `STRIPE_CHECKOUT_HOLD_MINUTES` outside Stripe's 30-1440 minutes |
| `payments.W001` | warning | A full-access `sk_test_` key - works, but a restricted key is safer |
| `payments.W002` | warning | Payments on but no webhook secret - no payment could ever confirm a booking |

### Data model (`payments/models.py`)

**`Payment`** - one per booking (`OneToOneField`, `related_name="payment"`):

| Field | Notes |
| --- | --- |
| `booking` | `CASCADE` - follows the booking (and its guest); Stripe keeps the real payment record either way |
| `status` | `open` (awaiting payment, dates held) → `paid`, or `processing` (a delayed method like SEPA, not settled yet) → `paid` / `failed`, or `expired` (session ran out unpaid), or `cancelled` (called off unpaid: the booking was cancelled, or an admin confirmed it by hand) |
| `amount`, `currency` | Snapshot of `Booking.total_price` in `eur` at checkout. `Decimal`, never float; `amount_cents` converts exactly (e.g. `364.10` → `36410`). DB check: `amount > 0` |
| `stripe_checkout_session_id` | Unique |
| `checkout_url` | Stripe's hosted page - reused by **Pay now** until `expires_at` |
| `stripe_payment_intent_id` | Filled in from the webhook once paid; TICKET-040's refunds use it |
| `refund_*` | TICKET-040 - see "Refunds (TICKET-040)" below |
| `expires_at` | End of the Checkout Session = end of the date hold. `is_holding()` = still `open` and not yet expired |
| `paid_at`, `created_at`, `updated_at` | Timestamps |

**`StripeEvent`** - one row per webhook event handled, keyed by Stripe's
event id. Stripe delivers events *at least once*, so the same event can
arrive twice: the webhook will insert this row in the **same transaction**
as the booking/payment update, so a duplicate is skipped, and a failed
attempt rolls back completely and Stripe's automatic retry starts clean.

### The payment hold (starts at booking time)

With payments on, `POST /api/bookings/` creates an **`open` Payment in the
same transaction as the booking** (`payments/services.py:start_hold`). So:

- a booking that loses the double-booking race (409) never gets a payment;
- the hold is measured from the moment of booking: `expires_at` = now + 30
  minutes + 2 minutes of retry slack (explained below);
- no Stripe call happens yet - `stripe_checkout_session_id` stays empty
  until the guest reaches checkout;
- a booking **without** a Payment (seeded, or made while payments were off)
  doesn't take online payment and keeps the admin's manual Confirm.

Every booking response carries a `payment` block (`payments/serializers.py`,
LEFT JOINed into the same query - a bookings page is still 3 queries):
`status`, `amount`, `currency`, `expires_at`, `paid_at`, and `can_pay` -
true only for **the booking's own guest**, while the booking is `pending`
and the hold hasn't run out.

### `POST /api/bookings/{id}/checkout/`

Returns Stripe's hosted payment page for the booking:

```json
{"checkout_url": "https://checkout.stripe.com/c/pay/cs_test_...", "expires_at": "2026-10-01T18:32:00+03:00"}
```

The frontend then redirects the browser there. Only the booking's own
guest can call it - anyone else (admins included) gets `404`, the same as
for any booking that isn't theirs.

**The Checkout Session** (`services.py:session_params`): one line item
"*Loft - 3 nights*" with the dates, guests and location, the amount in
**integer cents** from the stored `Decimal` (e.g. `240.15` → `24015`),
`eur`, `metadata.booking_id` (also on the PaymentIntent and as
`client_reference_id`, so the webhook and the Stripe Dashboard can always
find the booking), the guest's email pre-filled, `expires_at` = the hold's
end, `success_url` / `cancel_url` back to
`FRONTEND_URL/bookings/{id}/payment` (the page arrives with the frontend
step), and `integration_identifier` to tag our sessions in the Dashboard.
**No `payment_method_types`**: Stripe's dynamic payment methods decide what
to offer, configured in the Dashboard. **Adaptive Pricing is switched off**
(`adaptive_pricing.enabled=false`) whatever the Dashboard default: every
guest pays in euros, so the amount and currency the webhook checks are
exactly what we asked for. **Managed Payments is switched off** too
(`managed_payments.enabled=false`): that's Stripe acting as *merchant of
record* (Stripe becomes the seller and handles tax, for an extra 3.5% per
payment), but only for **digital products** - an apartment stay isn't
eligible, and the tax it adds would make the paid total differ from the
booking price, so the webhook would rightly refuse to confirm it. New Stripe
accounts can have it on by default (Stripe Dashboard → Settings → Managed
Payments); our sessions never use it either way.

**Can a guest pay a different amount?** No. The price is computed on the
server (TICKET-015 ignores any client-sent price), the session is created
server-side with the secret key the browser never sees, and Stripe's page
only *displays* the fixed line item - editing it in dev tools changes
nothing Stripe charges. Everything that could change the total (adjustable
quantity, customer-chosen amounts, promotion codes, automatic tax,
shipping) is simply not enabled. The webhook's amount check is a safety
net against our own future changes.

**No double sessions, no double charges.** The Stripe call is made
**outside** any database transaction (no row lock is held while waiting on
the network), in three phases:

1. Lock the booking + payment row, check the booking is payable, and fix
   the exact request - parameters and the idempotency key
   `booking-<id>-checkout-<attempt>` - **only from stored values**. Commit.
2. Call Stripe. (The SDK itself retries dropped connections up to twice,
   with the same key.)
3. Lock again and store the session id, URL and Stripe's `expires_at`.

Because the request in phase 1 is built only from stored values, *every*
repeat - a double click, the guest retrying after a network error, a
response lost on the way back - sends Stripe the **identical** request with
the same key, and Stripe answers with the session it already created
instead of making a second one. That's also why the hold has 2 minutes of
slack: Stripe only accepts `expires_at` at least 30 minutes after the
session is created, so an identical retry stays valid for about 2 minutes.
If a first attempt never produced a session and is retried later than
that, the attempt number goes up (new key, new 30-minute expiry) - the
earlier attempt, if Stripe did create it, was never shown to anyone, so it
can't be paid and expires on its own.

Once a session exists, calling the endpoint again (**Pay now**) simply
returns the same page until it expires - there is never a second session
for a booking.

| Situation | Response |
| --- | --- |
| Booking has no Payment (seeded / payments were off) | `409` `payment_not_required` |
| Booking already confirmed / cancelled | `409` `already_confirmed` / `booking_cancelled` |
| Already paid (or a delayed payment is processing) | `409` `already_paid` |
| The hold ran out | `409` `payment_window_closed` |
| The same request is still in flight at Stripe (a parallel double click) | `409` `checkout_in_progress` - retry in a moment |
| Stripe unreachable / returned an error | `502` `payment_provider_error` (logged); retrying repeats the identical request |
| Payments switched off | `503` `payments_disabled` |
| Cancelled while we were talking to Stripe | `409` `booking_cancelled`, and the new session is **expired immediately** so it can never be paid |

### The webhook: `POST /api/payments/stripe/webhook/`

**This is what confirms a booking** - never the browser coming back from
Stripe. A guest can pay and lose their connection before the success page
loads, and anyone can open a success URL; only an event **signed by
Stripe** proves the money moved.

| Stripe event | Payment | Booking |
| --- | --- | --- |
| `checkout.session.completed`, `payment_status=paid` | `paid` (+ `paid_at`, PaymentIntent id) | `pending` → **`confirmed`** |
| `checkout.session.completed`, `payment_status=unpaid` (a delayed method, e.g. SEPA) | `processing` - the hold stops expiring, nothing more to pay | stays `pending`, dates stay held |
| `checkout.session.async_payment_succeeded` | `paid` | `pending` → **`confirmed`** |
| `checkout.session.async_payment_failed` | `failed` | `pending` → **`cancelled`**, dates free again |
| `checkout.session.expired` (the 30 minutes ran out unpaid) | `expired` | `pending` → **`cancelled`**, dates free again |
| `refund.updated`, `refund.failed`, `charge.refunded` | refund status (TICKET-040 - see "Refund events from Stripe") | - |
| anything else | - | - (acknowledged with `200`, ignored) |

How it's made safe (`payments/views.py`, `payments/webhooks.py`):

- **Signature first.** A plain Django view (not DRF), because Stripe signs
  the *raw* body: `stripe.Webhook.construct_event` checks the
  `Stripe-Signature` header against the signing secret before anything
  else runs. Wrong secret, tampered body, missing header, or a timestamp
  older than 5 minutes (a replay) → `400`, nothing touched. No login and no
  CSRF token - the signature *is* the authentication.
- **The secret** comes from `STRIPE_WEBHOOK_SECRET` (Render) or, locally,
  from the file the `stripe-cli` Docker service writes
  (`STRIPE_WEBHOOK_SECRET_FILE`, read on every request since the CLI may
  start after the backend). None configured → `503` + an error in the log
  (and the `payments.W002` startup warning).
- **Each event handled once.** Stripe delivers events *at least* once. The
  event id goes into `StripeEvent` **in the same transaction** as the
  changes it causes: a repeat delivery hits the primary key and is skipped
  (`{"duplicate": true}`); a *simultaneous* repeat waits for the first
  transaction to commit, then is skipped; and if handling fails, everything
  including the event row rolls back, the response is a `500`, and Stripe's
  automatic retry (for up to 3 days) starts clean.
- **Same locks as checkout.** The booking and payment rows are locked in the
  same order as `POST .../checkout/` (booking first, then payment), and
  every handler checks the current state before changing anything, so it's
  also safe to run twice on its own.
- **Unknown sessions are ignored.** Events are matched by the Checkout
  Session id we stored, never by `metadata.booking_id` alone. That matters
  because one Stripe sandbox serves both copies of the app: the local
  `stripe-cli` forwards Render's events too (and vice versa), and booking
  #12 locally isn't booking #12 on Render.
- **Human decisions win.** A session expiring on a booking an admin already
  confirmed by hand leaves it confirmed. A payment arriving for a booking
  that was cancelled meanwhile is recorded as `paid`, the booking **stays
  cancelled**, and a warning is logged - and since TICKET-040 the full
  amount is **refunded automatically** (REF-11).
- **The amount is checked.** If Stripe ever reported a different amount or
  currency than the booking costs (it can't - the server sets it), the
  booking is **not** confirmed and an error is logged.

### Stale holds: when the "expired" webhook never arrives

If a hold's 30 minutes are up but no webhook came (e.g. the local
`stripe-cli` wasn't running), the booking would sit at `pending` and keep
blocking its dates. It's settled - **never guessed** - by
`payments/services.py:sync_stale_hold`:

- the guest never reached checkout (no session) → it can't have been paid:
  payment `expired`, booking `cancelled`, dates free;
- otherwise **Stripe is asked first**: the session is expired if it's
  somehow still open, or fetched if it's already finished, and its real
  state is applied exactly as the webhook would have - **paid → the booking
  is confirmed and keeps its dates**, expired → released;
- Stripe unreachable → nothing is changed (a paid booking must never lose
  its dates because of a network error).

When it runs:

| Where | Why |
| --- | --- |
| `POST /api/bookings/`, before the overlap check | Someone else wants those dates: stale holds on them are settled first, so they get a `201` instead of a `409` caused by a missed webhook |
| `POST /api/bookings/{id}/checkout/` | The guest's own **Pay now** gets the true answer ("already confirmed" if they did pay at the last second) instead of "time ran out" |
| `python manage.py release_stale_holds` | Settles every stale hold at once - handy after the forwarder was down (`docker compose exec backend python manage.py release_stale_holds`) |

### Cancelling or confirming by hand while a payment page is open

(The complete guest-vs-admin list of every cancel/confirm case is in
"Bookings API" → "Status changes" → "Every case at a glance". Admins have
no deadline; they're only held back by the temporary payment-safety cases
below.)

A pending booking can be cancelled (guest or admin) or confirmed by an
admin while its Stripe page is still open. If nothing else happened, the
guest could then **pay for a cancelled booking**. So `PATCH
/api/bookings/{id}/` now:

1. checks the transition is allowed at all (without a lock) - a refused
   change never touches Stripe;
2. **closes the payment page at Stripe first** (expires the session),
   outside the lock since it's a network call;
3. then, under the row lock as before, re-checks the transition, marks the
   payment `cancelled` and changes the booking.

| Situation | Result |
| --- | --- |
| Page closed at Stripe | `200`; payment `cancelled`. Stripe's own "expired" event for it later changes nothing |
| The guest paid a moment ago (the page can't be closed any more) | `409` `payment_completed` - the payment is recorded **right away** (booking now `confirmed`), not lost. Cancelling a paid booking is still possible afterwards (refund: TICKET-040) |
| A delayed payment is processing at the bank | `409` `payment_processing` (also `can_cancel: false`) - wait until it succeeds or fails |
| Stripe unreachable | `502` `payment_provider_error` - **not cancelled**, because the page might still take money; try again |
| The guest opened the page between step 2 and step 3 | `409` `checkout_just_opened` - nothing changed; try again |
| No payment page yet (never reached checkout) | No Stripe call; payment `cancelled` |
| Payments switched off since the page was made | Can't reach Stripe at all; the change goes ahead (logged) |
| Already paid, then cancelled | `200`; the payment stays `paid` and a **full refund** is sent to Stripe (TICKET-040, see "Refunds") |

### `GET /api/payments/config/`

Public, no login: `{"enabled": true, "hold_minutes": 30, "currency": "eur"}`.
The booking form uses it only for **wording before a booking exists**
("Confirm and pay", "held for 30 minutes"). What actually happens after
booking is decided by the booking's own `payment` block, so a stale or
failed config load can never skip a payment.

### Payments in the frontend (Angular)

**Pieces (`src/app/core/payments/`):** `payment.models.ts` (the `payment`
block, config, checkout response), `PaymentService` (config loaded once - a
failed load counts as "off" and is retried next time; `checkout(id)`),
`countdown.ts` (one ticking clock signal per page, `formatRemaining` →
"24:13", never showing time that's gone), `payment-labels.ts` (one label per
payment state, and `refundDue` = paid then cancelled), `BrowserRedirect`
(leaves for Stripe; replaced in tests). `shared/booking-summary.ts` is the
booking summary card used after booking, so the payments-off confirmation
and the paid confirmation look the same ("Paid" instead of "Total", and
"- full refund" in the policy once paid).

**Booking form, step 2** (`pages/booking/`): with payments on it says
"You'll pay €X securely on Stripe's payment page. Your dates are held for
30 minutes…", the policy line adds "- full refund", and the button is
**Confirm and pay**. Clicking it creates the booking, asks for the payment
page and sends the browser there ("Taking you to secure payment…"). If the
page can't be opened, the screen says the dates are held (with the booking
number and until when) and **Try again only re-asks for the payment page -
it never creates a second booking**. A booking that comes back without a
payment (payments off) gets the classic "Booking request sent" screen.

**Return page `/bookings/:id/payment`** (`pages/payment-return/`, login
required) - where Stripe sends the guest back:

| Arrived with | Booking says | Shows |
| --- | --- | --- |
| `?session_id=…` (paid) | still `open` | "Confirming your payment…", re-reading the booking every 2 s, up to 15 times |
| | `confirmed` + `paid` | "Payment received - you're booked!" + summary |
| | still `open` after 30 s | "Waiting for confirmation" + Check again (e.g. the webhook forwarder isn't running) |
| | `processing` | "Your payment is being processed" |
| `?cancelled=1` (backed out) | `open`, hold running | "Payment not completed", live countdown, **Pay now €X**, **Cancel booking** |
| | hold at 0:00 | "Time ran out" (the countdown flips it on the spot) + Book again with the same dates |
| any | `cancelled` (expired / failed) | "Time ran out" / "Payment failed" - "You weren't charged" + Book again |
| any | `cancelled` after paying | "full refund of €X - the host processes it" |
| any | no online payment / unknown id | → My bookings / "We couldn't find this booking" |

The page never decides a payment worked - only the booking the API returns
(confirmed by the webhook) does.

**My Bookings** (`pages/my-bookings/`): each card shows its payment -
"Awaiting payment · dates held for 24:13" + **Pay now €X** (live, one clock
for the whole page), "Time to pay ran out - the dates are being released",
"Payment processing at your bank", "Paid €X", and in the Cancelled tab
"Time to pay ran out - dates released", "Payment failed", or the refund
line (TICKET-040 - see "Refunds in the frontend"). "Waiting for the host to confirm" is only
for bookings without online payment. The cancel dialog now says what
happens to the money: full refund (back to the card within 5–10 business
days) / payment page closed / nothing to refund.

**Admin bookings** (`pages/admin/bookings/`): a **Payment** column (Paid,
Awaiting payment until 14:32, Processing, Expired, Failed, Waived, Not paid,
the refund chips from TICKET-040 - Refund pending / Refunded / Refund failed
/ Refund due - or "—" for bookings without online payment). Confirming an
unpaid booking warns that it closes the guest's payment page and waives the
payment; cancelling a paid one says it's refunded automatically, and
**Refund now** handles the rest (see "Refunds in the frontend").

### Local webhook forwarding (Docker, `stripe-cli` service)

Stripe can't send webhooks to `localhost`, so `docker-compose.yml` runs
Stripe's own CLI next to the backend:

1. It logs in with **`STRIPE_CLI_API_KEY`** from `.env` (your full
   `sk_test_…` key - the CLI needs it; the backend itself uses the
   restricted `STRIPE_SECRET_KEY`). Without that variable the service just
   idles and prints "Stripe webhook forwarding is OFF".
2. It writes its **webhook signing secret** to a small shared Docker volume
   (`stripe_cli`, mounted read-only into the backend at `/stripe`). The
   backend reads it from `STRIPE_WEBHOOK_SECRET_FILE=/stripe/webhook_secret`
   on every webhook, so there's **nothing to copy into `.env`** and it keeps
   working if the CLI restarts after the backend.
3. It forwards only the seven events the backend handles - the four
   payment ones (`checkout.session.completed`, `…async_payment_succeeded`,
   `…async_payment_failed`, `…expired`) and the three refund ones
   (`refund.updated`, `refund.failed`, `charge.refunded`, TICKET-040) - to
   `http://backend:8000/api/payments/stripe/webhook/`. After pulling a
   change to this list, `docker compose up -d` recreates the service (and
   it shares a fresh signing secret by itself).

If `stripe trigger` fails with "Shipping parameters cannot be used with
Managed Payments", your Stripe account has Managed Payments on by default:
switch it off in the Stripe Dashboard → Settings → Managed Payments (our own
checkout already turns it off per session - see "The Checkout Session").

**Switch it on** (once, after pulling this code):

```bash
docker compose up -d            # pulls stripe/stripe-cli, recreates the backend with the volume
docker compose logs -f stripe-cli
```

The log should show `Webhook signing secret shared with the backend.` and
then `Ready! … Your webhook signing secret is whsec_…`. **Check the whole
chain** without booking anything:

```bash
docker compose exec stripe-cli stripe trigger checkout.session.completed
```

Stripe creates a throw-away test session and completes it; the log shows
`--> checkout.session.completed` and **`<-- [200] POST
http://backend:8000/api/payments/stripe/webhook/`**. A `200` proves the
signature check passed (that session isn't one of our bookings, so the
backend acknowledges and ignores it - rule WH-10). A `400` means the secrets
don't match: `docker compose restart stripe-cli`. A `503` means the backend
has no secret: `docker compose up -d` (the backend needs the volume).

**Ending a hold on purpose** (instead of waiting 30 minutes), for the "time
ran out" test cases: find the session id in Django Admin → Payments, then
`docker compose exec stripe-cli stripe checkout sessions expire cs_test_…`.
Stripe sends `checkout.session.expired`, and the booking is cancelled and
its dates freed (rule WH-06).

**Checking the refund events** (TICKET-040):
`docker compose exec stripe-cli stripe trigger charge.refunded` - Stripe
makes a throw-away charge and refunds it; the log shows `charge.refunded`
(and `refund.updated`) → **`[200]`** (not one of our payments, so the
backend ignores it - rule REF-21). A missed refund webhook is caught up with
`docker compose exec backend python manage.py sync_refunds`.

Note: one Stripe sandbox serves both the local app and Render, so the local
forwarder also receives Render's events (and Render receives local ones).
Each side ignores sessions it didn't create - they're matched by the stored
Checkout Session id, never by booking number (rule WH-10).

### Payments on Render

The code is the same; Render just needs its own key, its own webhook
endpoint in Stripe, and the site URL. **Payments stay off on Render until
both secrets are set**, so deploying this code first is safe.

1. **Restricted key for Render.** Stripe Dashboard (sandbox) → Developers →
   API keys → *Create restricted key* → name `booking-demo-render`,
   **Checkout Sessions: Write** and **Charges and Refunds: Write**
   (TICKET-040), everything else None → copy the `rk_test_…`.
   (A separate key from your local one, so either can be rolled on its own.)
2. **Webhook endpoint.** Stripe Dashboard → Developers → Webhooks → *Add
   destination* (event destination, your account):
   - URL: `https://booking-demo-api.onrender.com/api/payments/stripe/webhook/`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     and for refunds (TICKET-040) `refund.updated`, `refund.failed`,
     `charge.refunded`
   - API version: the latest (the backend pins `2026-08-26.dahlia`)
   - Save, then reveal and copy its **signing secret** `whsec_…` (different
     from the local CLI's).
3. **Render env vars.** Render Dashboard → `booking-demo-api` →
   Environment: set `STRIPE_SECRET_KEY` = the `rk_test_…` from step 1 and
   `STRIPE_WEBHOOK_SECRET` = the `whsec_…` from step 2 (both are declared
   `sync: false` in `render.yaml`, so they only ever live in Render). Save →
   Render redeploys. `FRONTEND_URL` (where Stripe sends guests back) is set
   in `render.yaml` to `https://booking-demo-g4aw.onrender.com`.
4. **Check.** `https://booking-demo-api.onrender.com/api/payments/config/`
   → `"enabled": true`, and the **Hosted demo check** workflow now reports
   "Payments are ON". In Stripe → Webhooks → the endpoint, *Send test event*
   (`checkout.session.completed`) should get a `200`.

**Refunds (TICKET-040) - two extra settings** on top of the above (if
Render is already set up, just edit the existing key and endpoint):

5. **Key permission.** Stripe Dashboard → Developers → API keys → the
   Render key (`booking-demo-render`) → *Edit* → set **Charges and Refunds**
   to **Write** (Checkout Sessions stays Write, everything else None) →
   Save. The key value doesn't change, so Render needs nothing new. Without
   it, cancelling still works but every refund shows **Refund failed** with
   "The Stripe key isn't allowed to create refunds (it needs 'Charges and
   Refunds: Write')" - fix the key, then use **Refund now**.
6. **Webhook events.** Stripe Dashboard → Developers → Webhooks → the Render
   endpoint → *Edit destination* / *Select events* → add
   **`refund.updated`**, **`refund.failed`** and **`charge.refunded`** (keep
   the four `checkout.session.*` ones) → Save. The signing secret stays the
   same. Without them refunds are sent but stay **Refund pending** forever.

`manage.py sync_refunds` needs a shell, which Render's free plan doesn't
offer - that's fine: Stripe retries webhook deliveries for up to 3 days,
and anything left over can be fixed from the admin screen with **Refund
now**. Old bookings cancelled before refunds existed (e.g. #38 on Render,
"Refund due") are refunded only when an admin clicks Refund now on them.

Never put `STRIPE_CLI_API_KEY` (the full `sk_test_` key) on Render - it's
only for the local forwarder. Render's free API sleeps after 15 minutes; if
a webhook arrives while it's waking up and times out, Stripe retries it
automatically (for up to 3 days), and a hold whose webhook never makes it is
settled by the stale-hold check (rules STALE-01…07).

### Trying it

With payments on and the `stripe-cli` service running, book as a guest,
click **Confirm and pay**, and pay with `4242 4242 4242 4242`: the return
page shows "Confirming your payment…" and then "Payment received - you're
booked!" within a few seconds. Without the forwarder it ends at "Waiting
for confirmation". Every rule is listed with a test recipe in "Payments:
business rules & test cases" below.

### Tests (so far)

`payments/tests.py` - 71 tests (Stripe is always mocked; the suite never
calls it):

- **Model and settings (16):** cents conversion, one payment per booking,
  unique session id, `amount > 0`, `is_holding()` at the exact expiry
  moment, cascade with the booking, duplicate event ids rejected, and every
  startup check.
- **Hold (4):** booking creates an `open` hold with the exact amount and a
  32-minute expiry and no Stripe call; a booking that loses the race gets
  no payment; payments off → no hold and `payment: null`; `can_pay` false
  for an admin looking at someone else's booking.
- **Checkout (12):** the exact Stripe request (key, cents, currency,
  metadata, URLs, expiry, no `payment_method_types`); Stripe's expiry
  stored; Pay now reuses the page with no second session; a retry after a
  network error sends the **identical** request; a late retry moves to
  attempt 2 with a valid expiry; parallel duplicate → `409`; only the
  owner (others and admins `404`, anonymous `401`); unpayable states; the
  booking cancelled mid-call → session expired; payments off → `503`; the
  bookings list stays at 3 queries.
- **Webhook (19):** built with **real Stripe signatures** (HMAC-SHA256 over
  `timestamp.body`, exactly as Stripe signs), so the verification code runs
  for real:
  - security: missing / wrong-secret / garbage / 1-hour-old signatures and
    a body changed after signing → `400` with nothing changed; no secret →
    `503`; the secret read from the stripe-cli file; GET → `405`; works
    without login or CSRF
  - events: paid → confirmed (and the guest's `can_pay` goes false); a
    duplicate delivery changes nothing the second time; delayed payment →
    processing → paid, or → failed with the dates bookable again; expired →
    cancelled and rebookable; expired after an admin confirmed → still
    confirmed; expired after paid → nothing; paid after cancelled → stays
    cancelled + refund warning; amount mismatch → not confirmed; unknown
    session and unrelated event types ignored; a handler crash rolls back
    the event row, and Stripe's retry then succeeds
  - **concurrency:** two simultaneous deliveries of the same event, on
    separate DB connections → the handler runs **exactly once**, one
    `handled`, one `duplicate` (passed 6 runs out of 6)

- **Step 5 (2):** `GET /api/payments/config/` on/off, public, no key.
- **Step 4 (18):** Adaptive Pricing off in the request; stale holds -
  without a session released with no Stripe call, expired at Stripe →
  released and rebookable, **actually paid → confirmed and keeps its
  dates**, Stripe unreachable → untouched, a live hold never touched, Pay
  now on a stale paid hold → `already_confirmed`, the management command;
  status changes - guest cancel and admin confirm close the page first (and
  the later "expired" event is a no-op), paid just before cancelling →
  `409` + confirmed, delayed payment just started / processing → `409`,
  Stripe down → `502` and not cancelled, no page → no Stripe call, a refused
  change never calls Stripe, page opened mid-cancel → `409`, cancelling a
  paid booking keeps the payment, payments switched off.

The full backend suite (174 tests) passes on Postgres.

**Frontend (33 new Vitest tests, 200 in total, all passing; production
build clean):** countdown helpers, payment labels, `PaymentService` (config
cached, failure not cached, checkout POST), the booking form (step 2
wording, Confirm and pay → one booking → Stripe, Try again reuses the
booking, double click, payments off), the return page (every phase of
`phaseFor`, polling until confirmed, giving up after 30 s, processing,
backed out with countdown + Pay now, the countdown reaching zero, Pay now
refused, cancel, released/refund states, no payment, not found), My
Bookings (countdown + Pay now, refused Pay now, stale hold, paid /
processing / refund / expired / failed lines, the cancel dialog's money
text) and admin bookings (Payment column chips, the confirm "waived"
warning, the cancel money note, a "payment just went through" refusal).

## Payments: business rules & test cases (TICKET-029)

Every rule of the booking + payment flow, numbered so each one can be
tested on its own - by the automated suites, and by hand in the end-to-end
run (TICKET-029 step 7, locally and on Render). **"Auto"** names the
automated test that covers it (backend `backend/payments/tests.py` /
`backend/bookings/tests.py`, frontend `*.spec.ts`). **"E2E"** marks the cases
to run by hand with real Stripe test payments.

**Stripe test cards** (any future expiry, any CVC, any postcode):

| Card | Behaviour |
| --- | --- |
| `4242 4242 4242 4242` | Pays successfully |
| `4000 0025 0000 3155` | Asks for 3-D Secure authentication first, then pays |
| `4000 0000 0000 9995` | Declined (insufficient funds) - Stripe shows the error on its page; the session stays open, so the guest can try another card |

Stripe's `stripe-cli` can also end a session on purpose, which is how the
"time ran out" cases are tested without waiting 30 minutes:
`docker compose exec stripe-cli stripe checkout sessions expire <cs_test_...>`
(the session id is in Django Admin → Payments). *(The `stripe-cli`
service arrives with the Docker step.)*

### 1. Configuration and safety

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| CFG-01 | With no `STRIPE_SECRET_KEY`, payments are **off** and booking works exactly as before | Empty the key, restart, book | `GET /api/payments/config/` → `enabled: false`; booking `payment: null`; form says "Confirm booking"; "Waiting for the host to confirm" | `HoldAtBookingTests.test_payments_off_means_no_hold`, `PaymentsConfigTests.test_off_and_public`, booking.spec "classic confirmation screen" | |
| CFG-02 | Wrong or dangerous keys stop the app at startup | Put `sk_live_…` / `pk_…` / `whsec_…` in `STRIPE_SECRET_KEY`; `manage.py check` | errors `payments.E002` / `E001` / `E003`; a hold outside 30-1440 min → `E004`; full `sk_test_` key → warning `W001`; no webhook secret → warning `W002` | `StripeSettingsCheckTests` | |
| CFG-03 | The config endpoint is public and never exposes a key | `GET /api/payments/config/` logged out | `{"enabled", "hold_minutes", "currency"}` only | `PaymentsConfigTests` | |
| CFG-04 | Guests always pay in **euros** (Adaptive Pricing off), so the checked amount is exact | Inspect the Stripe request | `adaptive_pricing.enabled = false`; currency `eur` | `CheckoutEndpointTests.test_creates_session_with_exact_request` | |
| CFG-05 | **We are the seller**: Managed Payments (Stripe as merchant of record - digital products only, stays aren't eligible, +3.5% fee, adds tax) is always off for our sessions, whatever the account default | Inspect the Stripe request; pay with 4242 | `managed_payments.enabled = false`; the charged total equals the booking price | `CheckoutEndpointTests.test_creates_session_with_exact_request` | ✓ |

### 2. Booking and the 30-minute hold

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| HOLD-01 | Booking (payments on) creates the booking `pending` **plus** an `open` payment in the same transaction; the hold runs from the moment of booking | Book a stay | payment `open`, amount = total (exact cents), `expires_at` ≈ now + 32 min (30 + 2 min retry slack); no Stripe call yet | `HoldAtBookingTests.test_booking_starts_an_open_hold` | ✓ |
| HOLD-02 | A booking that loses the double-booking race gets **no** payment | Book overlapping dates | `409`, still one payment | `HoldAtBookingTests.test_losing_the_race_creates_no_payment` | |
| HOLD-03 | While the hold runs, the dates are **taken** for everyone else | Second guest tries the same dates | `409` "no longer available" | `StaleHoldTests.test_live_hold_is_not_touched` | ✓ |
| HOLD-04 | Seeded bookings / bookings made while payments were off have **no** payment and keep the manual flow | Look at a seeded booking | `payment: null`; admin Confirm works as before; Payment column shows "—" | `test_bookings_without_a_payment_are_not_payable`, admin spec "Payment column" | ✓ |
| HOLD-05 | The **price is decided by the server** (nights × nightly price); the guest can't change what Stripe charges | Send a different price / edit the Stripe page | ignored; Stripe charges the stored amount | `CreateBookingTests.test_create_computes_price_and_starts_pending`, exact-request test | |

### 3. The payment page (checkout)

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| CHK-01 | Only the booking's **own guest** can open its payment page | Other guest / admin / logged out call `POST /api/bookings/{id}/checkout/` | `404` / `404` / `401` | `test_only_the_bookings_guest_can_pay` | |
| CHK-02 | The Stripe request is complete and exact | Inspect it | one line item "Title - N nights", amount in integer cents, `eur`, `booking_id` metadata (session, PaymentIntent, `client_reference_id`), guest email, `expires_at` = hold end, success/cancel URLs to `/bookings/{id}/payment`, **no** `payment_method_types` | `test_creates_session_with_exact_request`, `test_expiry_is_taken_from_stripe` | |
| CHK-03 | **One payment page per booking**: Pay now returns the same page until the hold ends | Back out on Stripe, press Pay now | same Stripe URL; Stripe was asked once | `test_pay_now_reuses_the_same_page` | ✓ |
| CHK-04 | A retry after a network error sends Stripe the **identical** request with the same idempotency key `booking-<id>-checkout-<n>` - never a second session | Stripe unreachable, then retry | `502` `payment_provider_error`, then success with identical params/key | `test_retry_after_a_failure_repeats_the_identical_request` | |
| CHK-05 | A retry later than 2 minutes after a failed first attempt starts attempt 2 with a fresh 30-minute expiry | Make the stored expiry < 30.5 min away with no session | key `…-checkout-2`, `expires_at` ≥ 30 min away | `test_late_retry_starts_a_fresh_attempt` | |
| CHK-06 | A parallel duplicate click gets a friendly answer | Stripe returns an idempotency conflict | `409` `checkout_in_progress` | `test_parallel_duplicate_gets_a_friendly_409` | |
| CHK-07 | States that can't be paid are refused with a reason | Try to pay a confirmed / cancelled / paid / processing / expired booking | `409` `already_confirmed` / `booking_cancelled` / `already_paid` / `already_paid` / `payment_window_closed`; no payment → `payment_not_required`; payments off → `503` `payments_disabled` | `test_states_that_cant_be_paid`, `test_bookings_without_a_payment_are_not_payable`, `test_payments_switched_off_at_checkout` | |
| CHK-08 | A booking cancelled **while** its payment page was being created never keeps a payable page | Cancel during the Stripe call | `409` `booking_cancelled`; the new session is expired immediately | `test_cancelled_while_talking_to_stripe` | |

### 4. What Stripe's webhook does

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| WH-01 | Only events **signed by Stripe** are accepted | Post a fake / tampered / 1-hour-old event | `400`, nothing changes | `WebhookSecurityTests` | |
| WH-02 | Without a signing secret nothing can be confirmed | Remove the secret | `503` + error log; locally the secret comes from the stripe-cli file | `test_no_secret_configured`, `test_secret_from_the_stripe_cli_file` | |
| WH-03 | **Paid → booking confirmed** (never by the success page) | Pay with 4242 | payment `paid` (+ `paid_at`, PaymentIntent id), booking `confirmed`, `can_pay` false | `test_paid_confirms_the_booking` | ✓ |
| WH-04 | Each event is handled **once**, even if delivered twice or twice at the same moment | Resend an event from the Stripe Dashboard | `{"duplicate": true}`, no change | `test_duplicate_delivery_is_handled_once`, `WebhookConcurrencyTests` | ✓ (resend) |
| WH-05 | Delayed methods (e.g. SEPA): completed-but-unpaid → `processing` (dates stay held); then succeeded → confirmed, or failed → cancelled and dates freed | SEPA test IBAN, if enabled in the Dashboard | as described | `test_delayed_payment_then_success`, `test_delayed_payment_then_failure_frees_the_dates` | |
| WH-06 | **Time ran out → booking cancelled, dates free** | Let the hold expire (or expire the session via stripe-cli) | payment `expired`, booking `cancelled`, dates bookable again | `test_expired_releases_the_dates` | ✓ |
| WH-07 | An admin's manual confirm wins over a later expiry | Admin confirms, session expires later | booking stays `confirmed` | `test_expired_after_admin_confirmed_keeps_it_confirmed` | |
| WH-08 | Money arriving for a booking cancelled meanwhile: booking **stays cancelled**, payment recorded `paid`, and (TICKET-040) **refunded automatically** | (rare race) | warning logged; refund `pending` (REF-11) | `test_paid_after_cancelled_stays_cancelled_and_is_refunded` | |
| WH-09 | A different charged amount/currency is **never** confirmed | (can't happen by design) | booking stays `pending`, error logged | `test_amount_mismatch_is_never_confirmed` | |
| WH-10 | Events for sessions we don't know are ignored (local and Render share one sandbox) | Pay on Render while local stripe-cli runs | local ignores it (`200`), nothing changes | `test_unknown_session_is_ignored`, `test_unrelated_event_types_are_acknowledged_only` | ✓ |
| WH-11 | A crash while handling rolls everything back so Stripe's retry works | Force an error | `500`, event not marked handled; retry confirms | `test_failure_rolls_back_so_stripe_can_retry` | |

### 5. Holds whose webhook never arrived ("stale holds")

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| STALE-01 | A hold that never reached checkout is released when its time is up and someone books those dates | Book, don't pay, stop stripe-cli, wait 32 min, book the same dates as another guest | `201`; old booking `cancelled`, payment `expired`; Stripe not asked | `test_hold_without_session_is_released_directly` | |
| STALE-02 | With a payment page: **Stripe is asked first**; expired there → released | as above, after opening the payment page | `201`; old booking released | `test_hold_expired_at_stripe_is_released` | |
| STALE-03 | Stripe says it **was paid** → the booking is **confirmed and keeps its dates** | Pay at the last second with the webhook down | other guest `409`; booking `confirmed`, `paid` | `test_hold_that_was_actually_paid_keeps_its_dates` | |
| STALE-04 | Stripe unreachable → nothing is released | | other guest `409`, hold untouched | `test_stripe_unreachable_leaves_the_hold_alone` | |
| STALE-05 | Pay now on a stale hold tells the truth | Pay now after paying (webhook missed) | `409` `already_confirmed`, booking confirmed | `test_pay_now_on_a_stale_hold_tells_the_truth` | |
| STALE-06 | `manage.py release_stale_holds` settles all of them at once | Run it | "Settled N stale hold(s)" | `test_management_command_settles_all_stale_holds` | ✓ |

### 6. Cancelling and confirming (with online payments)

The complete guest-vs-admin matrix is in "Bookings API" → "Status changes"
→ "Every case at a glance". Policy: **guests** cancel free (with a **full
refund** if paid) until **48 hours before 15:00 on check-in day**, never
after; **admins** have no deadline; **cancelled is final** for everyone.

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| CAN-01 | Guest cancels while the payment page is open → the page is **closed at Stripe first** | Book, back out of Stripe, Cancel booking | `200`; booking + payment `cancelled`; the old Stripe tab can no longer pay; the later "expired" event changes nothing | `test_guest_cancel_closes_the_payment_page_first` | ✓ |
| CAN-02 | Admin confirms an unpaid booking → payment page closed, payment **waived** | Admin → Confirm (warning shown) | booking `confirmed`, Payment "Waived" | `test_admin_confirm_by_hand_closes_the_payment_page`, admin spec "warns … waived" | ✓ |
| CAN-03 | Guest paid a moment before a cancel → refused, and the payment is recorded right away | Pay, then cancel in another tab before the webhook | `409` `payment_completed`; booking `confirmed` | `test_cancel_just_after_the_guest_paid` | |
| CAN-04 | While a delayed payment is processing nobody can cancel | | `409` `payment_processing`; `can_cancel: false` | `test_no_cancelling_while_a_payment_is_processing` | |
| CAN-05 | Stripe unreachable with a page open → not cancelled | | `502` `payment_provider_error` | `test_stripe_unreachable_means_no_cancel` | |
| CAN-06 | Payment page opened during the cancel → retry | | `409` `checkout_just_opened` | `test_payment_page_opened_mid_cancel` | |
| CAN-07 | No payment page yet → no Stripe call | Book, cancel before paying | `200`, payment `cancelled` | `test_cancel_before_checkout_needs_no_stripe` | |
| CAN-08 | A change that isn't allowed never touches Stripe | Guest tries to confirm | `400`, Stripe not called | `test_refused_change_never_touches_stripe` | |
| CAN-09 | **Paid then cancelled** (before the deadline) → payment stays `paid` = **full refund due**. Since TICKET-040 the refund is sent to Stripe automatically (REF-01) | Pay, then cancel | booking `cancelled`; guest sees "Refund of €X on its way…" then "Refunded €X on …"; admin chip "Refund pending" → "Refunded" (REF-31, REF-34) | `test_cancelling_a_paid_booking_keeps_the_payment`, labels spec | ✓ |
| CAN-10 | Guest deadline: 48 h before 15:00 check-in; after it only an admin can cancel | Cancel a booking < 48 h away | guest `400` "Online cancellation closed…"; admin `200` | `StatusTransitionTests.test_guest_cancellation_closes_48h_before_check_in` | |
| CAN-11 | Payments switched off with a page still open → cancel goes ahead | | `200` (logged) | `test_payments_switched_off_with_a_page_open` | |

### 7. Screens (frontend)

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Step 2 explains the payment before booking | Book → Continue | "Confirm and pay"; "You'll pay €X securely on Stripe…held for 30 minutes…"; "Free cancellation until … - full refund" | booking.spec "step 2 says what will happen" | ✓ |
| UI-02 | Confirm and pay: one booking → Stripe page | Click (twice) | one `POST /bookings/`, one checkout call, browser on Stripe | booking.spec "Confirm and pay…", "double click" | ✓ |
| UI-03 | Payment page can't be opened → dates held, **Try again reuses the same booking** | Stripe unreachable | "Your dates are held - payment not started", #id, held until HH:MM; Try again → no second booking | booking.spec "Try again reuses the SAME booking" | |
| UI-04 | Back from Stripe after paying → "Confirming your payment…" (re-reads every 2 s) → "Payment received - you're booked!" with the summary (Paid, full-refund policy) | Pay with 4242 | as described, usually within seconds | payment-return.spec "after paying…" | ✓ |
| UI-05 | No confirmation within 30 s → "Waiting for confirmation" + Check again | Pay with stripe-cli stopped | as described; polling stops | payment-return.spec "no confirmation within 30 s" | ✓ |
| UI-06 | Delayed payment → "Your payment is being processed" | SEPA | as described | payment-return.spec "delayed payment" | |
| UI-07 | Backed out of Stripe → "Payment not completed", **live countdown**, Pay now €X, Cancel booking; at 0:00 → "Time ran out", Book again (keeps the dates) | Press ← on Stripe's page | as described | payment-return.spec "backed out…", "countdown reaching zero" | ✓ |
| UI-08 | Pay now / Cancel refused by the server → the reason is shown and the booking reloaded | Pay now after the hold ended | message + new state | payment-return.spec "Pay now refused", my-bookings.spec "Pay now refused" | |
| UI-09 | Return page for other states | Open `/bookings/{id}/payment` | failed / time ran out / cancelled ("You weren't charged" or "full refund of €X"); booking without payment → My bookings; unknown id → "couldn't find this booking" | payment-return.spec | |
| UI-10 | My Bookings shows the payment on every card | Open My bookings | Awaiting payment + countdown + Pay now; "Time to pay ran out"; processing; "Paid €X"; Cancelled tab: expired / failed / "Full refund of €X"; "Confirmed by the host" for waived | my-bookings.spec "online payments" | ✓ |
| UI-11 | The cancel dialog says what happens to the money | Cancel a paid / unpaid-open / no-payment booking | "full refund of €X" / "payment page will be closed" / "nothing to refund" | my-bookings.spec "CancelBookingDialog" | ✓ |
| UI-12 | Admin bookings: **Payment** column + warnings | Open Admin → Bookings | chips Paid / Awaiting payment (until HH:MM) / Processing / Expired / Failed / Waived / Not paid / **Refund due** / "—" (refund chips: REF-34); Confirm on unpaid warns "payment waived"; Cancel on paid says it's refunded automatically (REF-37); server refusals in a snackbar | admin-bookings.spec | ✓ |

### End-to-end results - Render (26 Sep 2026)

The same flow on the hosted demo (`booking-demo-g4aw.onrender.com` + the
API on Render, Stripe webhook endpoint → `…/api/payments/stripe/webhook/`,
its own restricted key), property "Spacious Loft in Mykonos" (€212/night).
The guest typed the logins and test cards; everything else was driven and
checked in Chrome. **All passed.**

| Round | What we did | Cases | Result |
| --- | --- | --- | --- |
| R1 | Confirm and pay, card 4242 (twice: #38, #40) | UI-01, UI-02, WH-03, CFG-05 | ✅ Step 2 wording incl. "about 30 minutes" and "full refund"; "Payment received - you're booked!", **Paid €424** - the Render webhook endpoint + secret work |
| R2 | Backed out, Pay now, backed out, Cancel booking (#39) | UI-07, CHK-03, CAN-01, UI-11 | ✅ Countdown; the same Checkout Session on Pay now; dialog "payment page will be closed"; Stripe link → "You're all done here"; the cancelled screen shows no policy line (the local-run fix is live) |
| R3 | 3-D Secure card `4000 0025 0000 3155` (#41) | - | ✅ Test challenge → Complete → confirmed, Paid €424 |
| R4 | Guest cancelled paid #38; left #42 unpaid; admin confirmed #42 | CAN-09, UI-10, UI-11, UI-12, CAN-02 | ✅ "full refund of €424" / "Full refund of €424 - processed by the host"; admin: #40, #41 **Paid**, #38 **Refund due**, #39 **Not paid**; "…payment is waived" warning → #42 **Confirmed · Waived** |
| R5 | Local `stripe-cli` log while testing Render | WH-10 | ✅ All five Render events (3 completed, 2 expired) also reached the local forwarder → `[200]`, and the local backend ignored them (not its sessions) - local bookings unchanged |
| R6 | GitHub **Hosted demo check** workflow | - | ✅ Green (`/api/payments/config/` → `"enabled": true`) |

Stripe settings checked in the Dashboard: Managed Payments **inactive** and
off by default (its tax and refund-request settings only apply when it's on).

### End-to-end results - local (26 Sep 2026)

Run by hand in Chrome against the Docker setup (`stripe-cli` forwarding
webhooks), with Stripe test cards, as seeded guest `guest_4_rick71` and the
demo admin. **All passed**; the two issues found are fixed (below).

| Round | What we did | Cases | Result |
| --- | --- | --- | --- |
| 1 | Booked a stay, **Confirm and pay** (clicked twice), paid with 4242 | UI-01, UI-02, HOLD-01, CFG-05, UI-04, WH-03 | ✅ One booking (#58); Stripe page €364.00 with the email pre-filled; back → "Confirming…" → **"Payment received - you're booked!"**, Paid €364, full-refund policy |
| 2 | Checked the dates of a running hold | HOLD-03 | ✅ API reports them taken (`is_available: false`) |
| 3 | Backed out on Stripe (←), then **Pay now** (from the return page and from My Bookings) | UI-07, CHK-03, UI-10 | ✅ "Payment not completed" with a live countdown; Pay now opened the **same** Checkout Session every time |
| 4 | Cancelled a booking whose Stripe page was still open | CAN-01, UI-11 | ✅ Dialog "Your payment page will be closed"; the old Stripe link now says "You're all done here… timed out"; Stripe's later `expired` event changed nothing |
| 5 | Admin confirmed an unpaid booking (#62) | CAN-02, UI-12 | ✅ Warning "…the payment is waived"; row **Confirmed · Waived**; the guest's Stripe link can no longer pay |
| 6 | Guest cancelled the **paid** booking #58 | CAN-09, UI-10, UI-11, UI-12 | ✅ Dialog "full refund of €364"; Cancelled tab "Full refund of €364 - processed by the host"; admin chip **Refund due** |
| 7 | `stripe checkout sessions expire …` on an open hold (#63) | WH-06 | ✅ `checkout.session.expired` → `[200]`; **Cancelled · Expired**, dates free |
| 8 | `stripe events resend` of that same event | WH-04 | ✅ Delivered again (`[200]`), nothing changed |
| 9a | *Unplanned:* the computer slept for hours with two holds open (#60, #61); their `expired` events were never forwarded | STALE-02, STALE-06 | ✅ Still `pending` afterwards (as expected); `manage.py release_stale_holds` → "Settled 2 stale hold(s)" after asking Stripe → **Cancelled · Expired** |
| 9b | Stopped `stripe-cli`, paid #65 with 4242 | UI-05 | ✅ "Confirming…" for 30 s, then **"Waiting for confirmation"** + Check again - the booking stayed `pending` (the browser is never trusted) |
| 9c | Started `stripe-cli`, re-sent the missed `checkout.session.completed` | WH-03, WH-04 | ✅ `[200]`; Check again → "Payment received - you're booked!" |
| 10 | Declined card `4000 0000 0000 9995`, then 3-D Secure card `4000 0025 0000 3155` on the same page | - | ✅ Stripe showed "declined - insufficient funds" and kept the page payable; the 3-D Secure test challenge → *Complete* → #64 confirmed |

**Found and fixed during the run:**

- A **cancelled** booking's summary card still said "Check-in is less than
  48 hours away, so this booking can't be cancelled online". The
  cancellation policy line is now hidden for cancelled bookings
  (`shared/booking-summary.ts`, new `booking-summary.spec.ts`).
- The countdown starts at about 31-32 minutes (the hold includes 2 minutes
  of retry slack) while step 2 said "held for 30 minutes" - it now says
  "held for **about** 30 minutes".
- Environment finding: the Stripe sandbox had **Managed Payments** on by
  default, which broke `stripe trigger`; our sessions now always turn it off
  (CFG-05) and it was switched off in the Dashboard too.

## Refunds (TICKET-040)

**Policy (agreed):** cancelling a booking that was **paid** always refunds
the **full amount**. Guests can only cancel before the 48-hour deadline
(TICKET-015), so every guest cancellation that reaches this point is
refundable; **admins** can cancel any time and it is always a full refund.
Money that arrives **after** a booking was cancelled (e.g. a delayed
payment that settled late) is refunded automatically too. There are no
partial refunds or fees.

**Build steps:**

1. Model + refund logic + hook into the cancel - **done**.
2. Webhook refund events (`refund.updated`, `refund.failed`,
   `charge.refunded`), the admin **Refund now** endpoint and the
   `sync_refunds` command - **done**.
3. Frontend: guest texts, admin chips and the Refund now button - **done**.
4. Docker `stripe-cli` events + Render settings + docs - **done** (see
   "Local webhook forwarding" and "Payments on Render" → Refunds).
5. Local end-to-end run → push → Render end-to-end run - **done**, both
   passed (see "Refunds: end-to-end results").

### Refund fields on `Payment` (migration `payments/0004_refunds.py`)

The refund is tracked **beside** the payment: the payment itself stays
`paid` (the guest did pay), and these fields say where the money back is.

| Field | Notes |
| --- | --- |
| `refund_status` | `none` (default) → `pending` (asked for, not confirmed yet) → `refunded`, or `failed` |
| `refund_amount` | Always the full `amount` |
| `stripe_refund_id` | Stripe's `re_...` id once Stripe accepted the request |
| `refund_attempt` | Part of the idempotency key `booking-<id>-refund-<attempt>`; goes up only when Stripe created a refund that then **failed**, so a retry is a genuinely new refund |
| `refund_requested_at`, `refunded_at` | Timestamps (`refunded_at` is set by the webhook, step 2) |
| `refund_failure_reason` | Why it failed - shown to **admins only** |

### How a refund happens (`payments/refunds.py`)

Two halves, like checkout:

1. **`request_refund(payment)`** runs **inside** the transaction that
   cancels the booking, with the booking and payment rows locked. If the
   payment is `paid` and no refund is already `pending`/`refunded`, it sets
   `refund_status = pending`, the full amount and the request time. It
   returns whether a refund needs sending - so a double click or a second
   cancel can never start a second refund.
2. **`send_refund(booking_id)`** runs **after** that transaction has
   committed, with **no DB lock held** while talking to Stripe. It calls
   `client.v1.refunds.create(params={payment_intent, reason:
   "requested_by_customer", metadata: {booking_id, payment_id,
   refund_attempt}},
   options={"idempotency_key": "booking-<id>-refund-<attempt>"})` - no
   `amount`, so Stripe refunds the whole PaymentIntent. It stores the
   returned `re_...` id and **never raises**.

Stripe's answer is **not** taken as "refunded" - the webhook confirms it
(step 2), the same principle as payments. The cancellation is **never
blocked or rolled back** because of Stripe: if the refund can't be sent,
the booking is still cancelled and the refund is marked `failed`:

| What went wrong | Stored reason (admin only) | Attempt | Retry |
| --- | --- | --- | --- |
| Stripe unreachable, or an unclear answer (5xx, `409` request in progress, `429` rate limit) | "Couldn't reach Stripe" / Stripe's message | same | identical request, same key - if Stripe did create it the first time it just returns it |
| Key lacks the refund permission | "…needs 'Charges and Refunds: Write'" | **+1** | new key, after fixing the key (Stripe replays a stored refusal for the old key) |
| The key is an **agent** key (Stripe answers `403 approval_required`) | "Stripe is holding this refund for human approval - the Stripe key is an agent key…" | **+1** | new key, after switching to a normal restricted key |
| Stripe refused the request (any other 4xx, e.g. expired key, already refunded) | Stripe's message | **+1** | new key |
| Payments switched off | "Online payments are switched off…" | same | same key |
| No PaymentIntent recorded | "No Stripe payment is recorded for this booking." | same | - (Stripe isn't called) |
| Stripe created the refund but reports it `failed`/`canceled` (e.g. the card was closed) | Stripe's `failure_reason` | **+1** | a **new** refund with a new key |

Where it's triggered:

- **`PATCH /api/bookings/{id}/`** with `status: cancelled` (guest or admin):
  `request_refund` inside the locked transaction, `send_refund` right after
  it. The response already shows the refund block.
- **Webhook**, a payment that completes for a booking that was already
  cancelled: the booking stays cancelled, the payment is recorded as `paid`,
  a warning is logged ("paid after being cancelled - refunding it") and the
  refund is sent once the webhook's transaction commits
  (`transaction.on_commit`).

### Refund in the API

Every booking's `payment` block now has a `refund` entry - `null` when
there's no refund:

```json
"payment": {
  "status": "paid", "amount": "364.00", "currency": "eur", "...": "...",
  "refund": {
    "status": "pending",
    "amount": "364.00",
    "requested_at": "2026-09-27T09:00:00Z",
    "refunded_at": null,
    "failure_reason": null
  }
}
```

`failure_reason` is included **for admins only**; guests just see the
status (the screens will say "the host is arranging your refund"). Admins
also get `can_refund` (see "Refund now" below).

### Refund events from Stripe (the webhook, step 2)

The same webhook endpoint (`POST /api/payments/stripe/webhook/`, same
signature check and event de-duplication) now also handles three refund
events. They're matched to a booking by its **PaymentIntent**; a
PaymentIntent we don't know (e.g. the other copy of the app - local and
Render share one Stripe sandbox) is ignored.

| Stripe event | What changes |
| --- | --- |
| `refund.updated` / `refund.failed` for **our** refund, status `succeeded` | refund → **`refunded`** (+ `refunded_at`, amount) |
| same, status `failed` / `canceled` (can even come *after* it succeeded, e.g. a closed card) | refund → **`failed`** with Stripe's `failure_reason`, attempt **+1** (the next try is a new refund), `refunded_at` cleared |
| same, status `pending` / `requires_action` | only stores the refund id if it wasn't stored yet |
| `charge.refunded`, fully refunded | refund → **`refunded`**. This also catches a refund made **by hand in the Stripe Dashboard**: it's recorded (warning logged), and if the booking isn't cancelled a second warning says so - the booking itself is the host's call |
| `charge.refunded`, partly refunded | warning logged, nothing tracked (this app only makes full refunds) |

"**Our** refund" = its id is the one we stored, or - if the webhook beats
us to storing it - its metadata carries this payment's id **and** the
current `refund_attempt` (so a late event from an older, failed attempt
can't settle the new one). Two ordering guards: a `charge.refunded` that
arrives **after** Stripe already said our refund failed is ignored (events
can arrive out of order); and a later failure of a Dashboard refund (no id
of ours) still marks it `failed`.

### "Refund now": `POST /api/bookings/{id}/refund/` (admin)

Starts or retries the full refund of a **cancelled, paid** booking and
answers with the booking (its `payment.refund` is then `pending`, or
`failed` again with the new reason). Guests get `403`.

| Refund now is… | When |
| --- | --- |
| allowed | cancelled + paid, and the refund **never started** (e.g. cancelled before refunds existed - the old "Refund due" bookings), **failed**, or is **pending but was never sent** (the send was interrupted) |
| `409` `not_paid` | not paid online |
| `409` `not_cancelled` | the booking isn't cancelled |
| `409` `refund_in_progress` | sent to Stripe, waiting for its confirmation |
| `409` `already_refunded` | done |

It can never refund twice: a retry after "couldn't reach Stripe" repeats
the same idempotency key, and only a refund **Stripe itself** failed moves
to a new key. For admins, every booking's `payment` block has
**`can_refund`** (always `false` for guests), which the admin screen uses to
show the button.

### `manage.py sync_refunds`

For when something was missed (the Docker `stripe-cli` was off, the
computer slept, Render was restarting):

```bash
docker compose exec backend python manage.py sync_refunds             # send + sync + retry failed
docker compose exec backend python manage.py sync_refunds --no-retry  # don't retry failed ones
docker compose exec backend python manage.py sync_refunds --backlog   # also refund old "Refund due" bookings
```

1. `pending` refunds never sent → sends them.
2. `pending` refunds sent but not confirmed → **asks Stripe** for the
   refund and applies its status (refunded / failed / still pending).
3. `failed` refunds → retried like Refund now (skipped with `--no-retry`).
4. With `--backlog`: cancelled, paid bookings with no refund yet.

It prints `Sent N, synced N, retried N, backlog N; N problem(s).`, with the
details of each problem on stderr. Safe to run any time.

### Refunds in the frontend (step 3)

One helper decides what every screen says - `refundView(booking)` in
`core/payments/payment-labels.ts` - so the guest pages and the admin table
can't disagree. It reads the server's `payment.refund` block; a booking that
is cancelled + paid with **no** refund block (cancelled before refunds
existed) counts as **due**.

| Refund state | Guest sees (My Bookings, Cancelled tab; the payment return page) | Admin chip (Payment column) |
| --- | --- | --- |
| pending | "Refund of €X on its way - back to your card within 5–10 business days." | **Refund pending** (amber) |
| refunded | "Refunded €X on 27 Sep 2026." (green tick) | **Refunded** (green) + "€X on 27 Sep 2026" under it |
| failed | "Full refund of €X - the host is arranging your refund." - never the technical reason | **Refund failed** (red) + the reason under it (full text on hover) |
| due (no refund started) | same as failed | **Refund due** (red) |

- **Cancel dialog (guest)**, paid booking: "You'll get a **full refund of
  €X**, back to your card within 5–10 business days." After cancelling, the
  snackbar adds "Refund of €X on its way."
- **Cancel dialog (admin)**, paid booking: "The guest paid €X online - it's
  refunded in full to their card automatically" (or "…has already been
  refunded" when it was refunded in the Stripe Dashboard). The snackbar then
  says "Booking #N cancelled - refund of €X sent to Stripe." or, if Stripe
  couldn't be reached, "…but the refund failed: *reason*. Use Refund now to
  retry."
- **Refund now** (admin bookings, Actions column) appears only where the
  server says `can_refund` - failed refunds, old "Refund due" bookings, and
  pending refunds that were never sent. It asks first ("Stripe will refund
  the full €X to the card … paid with. It can never be refunded twice." plus
  the last failure reason), then `POST /api/bookings/{id}/refund/`
  (`BookingService.refund`). The snackbar says "Refund of €X for booking #N
  sent to Stripe." or "The refund for booking #N failed: *reason*."; a `409`
  (e.g. already refunded meanwhile) shows the server's reason. The list and
  the admin badge refresh either way.
- The TypeScript `PaymentSummary` gains optional `refund` and `can_refund`
  (optional, so an older response still type-checks).

### Also in step 2

- If sending the refund after a cancel hits an **unexpected** error, the
  cancel still answers `200` (it's already committed); the refund stays
  `pending` without a Stripe id and Refund now / `sync_refunds` sends it.
- Django Admin: Payments list shows and filters by refund status; the
  refund fields are read-only.


## Refunds: business rules & test cases (TICKET-040)

Same format as the payment rules above. Step 1: REF-01 to REF-12; step 2
(webhook, Refund now, `sync_refunds`): REF-13 to REF-30; step 3 (the
screens): REF-31 to REF-37; found in the local end-to-end run: REF-38,
REF-39. **E2E column** (updated after both runs): "✓" = checked by hand with real
Stripe test payments (local Docker and/or Render, booking numbers given);
"auto only" = covered by the automated tests only - mostly failures and
races that can't be caused on demand with real Stripe (network down, events
out of order, a crash mid-send).

| ID | Rule | How to test | Expected | Auto | E2E |
| --- | --- | --- | --- | --- | --- |
| REF-01 | Guest cancels a **paid** booking (before the deadline) → **full** refund requested at Stripe | Pay, then cancel | `200`; booking `cancelled`, payment still `paid`, refund `pending` with the full amount and a `re_...` id; one `refunds.create` with key `booking-<id>-refund-1`, no `amount` | `test_guest_cancel_refunds_the_full_amount` | ✓ local #74, Render #40 |
| REF-02 | **Admin** cancels a paid booking, even inside the 48 h → always a full refund (the guest can't cancel then) | Admin cancels a paid booking < 48 h away | guest `400`, no refund; admin `200`, refund `pending` | `test_admin_cancel_inside_the_deadline_still_refunds` | ✓ local #75, Render #41 (outside the 48 h; inside it: auto only) |
| REF-03 | Unpaid booking cancelled → nothing to refund | Book, cancel before paying | `refund: null`; Stripe refunds not called | `test_unpaid_booking_needs_no_refund` | ✓ local #70 |
| REF-04 | Stripe unreachable → the cancel **still succeeds**; refund `failed` (same attempt) | | `200`, booking `cancelled`, refund `failed` "Couldn't reach Stripe." | `test_stripe_unreachable_never_blocks_the_cancel` | auto only |
| REF-05 | Key without refund permission → `failed` with a clear reason | Remove "Charges and Refunds: Write" from the key | reason names the missing permission | `test_key_without_refund_permission` | auto only (the agent-key variant was hit by hand: REF-38) |
| REF-06 | Payments switched off → `failed`, cancel still `200` | | as described | `test_payments_switched_off_marks_it_failed` | auto only |
| REF-07 | No PaymentIntent recorded → `failed`, Stripe not called | | reason "No Stripe payment is recorded…" | `test_no_payment_intent_recorded` | auto only |
| REF-08 | Stripe reports the refund `failed` → `failed`, attempt **+1**; the retry is a new refund (`…-refund-2`) | | as described | `test_stripe_reports_the_refund_failed_next_try_is_a_new_refund` | auto only |
| REF-09 | Retry after Stripe was unreachable repeats the **same** key → can never refund twice | | both calls `…-refund-1` | `test_retry_after_stripe_was_unreachable_repeats_the_same_request` | auto only |
| REF-10 | Never twice: a `pending` or `refunded` refund is never requested or sent again | | one `refunds.create` in total | `test_never_refunded_twice` | ✓ local #77 (a later cancel sent no second refund) |
| REF-11 | Paid **after** being cancelled → stays cancelled, refunded automatically after the webhook commits | Cancel while a delayed payment settles | booking `cancelled`, payment `paid`, refund `pending` | `test_paid_after_cancelled_stays_cancelled_and_is_refunded` | auto only |
| REF-12 | Only admins see why a refund failed | GET the booking as admin / guest | admin has `failure_reason`; guest's block has no such key | `test_admin_sees_why_a_refund_failed` | ✓ local #71, #76 |
| REF-13 | Stripe confirms our refund (`refund.updated` succeeded) → **refunded** | `stripe-cli`, cancel a paid booking | refund `refunded`, `refunded_at` set; guest sees it | `test_refund_succeeded_marks_it_refunded` | ✓ local #74, Render #38/#40/#41 |
| REF-14 | `charge.refunded` also confirms it; the second event for the same refund changes nothing | | `refunded`, `refunded_at` unchanged, no Refund now | `test_charge_refunded_marks_it_refunded_and_repeats_change_nothing` | ✓ (both events arrive for every refund) |
| REF-15 | Refund fails **after** succeeding → `failed`, attempt +1; Refund now makes a **new** refund (`…-refund-2`) | | as described | `test_refund_failed_after_succeeding_offers_refund_now_with_a_new_key` | ✓ local #76 |
| REF-16 | A late `charge.refunded` never undoes a reported failure | | stays `failed` | `test_late_charge_refunded_never_undoes_a_failure` | auto only |
| REF-17 | Event arrives before the refund id is stored → matched by metadata payment id **and** attempt | | right attempt → `refunded` + id stored; other attempt ignored | `test_event_arriving_before_the_refund_id_is_stored`, `test_pending_update_only_stores_the_id`, `test_webhook_before_send_finishes_keeps_the_id` | auto only |
| REF-18 | Some other refund id on the same payment isn't taken as ours | | stays `pending` | `test_refund_of_another_refund_id_is_ignored` | auto only |
| REF-19 | Refund made **by hand in the Stripe Dashboard** → recorded; booking left alone (warning if not cancelled); a later cancel doesn't refund again; if it fails later → `failed` | Refund from the Dashboard | refund `refunded`; logs; no second refund | `test_refund_made_in_the_stripe_dashboard_is_recorded` | ✓ local #77 |
| REF-20 | Partial refund at Stripe → logged, not tracked | | refund `none`, warning | `test_partial_refund_is_logged_not_tracked` | auto only |
| REF-21 | Unknown PaymentIntent (other copy of the app) → ignored | | `200`, nothing changes | `test_unknown_payment_intent_is_ignored` | ✓ local (`stripe trigger charge.refunded`) |
| REF-22 | **Refund now** is admin-only | Guest POSTs | `403`; guests always `can_refund: false`; no login `401` | `test_guests_cannot_use_it`, `test_needs_login` | auto only |
| REF-23 | Refund now refuses when there's nothing to do | | `409` `not_cancelled` / `refund_in_progress` / `already_refunded` / `not_paid` | `test_refused_cases` | auto only |
| REF-24 | Refund now after "couldn't reach Stripe" → same key; `can_refund` goes false | Admin → Refund now | `200`, refund `pending` | `test_retry_after_a_failure` | auto only (by hand: Refund now after a *refusal*, REF-39) |
| REF-25 | Refund now failing again → `200` with the new reason, still offered | | refund `failed` + reason | `test_failing_again_answers_with_the_new_reason` | auto only (seen via `sync_refunds`, REF-29) |
| REF-26 | Old "Refund due" bookings (cancelled before refunds existed) can be refunded | Admin → Refund now on one | `200`, `pending` | `test_booking_cancelled_before_refunds_existed` | ✓ local #58, Render #38 |
| REF-27 | Unexpected error while sending → the cancel still `200`; `pending` with no id; Refund now / `sync_refunds` sends it | | as described | `test_pending_but_never_sent_can_be_sent`, `test_never_sent_is_sent` | auto only |
| REF-28 | `sync_refunds` asks Stripe about a sent-but-unconfirmed refund | Stop `stripe-cli`, cancel a paid booking, start it, run the command | "synced 1", `refunded` | `test_missed_webhook_is_synced_from_stripe`, `test_still_pending_at_stripe_changes_nothing`, `test_failed_at_stripe_when_synced` | ✓ local #75 |
| REF-29 | `sync_refunds` retries failed refunds (not with `--no-retry`) and reports problems | | "retried 1" / "1 problem(s)" | `test_failed_are_retried_unless_no_retry`, `test_retry_that_fails_again_is_reported`, `test_stripe_unreachable_while_syncing` | ✓ local #76 |
| REF-30 | `sync_refunds --backlog` refunds old "Refund due" bookings; without the flag they're left alone | | "backlog 1" | `test_backlog_only_with_the_flag` | auto only |
| REF-31 | Guest refund wording per state (never the reason) | My bookings → Cancelled | pending "on its way - 5–10 business days" / "Refunded €X on …" / failed + due "the host is arranging your refund" | payment-labels.spec "guest wording…", my-bookings.spec "every refund state" | ✓ "Refunded …" + "host is arranging" (local, Render); "on its way": auto only - the webhook lands within 1–2 s |
| REF-32 | The payment return page uses the same wording | Open `/bookings/{id}/payment` of a cancelled paid booking | as REF-31 | payment-return.spec "released and cancelled-after-paying…" | ✓ local #76 (failed wording) |
| REF-33 | Guest cancel dialog + snackbar for a paid booking | Cancel a paid booking | dialog "full refund of €X, back to your card within 5–10 business days"; snackbar "…Refund of €X on its way." | my-bookings.spec "CancelBookingDialog", "cancelling a paid booking says…" | ✓ dialog (local #71); the "on its way" snackbar: auto only |
| REF-34 | Admin chips: Refund pending / Refunded (+ date) / Refund failed (+ reason) / Refund due | Admin → Bookings → Cancelled | as described | payment-labels.spec "refund chips…", admin-bookings.spec "refund chips…" | ✓ local, Render |
| REF-35 | Refund now button only where `can_refund` | | failed + due rows only | admin-bookings.spec "refund chips…" | ✓ local #58, #71, #76 |
| REF-36 | Refund now: ask → POST → snackbar; failing again / 409 shows why | Admin → Refund now | "Refund of €X for booking #N sent to Stripe." / "…failed: reason" / server reason | admin-bookings.spec "Refund now: …", "…failing again…", "…refused by the server…" | ✓ success path (local #58/#71, Render #38); failing again / 409: auto only |
| REF-37 | Admin cancel of a paid booking: dialog says it's refunded automatically; snackbar reports the refund (or its failure) | Admin cancels a paid booking | as described | admin-bookings.spec "cancel dialog says…", "cancelling a paid booking reports…", "…already refunded in the Stripe Dashboard" | ✓ local #75, #77, Render #41 |
| REF-38 | An **agent** key's refund (`403 approval_required`) → failed with a clear reason, next attempt number | Use an agent key as `STRIPE_SECRET_KEY` | "…held for human approval - the Stripe key is an agent key…"; Refund now then uses `…-refund-2` | `test_agent_key_waiting_for_human_approval` | ✓ local #71 |
| REF-39 | Stripe **refused** (4xx except 409/429) → next attempt number; **unknown outcome** (network, 5xx, 409, 429) → same key | | attempt 2 vs 1; reasons without a trailing full stop | `test_refused_by_stripe_moves_on_unknown_outcome_does_not`, `test_key_without_refund_permission` | ✓ local #71, #76 |

### Refunds: end-to-end results - Render (27 Sep 2026)

On the hosted demo after the push (`a3828b5`), with the two Stripe changes
made: the Render key got **Charges and Refunds: Write**, and the Render
webhook endpoint got `refund.updated`, `refund.failed` and `charge.refunded`.
The guest (vaslysalex@hotmail.gr) and the admin logged in themselves;
the clicks and checks were done in Chrome. **All passed.**

| Round | What we did | Cases | Result |
| --- | --- | --- | --- |
| R1 | Deploy check | - | ✅ `POST /api/bookings/38/refund/` without login → `401` (the new endpoint is live), `/api/payments/config/` → `"enabled": true` |
| R2 | Admin **Refund now** on #38 - paid, then cancelled during the TICKET-029 run ("Refund due") | REF-26, REF-34, REF-36 | ✅ Dialog "Stripe will refund the full €424 …"; "Refund of €424 for booking #38 sent to Stripe." → **Refunded** 2 s later - the Render key may refund and the refund events reach Render |
| R3 | The **guest** cancelled paid #40 | REF-01, REF-13, REF-33 | ✅ **Refunded** 2 s after the cancel |
| R4 | The **admin** cancelled paid, confirmed #41 | REF-02, REF-37 | ✅ Dialog "…it's refunded in full to their card automatically"; "Booking #41 cancelled - refund of €424 sent to Stripe." → **Refunded** 2 s later |
| R5 | Admin → Bookings → Cancelled, search "vaslysalex" | REF-34 | ✅ #38, #40, #41 **Refunded €424 on 27 Sep 2026**, #39 **Not paid** |
| R6 | GitHub **Hosted demo check** workflow | - | ✅ Green on `a3828b5` |

### Refunds: end-to-end results - local (27 Sep 2026)

Run in Chrome against the Docker setup (`stripe-cli` forwarding the refund
events), guest `guest_4_rick71`, the demo admin, and Stripe test cards
typed on Stripe's sandbox page. **All passed** once the one real problem it
found was fixed (below).

| # | What we did | Cases | Result |
| --- | --- | --- | --- |
| 1 | `stripe trigger charge.refunded` | REF-21 | ✅ `[200]`, ignored (not our payment) |
| 2 | Guest cancelled an **unpaid** booking (#70) | REF-03 | ✅ "You weren't charged", no refund |
| 3 | Paid #71 (4242), guest cancelled | REF-01, REF-33, REF-05, REF-38 | ✅ Dialog "full refund of €364, back to your card within 5–10 business days"; cancel went through. The refund **failed**: the backend's key was an **agent** key, so Stripe answered `403 approval_required` and replayed that for the same idempotency key - this is what the fix below is for. Guest saw "the host is arranging your refund"; admin saw **Refund failed** + reason + **Refund now** |
| 4 | Backend switched to a normal restricted key (Checkout Sessions + Refunds: Write); admin **Refund now** on #71 | REF-24, REF-36, REF-39 | ✅ New key `booking-71-refund-2` → "Refund of €364 for booking #71 sent to Stripe." → **Refunded** about 2 s later (webhook) |
| 5 | Old "Refund due" booking #58 (cancelled before refunds existed) → Refund now | REF-26, REF-34, REF-35 | ✅ Chip **Refund due** + button → dialog → **Refunded** |
| 6 | Paid #74 (4242), guest cancelled | REF-01, REF-13 | ✅ `pending` in the answer → **Refunded** about 1 s later |
| 7 | Paid #76 with `4000 0000 0000 5126` (refund fails later), guest cancelled | REF-15, REF-31 | ✅ First **Refunded**, then Stripe's `refund.failed` (`expired_or_canceled_card`) → **Refund failed**, attempt +1, Refund now offered; guest: "Full refund of €364 - the host is arranging your refund." (also on the return page) |
| 8 | Refunded #77 **outside the app** (`stripe refunds create`) while confirmed; then admin cancelled it | REF-19, REF-37 | ✅ Recorded **Refunded**, booking left **Confirmed**; cancel dialog "…has already been refunded"; no second refund |
| 9 | Stopped `stripe-cli`; admin cancelled paid #75 | REF-37, REF-28 | ✅ Snackbar "refund of €364 sent to Stripe"; stuck at **Refund pending** (webhook missed on purpose) |
| 10 | Started `stripe-cli`; `manage.py sync_refunds` | REF-28, REF-29 | ✅ "synced 1" → #75 **Refunded**; it also retried #76 with a new key, which Stripe refused ("A previous attempt to refund charge … failed") → reported as 1 problem, still **Refund failed** |
| 11 | `manage.py release_stale_holds` | STALE-02 | ✅ "Settled 6 stale hold(s)" - the unpaid test bookings whose time ran out |

Guest **My bookings → Cancelled** afterwards: "Refunded €364 on 27 Sep 2026."
(#71, #74, #75, #77), "Full refund of €364 - the host is arranging your
refund." (#76), "You weren't charged." (#70).

**Found and fixed during the run:**

- **Retrying after Stripe refused a refund reused the same idempotency key**,
  and Stripe replays its stored answer for a key - so the retry could never
  succeed. Now: a clear refusal (any 4xx except 409/429: missing
  permission, agent-key approval, expired key, bad request) moves to the
  next attempt number; an unknown outcome (network, 5xx, 409, 429) keeps the
  same key. Neither can refund twice - a full refund succeeds at most once
  per payment at Stripe (REF-39).
- The admin reason for an agent key now says so: "Stripe is holding this
  refund for human approval - the Stripe key is an agent key…" (REF-38).
- Snackbars no longer end with a double full stop; refused-refund log lines
  no longer print a traceback.
- Setup note: the backend must use a **normal** restricted key - an agent
  key (made for AI tools) needs a human to approve every refund.

## Emails (TICKET-030)

The app emails guests about their booking, and the owner about new
bookings. Built in five steps - the outbox, the settings and Mailpit (1),
the four emails with the hooks that send them at every booking change (2),
retrying failed emails from the command line or Django Admin (3), Render
config + docs (4), end-to-end runs locally and on Render (5) - then changed
after review: admin accounts' mail goes to the owner's real inbox, and the
emails are sent through the **Gmail API** as the owner's real Gmail
(first built with Brevo, which had to show its own `…@brevosend.com` sender
address instead - removed).

### Agreed design

| Email (`kind`) | Sent when | To |
| --- | --- | --- |
| `booking_received` | a booking is created (pending) - with Pay now and the 30-minute hold when payments are on | guest |
| `booking_confirmed` | pending → confirmed (Stripe webhook, a settled stale hold, or an admin's Confirm) | guest |
| `booking_cancelled` | any cancel - guest, admin, an expired hold or a failed payment - with the refund amount when paid | guest |
| `admin_new_booking` | a booking is confirmed | `BOOKING_ALERT_EMAILS` |

"Received" and "confirmed" are always two emails, even when the guest pays
straight away.

**Admin accounts' mail goes to the owner's real inbox** (change after
review): when the "guest" of a booking is an admin account (role `admin`,
e.g. the demo admin booking a stay), its received / confirmed / cancelled
emails go to `BOOKING_ALERT_EMAILS` instead of the account's login email -
an admin login such as `admin_demo@example.com` isn't a real inbox. With
`BOOKING_ALERT_EMAILS` empty they fall back to the account's own email.
Normal guests always get mail at their own address.

**Provider: the Gmail API**, sending as the owner's own Gmail - so the
sender guests see is that real address, and every email is also in its
"Sent" folder (about 500 emails/day on a personal Gmail). Not SMTP, because
Render's free web services block outbound SMTP ports; the Gmail API is
plain HTTPS, through `notifications/backends.py`, a small Django email
backend using only the standard library. Locally, a **Mailpit** container
catches every email instead of sending it.

### Where emails go (`EMAIL_PROVIDER`)

| Value | Backend | Used |
| --- | --- | --- |
| `console` (default) | printed to the backend log | a plain `manage.py runserver` |
| `smtp` | Django's SMTP backend → `EMAIL_HOST:EMAIL_PORT` | Docker: `docker-compose.yml` sets `smtp` + `mailpit:1025` |
| `gmail` | `notifications.backends.GmailApiEmailBackend` | Render. Without all three `GMAIL_*` settings it falls back to `console` (and warns) |

Tests always use Django's in-memory backend (`mail.outbox`), whatever is
set. To send real emails from Docker, put `EMAIL_PROVIDER=gmail` in `.env`
next to the `GMAIL_*` values (the compose file only defaults to `smtp`).

The sender is `DEFAULT_FROM_EMAIL` and the admin alert list is
`BOOKING_ALERT_EMAILS`. Both are set in `.env` / the Render dashboard only,
never committed - the repository is public.

### The outbox (`notifications/models.py`, `notifications/outbox.py`)

Every email is first a `BookingEmail` row:

```
pending ──claimed──▶ sending ──ok──▶ sent
                           └─error─▶ failed ──retry──▶ sending ...
pending/failed ──booking moved on──▶ skipped
```

- `enqueue(booking, kind)` is called **inside the transaction that changes
  the booking**. It creates the row and registers the send with
  `transaction.on_commit`. So an email is never sent for a change that was
  rolled back, and the provider is never called while booking rows are
  locked.
- **At most one row per (booking, kind)** - checked first, and backed by
  the DB constraint `one_email_per_booking_kind` (a simultaneous duplicate
  hits the constraint inside a savepoint and is simply dropped). A repeated
  Stripe webhook or a double confirm can't send twice.
- No recipient (an account without an email, or an empty
  `BOOKING_ALERT_EMAILS`) → no row at all.
- `send_email(id)`: locks the row just long enough to **claim** it
  (`sending`, attempts + 1), renders and sends it with no lock held, then
  records `sent` (+ Gmail's message id) or `failed` (+ the reason, never
  a secret). It **never raises** - a failed email can't turn a booking,
  a cancel or a webhook into an error.
- Content is rendered **at send time** from the booking as it is then. Right
  before sending, the booking must still be in the state the email is about
  (received → pending, confirmed/admin alert → confirmed, cancelled →
  cancelled); otherwise the row becomes `skipped` - e.g. a retried "booking
  received, pay within 30 minutes" for a booking that is already confirmed.
- A row in `sending` for longer than `EMAIL_SENDING_STALE_MINUTES` (10; e.g.
  the server restarted mid-send) may be claimed again. Two senders never
  send the same row at the same time.
- The one possible duplicate: a timeout *after* the provider accepted the
  email - the outcome is unknown, so it's recorded as failed and a retry
  sends it again. (Each email carries an `X-Booking-Email:
  booking-<id>-<kind>` header, visible in Gmail's "Show original".)

### When each email is recorded (step 2)

Every place that changes a booking's status records its email **in the same
transaction** (`notifications/outbox.py`: `booking_received`,
`booking_confirmed` = guest confirmation + owner alert, `booking_cancelled`):

| Where | Change | Email(s) | Cancel reason |
| --- | --- | --- | --- |
| `POST /api/bookings/` (`bookings/views.py:create`) | new booking (pending) | `booking_received` | - |
| `PATCH /api/bookings/{id}/` (`partial_update`) | admin Confirm | `booking_confirmed` + `admin_new_booking` | - |
| `PATCH /api/bookings/{id}/` | cancel | `booking_cancelled` | `guest` if the booking's own guest cancelled, else `host` |
| Stripe webhook (`payments/webhooks.py:_paid`) - also a stale hold that turns out paid | payment arrived → confirmed | `booking_confirmed` + `admin_new_booking` | - |
| Stripe webhook (`_release`) | session expired / delayed payment failed → cancelled | `booking_cancelled` | `payment_expired` / `payment_failed` |
| Stale hold with no session (`payments/services.py:_release_unpaid`) | hold ran out → cancelled | `booking_cancelled` | `payment_expired` |

Bookings created outside the API (the seed script, Django Admin) send
nothing. A change that is refused (400/409) or rolled back sends nothing.
The reason is stored on the row (`BookingEmail.reason`, migration
`notifications/0002_cancel_reason.py`) because it can't be worked out later.

### What the emails say (`notifications/messages.py` + templates)

Templates live in `notifications/templates/notifications/emails/`: one
`<kind>.html` (extends `base.html`: a 560px table layout with inline styles
that Gmail and Outlook keep, the property's cover photo, a stay summary and
one blue button) and one `<kind>.txt` (the plain-text version), plus small
shared pieces (`_stay.txt`, `_refund.txt`, `_cancel_reason.txt`, ...).
Property titles etc. are HTML-escaped in the HTML version. Money and dates
are formatted like the Angular app: `€240` / `€95.50`, `Wed 10 Mar 2027`,
times in Athens time.

| Email | Subject | Says | Button |
| --- | --- | --- | --- |
| received, payments on | `Complete your payment - booking #42, Sea View Loft` | dates held until 18:42 (30 minutes), pay €X to confirm, free cancellation until the deadline with a full refund once paid | **Pay now** → `/bookings/42/payment` (the app's payment page with the countdown) |
| received, payments off | `Booking #42 received - Sea View Loft, 10–13 Mar` | pending until the host confirms, nothing charged | View my bookings |
| confirmed | `Booking #42 confirmed - Sea View Loft, 10–13 Mar` | "You're all set", payment received (if paid online), check-in from 15:00, cancel online until the 48h deadline (+ full refund if paid) or "online cancellation has closed" | View my bookings |
| cancelled | `Booking #42 cancelled - Sea View Loft, 10–13 Mar` | why (as you requested / the host cancelled / payment time ran out / payment didn't go through) and the money: "A full refund of €X is on its way - back on your card within 5-10 business days", "We've refunded the full €X", "the host is arranging it" (refund failed - never the technical reason) or "Nothing was charged." | Browse stays, or **Book again** (the property) after a payment problem |
| admin alert | `New booking #42: Sea View Loft, 10–13 Mar (€240)` | guest email, payment (paid online €X / confirmed by hand - no online payment / payments off), booked on, the stay | Open admin bookings |

Links use `FRONTEND_URL`. The text is rendered when the email is sent, so
e.g. a cancellation email sent right after the cancel says the refund is
"on its way" (it's `pending` until Stripe's webhook confirms it).

### Retrying failed emails (step 3)

An email that couldn't be sent stays in the outbox as `failed` (with the
reason), or `pending` / `sending` if the server stopped at the wrong moment.
Nothing retries on its own; two ways to send them:

- **`python manage.py send_pending_emails`** (local: `docker compose exec
  backend python manage.py send_pending_emails`) - sends every pending,
  failed and stuck (`sending` for 10+ minutes) email, oldest first, and
  prints `Sent 2, failed 0, skipped 1.`; each failure goes to stderr with its
  reason. `--max-attempts N` (default 5, `0` = no limit) leaves out emails
  that already failed N times; `--dry-run` only lists them. Safe to run any
  time, e.g. from a cron job.
- **Django Admin → Notifications (emails) → Booking emails** (works on
  Render, which has no shell on the free plan): the whole outbox, filterable
  by status / kind / cancel reason, searchable by booking id or address,
  with the error text. Select rows → **"Retry sending the selected emails"**
  → a summary like `Emails: 1 already sent, 1 sent.` The list is read-only
  (no add / edit / delete - it's the record of what was sent), and each
  **Booking** page in Django Admin shows its emails inline.

Both go through the same `send_email()`: a `sent` email is never sent
again, and one whose booking has moved on is `skipped` rather than sent out
of date.

### Emails on Render (Gmail API) - one-time setup

`render.yaml` sets `EMAIL_PROVIDER=gmail`; until the three `GMAIL_*` values
are added, emails are only printed to Render's log (warning
`notifications.W002` at deploy), so deploying first is safe.

**In Google Cloud** (signed in as the Gmail that will send):

1. Create a project (e.g. `booking-demo-email`):
   https://console.cloud.google.com/projectcreate
2. Enable the **Gmail API**:
   https://console.cloud.google.com/apis/library/gmail.googleapis.com
3. **Google Auth Platform** (https://console.cloud.google.com/auth/overview)
   → *Get started*: app name `Booking System Demo`, support email = your
   Gmail, audience **External**, contact email = your Gmail.
4. *Data Access* → *Add or remove scopes* → add
   `https://www.googleapis.com/auth/gmail.send` (send only - it can't read
   the mailbox) → *Update* → *Save*.
5. *Audience*: either **Publish app** (status **In production** - needs a
   home page and privacy-policy link on the *Branding* page first; the
   token then doesn't expire), or - what this project does for now - stay
   in **Testing** and **add your Gmail under *Test users***: then Google
   expires the refresh token after **7 days** and `gmail_authorize` has to
   be run again. Either way you'll see an "unverified app" warning once
   when signing in.
6. *Clients* → *Create client* → type **Desktop app** → copy the **Client
   ID** and **Client secret** into `.env` as `GMAIL_CLIENT_ID` /
   `GMAIL_CLIENT_SECRET`.

**Get the refresh token** (once, locally):

7. `docker compose up -d backend`, then
   `docker compose exec backend python manage.py gmail_authorize`
8. Open the printed link, sign in with the Gmail, *Advanced* → *Go to
   Booking System Demo (unsafe)* → *Continue*.
9. The browser ends on `http://127.0.0.1:8765/?state=…&code=…` (a page that
   doesn't load - expected). Paste that whole address into the terminal;
   it prints `GMAIL_REFRESH_TOKEN=…`. (It uses PKCE and checks `state`, so
   an address from another sign-in is refused.) Put it in `.env`.
10. Check: `docker compose exec backend python manage.py send_test_email
    you@gmail.com` (uses the configured provider - with Docker's default
    that's Mailpit; add `EMAIL_PROVIDER=gmail` to `.env` to send for real).

**On Render:** `booking-demo-api` → *Environment* → set `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `DEFAULT_FROM_EMAIL` =
`Booking System Demo <you@gmail.com>` (it **must** be that same Gmail -
Gmail won't send from another address) and `BOOKING_ALERT_EMAILS` =
`you@gmail.com` → *Save, rebuild and deploy*. Then book something on the
hosted site and look at Django Admin (`/admin/` on the API) → *Booking
emails*: `sent` with Gmail's message id; the email is in the Gmail's
"Sent" folder.

If the token stops working (the app is still in "Testing" and 7 days have
passed, you removed the app's access at
https://myaccount.google.com/permissions, or you changed the password),
sends fail with `invalid_grant … run manage.py gmail_authorize again` -
see the next section.

### Gmail token: renew it, or make it permanent

The Google app (`booking-demo-email`) is in **Testing** mode, with
lysikatosparaskevas@gmail.com as its only test user. In Testing, Google
makes the refresh token (`GMAIL_REFRESH_TOKEN`) **stop working after 7
days**. The current one was created on 28 Sep 2026, so it expires around
**5 Oct 2026**.

**How you notice:** booking emails stop arriving. In Django Admin →
*Booking emails* they show **Failed** with `Google answered 400:
invalid_grant - … run manage.py gmail_authorize again`. Bookings keep
working normally; only the emails wait.

#### Renew the token (about 2 minutes, every 7 days while in Testing)

1. In the project folder (Docker running):
   ```
   docker compose exec backend python manage.py gmail_authorize
   ```
2. Ctrl+click the `https://accounts.google.com/...` link it prints and sign
   in as **lysikatosparaskevas@gmail.com**. At "Google hasn't verified this
   app" click **Continue**, then allow **Send email on your behalf**.
3. The browser ends on an error page ("This site can't be reached") -
   expected. Click the address bar, copy the **whole address** (it starts
   with `http://127.0.0.1:8765/?state=…&code=…`) and paste it into the
   terminal at the `Browser address` prompt. (Not your email address - and
   use the link from *this* run; an old one gives "state mismatch".)
4. It prints `GMAIL_REFRESH_TOKEN=1//…`. Replace the old line in **`.env`**
   with it, then `docker compose up -d backend`.
5. Check locally:
   `docker compose exec backend python manage.py send_test_email lysikatosparaskevas@gmail.com`
   → "Sent … via gmail".
6. **Render** → `booking-demo-api` → *Environment* → *Edit* → paste the new
   value into `GMAIL_REFRESH_TOKEN` → **Save, rebuild and deploy**.
7. Send the emails that failed meanwhile: Django Admin on the API
   (https://booking-demo-api.onrender.com/admin/ → *Booking emails*, filter
   *Failed*) → select them → **Retry sending the selected emails**. Emails
   whose booking has moved on are skipped automatically; a sent one is
   never sent twice. (Locally: `docker compose exec backend python
   manage.py send_pending_emails`.)

#### Make it permanent (publish the Google app - once)

A **published** ("In production") app gets a refresh token that doesn't
expire after 7 days. It only stops working if you revoke it
(https://myaccount.google.com/permissions), change your Google password,
or don't use it for 6 months. Google doesn't need to review a personal app
like this one: it stays "unverified" (you keep seeing the "Google hasn't
verified this app" screen when running `gmail_authorize`), which is fine
for sending from your own account.

Google only lets you publish once the *Branding* page is complete, which
means the app needs a public **home page** and **privacy policy** page:

1. **Create the two pages** (needs a small code change and a deploy -
   ask for it as a follow-up ticket): e.g. a simple `/privacy` page in the
   Angular app ("This demo sends booking emails from the owner's Gmail
   using the gmail.send permission only; it doesn't read your mailbox;
   bookings are stored only to run the demo; contact: …"). The home page
   can be the site itself: https://booking-demo-g4aw.onrender.com.
2. **Google Cloud** → https://console.cloud.google.com/auth/branding
   (project `booking-demo-email`, signed in as your Gmail):
   - *Application home page*: `https://booking-demo-g4aw.onrender.com`
   - *Application privacy policy link*:
     `https://booking-demo-g4aw.onrender.com/privacy`
   - *Authorized domains* → *Add domain*: `booking-demo-g4aw.onrender.com`
     (`onrender.com` itself is a shared domain, so the full site name is
     what counts). If Google refuses it, use a domain you own for the two
     pages instead.
   - **Save**.
3. *Audience* → **Publish app** → **Confirm**. The status must now say
   **In production**. (If Google asks you to "prepare for verification",
   you don't have to submit anything for your own use - the app just
   stays unverified.)
4. **Get a new token once more** - a token created while the app was in
   Testing keeps its 7-day limit. Do steps 1-7 of *Renew the token* above.
   From then on there's nothing to renew.

After publishing you can remove yourself from *Audience → Test users*
(optional).

### Gmail API backend (`notifications/backends.py`)

1. `POST https://oauth2.googleapis.com/token` with the client id/secret and
   the refresh token → an access token (~1 hour), cached per process until
   a minute before it expires.
2. `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with
   `{"raw": <Django's own MIME message, base64url>}` - so text + HTML,
   Reply-To and headers are exactly what Django builds. A 401 (stale
   access token) → a fresh token and one retry.
3. `200 {"id": …}` = sent; the id is stored on the row.

Errors raise `EmailSendError` with a readable reason (`Google answered 400:
invalid_grant - …`), never a secret; `refused` is true for a 4xx (e.g. a
revoked token - retrying won't help until it's replaced) and false for
unknown outcomes (network error, timeout, 5xx, 429). `EMAIL_TIMEOUT` (10 s)
bounds every call.

### Startup checks (`notifications/checks.py`)

Only **warnings**, never errors: a mis-set email setting must not stop a
Render deploy - bookings work without emails, and the emails wait in the
outbox.

| Id | When |
| --- | --- |
| `notifications.W001` | unknown `EMAIL_PROVIDER` (falls back to console) |
| `notifications.W002` | `gmail` without all of `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (falls back to console) |
| `notifications.W003` | `gmail` with a placeholder `DEFAULT_FROM_EMAIL` |
| `notifications.W004` | an entry in `BOOKING_ALERT_EMAILS` that isn't an email address |

### Mailpit (local)

`docker compose up -d` starts the `mailpit` service; open
**http://localhost:8025** to see every email the backend sent (HTML and
text versions, headers). Nothing reaches a real inbox. The emails are gone
when the container is recreated.

To apply locally: `docker compose up -d` (pulls Mailpit, recreates the
backend with the email settings; the backend runs the new migrations
`notifications/0001_initial.py` and `0002_cancel_reason.py` on start).

### Tests (`notifications/tests.py`, 46)

- **Step 1 (18, the backend part replaced by the Gmail API tests below):**
  the
  settings checks; and the outbox: sent only after commit, nothing on
  rollback, one per (booking, kind) incl. the DB constraint, no recipient →
  no row, the admin list, a failure recorded then retried, an out-of-date
  email skipped, a row being sent left alone until stale, and the retry list.
- **Step 2 (16):** through the real API and signed webhooks - booking →
  received (payments off / on with Pay now and the hold time), admin confirm
  → confirmed + alert, guest cancel ("as you requested"), admin cancel ("the
  host"), a refused change sends nothing, a broken provider still gives 201,
  seeded bookings send nothing, HTML escaping, a stale hold released by the
  next booking ("we didn't receive your payment"), the payment webhook →
  confirmed + alert **exactly once** even when Stripe repeats the event or
  sends a second "paid" event, expired / failed sessions, cancelling a paid
  booking mentions the refund, a failed "received" skipped on retry once
  the booking is paid; money/date formatting.
- **Step 3 (5):** the command sends pending + failed, skips out-of-date,
  leaves sent alone and reports; failures on stderr and `--max-attempts`;
  `--dry-run`; the admin list + Booking inline are read-only and show the
  error; the Retry action sends a failed one and not a sent one.
- **Changes after review (+6):** admin accounts' mail → `BOOKING_ALERT_EMAILS`
  (and the fallback); the Gmail API backend replacing Brevo's tests - token
  refresh then one send with the whole MIME message (sender, Reply-To, text
  + HTML), the access token reused, a stale token replaced once, a revoked
  refresh token = refusal with advice and no secrets, network/5xx/429 =
  unknown outcome, missing settings; `gmail_authorize` (PKCE + state, code
  exchanged, token printed; another sign-in's address refused; needs the
  client settings); `send_test_email`.

All **260 backend tests pass** on Postgres.

## Emails: business rules & test cases (TICKET-030)

Every rule, how to check it by hand, and the automated test that covers it
(`backend/notifications/tests.py`, test docstrings carry the same
`EMAIL-nn`). The **E2E** column is filled in by the end-to-end runs in
step 5 (locally in Mailpit, then on Render with a real inbox).

| # | Rule | How to check by hand | Expected | Automated | E2E |
| --- | --- | --- | --- | --- | --- |
| EM-01 | A new booking emails the guest "received" | Book a stay | Mailpit: `Booking #N received - …` (payments off) or `Complete your payment - booking #N, …` (on) | EMAIL-14, EMAIL-21 | local ✅, Render ✅ |
| EM-02 | With payments on, "received" has **Pay now** and the hold's end time | Open the email, click Pay now | Lands on `/bookings/N/payment` with the countdown; the time in the email = the hold's end | EMAIL-21 | local ✅ |
| EM-03 | Payment → guest "confirmed" + owner alert, **once** | Pay with 4242; resend the event (`stripe events resend evt_…`) | 2 emails (guest + `BOOKING_ALERT_EMAILS`), nothing more after the resend | EMAIL-23 | local ✅ |
| EM-04 | Admin Confirm → "confirmed" + alert | Confirm a pending booking in /admin/bookings | 2 emails; alert says "Confirmed by hand - no online payment" when unpaid | EMAIL-15 | Render ✅ |
| EM-05 | Guest cancel → "as you requested" | Cancel from My bookings | Cancelled email; "Nothing was charged." if unpaid | EMAIL-16 | local ✅ |
| EM-06 | Admin cancel → "the host has cancelled" | Cancel a guest's booking as admin | Cancelled email with the host wording | EMAIL-17 | Render ✅ |
| EM-07 | Cancelling a paid booking mentions the refund | Pay, then cancel | "A full refund of €X is on its way - back on your card within 5-10 business days" | EMAIL-25 | local ✅ |
| EM-08 | Hold ran out → "we didn't receive your payment", Book again | Back out of Stripe, expire the session (`stripe checkout sessions expire cs_…`) | Cancelled email with the payment-expired wording + Book again → the property | EMAIL-22, EMAIL-24 | |
| EM-09 | A delayed payment that fails → "your payment didn't go through" | (auto only - needs a delayed payment method) | Cancelled email, payment-failed wording | EMAIL-32 | auto only |
| EM-10 | Emails go out only **after** the booking change is saved; a refused or rolled-back change sends nothing | Try to cancel an already-cancelled booking | 400, no new email | EMAIL-07, EMAIL-08, EMAIL-18 | |
| EM-11 | At most one email per booking + kind | (DB constraint) | - | EMAIL-09 | auto only |
| EM-12 | A broken mail provider never breaks a booking | Stop Mailpit (`docker compose stop mailpit`), book | Booking works (201); Django Admin → Booking emails: `failed` "Couldn't reach …" | EMAIL-11, EMAIL-19 | local ✅ |
| EM-13 | Failed emails can be retried; a sent one is never re-sent | Start Mailpit again; Retry in Django Admin / `send_pending_emails` | Now `sent`, arrives once; retrying a sent row → "already sent" | EMAIL-11, EMAIL-27, EMAIL-30 | local ✅ |
| EM-14 | An email that's out of date by the time it's retried is skipped | Failed "received", then the booking is paid, then retry | `skipped` - no "complete your payment" after paying | EMAIL-12, EMAIL-26 | |
| EM-15 | A send stuck in `sending` is retried only after 10 minutes | (needs a crash mid-send) | - | EMAIL-13 | auto only |
| EM-16 | No recipient → no email (account without email, empty alert list) | Empty `BOOKING_ALERT_EMAILS`, confirm | Only the guest's email | EMAIL-10 | |
| EM-17 | Seeded / Django Admin bookings send nothing | `seed_demo_data` | No rows in Booking emails | EMAIL-20 | |
| EM-18 | Gmail API: sent as the owner's real Gmail (text + HTML, Reply-To, header); errors readable, never a secret | Book on Render; look at the email in Gmail and in its *Sent* folder | Sender = the owner's Gmail address, not a service address | EMAIL-01…04 | Gmail API: local ✅, Render ✅ |
| EM-19 | Email settings can never stop a deploy (warnings only); `gmail` without its settings → console | Deploy before setting the `GMAIL_*` values | Deploy OK, warning `notifications.W002`, emails in the log | EMAIL-05, EMAIL-06 | |
| EM-21 | An admin account's guest emails go to `BOOKING_ALERT_EMAILS`, not its login email (fallback: its own email when the list is empty) | Book as `admin_demo` | The received / confirmed / cancelled emails arrive at the owner's Gmail | EMAIL-33 | Render ✅ |
| EM-22 | `gmail_authorize` gives a working refresh token; a revoked token fails with advice | Run it, then `send_test_email` | `GMAIL_REFRESH_TOKEN=…` printed; the test email arrives from the Gmail | EMAIL-03, EMAIL-34 | local ✅ |
| EM-20 | User content is escaped in HTML | Property title with `<b>` | Shown as text | EMAIL-31 | auto only |

### Emails: end-to-end results - Gmail API (28 Sep 2026)

After the change to the Gmail API. Google Cloud: project
`booking-demo-email`, Gmail API enabled, `gmail.send` scope, a "Desktop app"
client; the app stays in **Testing** with the owner's Gmail as the only test
user (publishing needs a home page + privacy policy on the Branding page -
not done; see the note below).

| Where | What was done | Result | Rules |
| --- | --- | --- | --- |
| Local | `gmail_authorize` (first try: an email pasted instead of the browser address → "state mismatch"; the prompt was then made clearer), then `send_test_email` | Refresh token printed; the test email arrived **from lysikatosparaskevas@gmail.com** and is in its *Sent* folder | EM-22 |
| Render | `GMAIL_*` set, `EMAIL_PROVIDER=gmail`, `BREVO_API_KEY` deleted, redeployed `29e3e9d`. As `admin_demo`: book #45 (Nafplio, 12-14 Apr 2027) → Stripe page, not paid | **"Complete your payment - booking #45"** in the owner's Gmail inbox, **sender = the real Gmail** (no brevosend.com), and addressed to the owner's Gmail instead of `admin_demo@example.com` | EM-01, EM-18, EM-21 |
| Render | Admin Confirm #45 (waived) | **"Booking #45 confirmed"** + **"New booking #45 … (€464)"** - both from the real Gmail, in the inbox (not spam) | EM-04, EM-18, EM-21 |
| Render | Admin Cancel #45 (the admin's own booking) | **"Booking #45 cancelled"** - "as you requested" (the booking's own guest cancelled it), "Nothing was charged." | EM-05, EM-21 |

**Testing mode:** the refresh token expires after **7 days** (this one:
about 5 Oct 2026) - see "Gmail token: renew it, or make it permanent".

### Emails: end-to-end results - Render (28 Sep 2026, with Brevo - replaced afterwards)

This run was with the first version (Brevo). It's what showed Brevo's
`…@brevosend.com` sender and led to the Gmail API change after review.

Brevo set up (the Gmail sender was already verified; a new API key), and
`BREVO_API_KEY` / `DEFAULT_FROM_EMAIL` / `BOOKING_ALERT_EMAILS` added in
Render, then redeployed `dbe7e77`. Driven in Chrome on the hosted site as
`admin_demo` (so the *guest* emails went to `admin_demo@example.com`, which
can't receive mail - they were checked in Brevo's logs, the owner alert in
the real Gmail inbox):

| Step | Result | Rules |
| --- | --- | --- |
| Book #44 (Santorini, 18-20 Jan 2027) → Confirm and pay → Stripe page opened, not paid | Brevo log: **"Complete your payment - booking #44, Spacious Suite in Santorini"**, tag `booking_received`, sent within a second of booking | EM-01, EM-18 |
| Admin **Confirm** #44 (payment waived) | Brevo: **"Booking #44 confirmed - …"** (`booking_confirmed`) and **"New booking #44: Spacious Suite in Santorini, 18–20 Jan (€256)"** (`admin_new_booking`) → **Delivered to the Gmail inbox** (not spam), text: "Payment: Confirmed by hand - no online payment", dates, total, admin link all correct | EM-04, EM-18 |
| Admin **Cancel** #44 | Brevo: **"Booking #44 cancelled - …"** (`booking_cancelled`) | EM-06 |
| Brevo's handling of the sender | As documented: the Gmail sender is replaced by `lysikatosparaskevas@12284635.brevosend.com`; the name stays | EM-18 |
| `example.com` recipient | First email **hard-bounced**, after which Brevo **blocks** that address for later emails ("Blocked" in the log) - expected for a non-existent inbox; our side recorded them as sent (Brevo accepted them) | - |

No errors in Render's application log. Not covered here (the demo admin's
inbox can't receive mail): the guest-side emails *in an inbox*, and paying
with a card on Render - both are covered by the local run in Mailpit.

### Emails: end-to-end results - local (28 Sep 2026)

`docker compose up -d` (Mailpit + the two migrations), then in Chrome as the
seeded guest `guest_4_rick71@example.com`, reading every email in Mailpit
(http://localhost:8025):

| Round | What was done | Result | Rules |
| --- | --- | --- | --- |
| 1 | Book #78 (Ioannina, 22-24 Feb 2027) → Confirm and pay → Stripe page | Mailpit: **"Complete your payment - booking #78, Breezy Suite in Ioannina"** - "Almost there, Monica", held until 11:49, photo, stay summary, Pay now; Reply-To = the owner's Gmail. Pay now → `/bookings/78/payment` showing the same 11:49 hold with Pay now | EM-01, EM-02, EM-18 |
| 2 | The owner pays with card 4242 | **"Booking #78 confirmed"** ("We've received your payment of €462") + **"New booking #78 … (€462)"** to the owner - one of each | EM-03 |
| 3 | Guest cancels #78 from My bookings | **"Booking #78 cancelled"** - "as you requested", **"A full refund of €462 is on its way - it's back on your card within 5-10 business days"**, Browse stays | EM-05, EM-07 |
| 4 | `docker compose stop mailpit`, book #79 (Thessaloniki, 8-10 Mar 2027) | Booking created normally and Stripe's page opened; Django Admin → Booking emails: #79 "received" **Failed**, `[Errno -2] Name or service not known` | EM-12 |
| 5 | `docker compose start mailpit`, Django Admin → select the failed #79 email **and** the already-sent #78 one → "Retry sending" | "Emails: 1 already sent, 1 sent." - #79 now Sent (2 attempts) and in Mailpit; #78's not sent again (only one new email) | EM-13 |

All emails rendered correctly (HTML and text); Mailpit's HTML check scored
94-95%.

## Mobile & PWA (TICKET-031)

The same Angular app works on phones, tablets and laptops, and can be
installed to a phone's home screen like an app - no separate mobile
codebase.

### Agreed design

- **Two breakpoints for the whole app** (`src/styles/_responsive.scss`):
  **phone ≤ 600 px** and **tablet ≤ 960 px**. Components use them with
  `@use 'responsive' as r;` and `@include r.phone { ... }` /
  `@include r.tablet { ... }` (`angular.json` →
  `stylePreprocessorOptions.includePaths: ["src/styles"]`). They replace the
  earlier one-off 480/600/720/900/960 px values.
- **The page never scrolls sideways** at any width; wide things (the
  dashboard's period buttons) scroll inside their own strip instead.
- **Admin tables become cards** at ≤ 960 px (`r.table-cards` mixin): one
  template, CSS only - each `<td data-label="Guest">` shows its label in
  front of its value, the header row is hidden.
- **Notched phones:** `viewport-fit=cover` plus `env(safe-area-inset-*)`
  padding on the toolbar, footer and the detail page's bottom bar.
  `100dvh` for the page height (ignores the collapsing address bar).

### What changes per page

| Page | Tablet (≤ 960 px) | Phone (≤ 600 px) |
|---|---|---|
| Toolbar | Account button shows the icon only | Logo icon only; My bookings / Admin move into the account menu |
| Listings | - | Full-width Search; price fields share a row |
| Property detail | One column; a **bottom bar** with the price (and stay total) and *Choose dates* → scrolls to the booking panel, or *Book now* once the dates are fine; hides while the panel is on screen | Calendar shows one month |
| Booking form | One column, summary on top | Shorter photo, full-width fields, less stepper indent |
| My bookings | - | Cards stack photo above text |
| Admin shell | Side nav → a bar above the page | Four equal tabs (icon above label, pending badge on Bookings) |
| Admin bookings | **Cards**: #ref + status, property, then labelled rows; actions at the bottom | same |
| Admin properties | **Cards**: photo, title with "€/night · Sleeps · rating", location, status, actions | same |
| Admin dashboard | - | Period buttons scroll sideways; breakdown shows property, occupancy, revenue |
| Login / Register | - | Name fields stacked |

On laptops (961-1440 px, side nav open) the admin bookings table drops the
"Booked" column and wraps the text columns, and long guest emails are
shortened with the full address on hover, so it fits without scrolling.

### How it was checked

A headless-Chrome script (not committed) opens every route as a visitor,
a guest and the admin at 360, 390, 768 and 1280 px against a local backend
with seeded data, takes full-page screenshots and reports: the page
scrolling sideways, elements sticking out of the viewport, text inputs
under 16 px (iOS zooms into those) and small tap targets. Before this
ticket: no page scrolled sideways, but the admin tables were cut off on
phones and tablets (the bookings table was 1,567 px wide), the dashboard's
period buttons overflowed and the admin side nav squeezed tablets. After:
nothing sticks out at any of the four widths.

Fix after review: on phones a real 4:3 photo on a **My bookings** card
spilled out of its 16:9 box and covered the text (the audit had missed it
because the stock photos couldn't load there). The photo is now pinned to
its box (`position: absolute; inset: 0` + `object-fit: cover`), the same fix
for the booking form's summary photo (it was cropped off-centre), and the
audit now serves a real photo and flags any image larger than its box.

Tests: 3 new Vitest tests for the detail page's bottom bar (Choose dates
scrolls to and focuses the panel; Book now + stay total once the dates are
confirmed; hidden while the panel is on screen, observer disconnected when
leaving the page). The table cards are CSS only, so the existing admin
table tests cover them unchanged.

### Installing it as an app (PWA)

**Manifest + icons only, no service worker** (agreed): the site is
installable, but nothing is cached, so an installed app always runs the
latest deploy and never shows stale bookings or payment states. (Chrome no
longer needs a service worker to install a site; offline use is out of
scope.)

- `public/manifest.webmanifest`: name *Booking System Demo*, short name
  *Bookings*, `start_url` `/listings`, `display: standalone` (own window,
  no address bar), `theme_color` `#efedf0` (the toolbar's colour, so the
  phone's status bar blends in), `background_color` `#faf9fd` (the splash
  screen), two shortcuts (long-press the icon): *Find a stay*, *My bookings*.
- Icons in `public/icons/`: `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (full-bleed, the house inside Android's 80 % safe
  zone, so circle/squircle masks never cut it), `apple-touch-icon.png`
  (180 px, no transparency), `icon.svg` (favicon in modern browsers) +
  `favicon.ico` (16/32/48). An original white house on the app's azure
  (`#005cbb`).
- `index.html`: `<link rel="manifest">`, `theme-color`, the icons, the iOS
  home-screen title and status bar, `viewport-fit=cover`.
- The manifest and icons are plain files in `public/`, so Render serves
  them as they are (the `/*` → `index.html` rewrite only applies to paths
  that aren't files).

**Install button** (`core/pwa/install.service.ts` + the toolbar):

| Browser | What the user sees |
|---|---|
| Chrome / Edge (desktop), Chrome / Samsung Internet (Android) | **Install app** in the account menu, or an install icon next to *Log in* when logged out. Only appears once the browser fires `beforeinstallprompt` (it's installable and not installed yet); tapping it shows the browser's own install prompt. |
| Safari on iPhone / iPad | The same button, always (Safari has no install event); it opens **"Install the app"** with the steps *Share → Add to Home Screen → Add* (`core/pwa/install-ios-dialog.ts`). |
| Already installed / running as the app | No button (`display-mode: standalone`, or iOS `navigator.standalone`, or the `appinstalled` event). |
| Firefox, desktop Safari | No button (no install support to trigger); their own menus still work. |

`InstallService` is created at start-up by `App`, so the browser's one-off
event is caught even before the toolbar exists; each prompt event is used
once (the browser sends a new one later if the user said no).

### Checked

- Chrome's own installability check (DevTools protocol
  `Page.getInstallabilityErrors`) on the production build: **no errors**;
  manifest parsed with no errors, app id `/`.
- iPhone emulation: the install icon next to Log in, and the steps dialog
  fits a 390 px screen.
- `scripts/hosted-check.sh` (the "Hosted demo check" workflow) now also
  checks that the site serves the manifest and the 512 px icon.
- Production build: initial bundle 600 kB raw / 146 kB transferred, no
  budget warnings.

Tests: 9 new Vitest tests - `install.service.spec.ts` (7: nothing offered
until the browser's event, the browser's mini-bar suppressed, the prompt
replayed once and its answer returned, hidden after `appinstalled`, iPhone
and iPad (Mac with touch) detection → the steps, never offered when already
running as the app) and the toolbar (2: the logged-out icon and the menu
item, the iPhone steps dialog). **225 frontend tests pass.**

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
| `Review` | `reviews/admin.py` | Filterable by rating and hidden |
| `Favorite` | `favorites/admin.py` | Searchable by user and property |
| `Payment` | `payments/admin.py` | Filterable by status; Stripe fields read-only (Stripe owns them) |
| `StripeEvent` | `payments/admin.py` | Read-only log of handled webhook events |

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
  of amenities. Each one also gets a **map position** near its city
  (TICKET-034): a random point within 400 m-1.5 km of a spot a little
  inland of the town centre (`listings/geo.py:CITY_CENTRES`), so pins
  don't land in the sea.
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
  confirmed booking for that property (the same rule the API enforces
  since TICKET-032), with a rating distribution skewed positive
  (mostly 4-5 stars) and realistic per-rating comment text rather than
  Faker's default lorem-ipsum, so it looks authentic in front of an
  audience.
- **Favorites** (TICKET-033) - every guest saves 2-5 active places, so
  the hearts, the Saved page and the admin "Saved by" column have
  something to show (about 40 in total). The **first guest** (`guest_0_…`)
  also keeps one **retired** place saved - the Saved page's greyed-out
  "No longer available" card, listed first. If the random mix retired no
  property, the seeder retires the last one for that. The demo admin
  saves nothing (admins have no hearts).

Usage:

```bash
docker compose exec backend python manage.py seed_demo_data
```

Options:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--clear` | off | Delete previously seeded data first (favorites, reviews, bookings, images, properties, `guest_*`/`@example.com` users, and the demo admin) before re-seeding. Real accounts are never touched. |
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
| `STRIPE_SECRET_KEY` | Set by hand in the Render dashboard (`sync: false`): a restricted `rk_test_…` key with Checkout Sessions: Write and Charges and Refunds: Write. Empty = payments off (TICKET-029/040, see "Payments on Render") |
| `STRIPE_WEBHOOK_SECRET` | Set by hand (`sync: false`): the `whsec_…` of the Stripe webhook endpoint pointing at this API |
| `FRONTEND_URL` | `https://booking-demo-g4aw.onrender.com` - where Stripe sends guests back after paying, and the links in emails |
| `EMAIL_PROVIDER` | `gmail` (TICKET-030) - booking emails through the Gmail API, sent as the owner's Gmail |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Set by hand (`sync: false`): the Google OAuth "Desktop app" client and the refresh token from `manage.py gmail_authorize`. Missing = emails only printed to the log (see "Emails on Render (Gmail API)") |
| `DEFAULT_FROM_EMAIL` / `BOOKING_ALERT_EMAILS` | Set by hand (`sync: false`): the sender - **the same Gmail** that authorised the API, e.g. `Booking System Demo <you@gmail.com>` - and who gets the new-booking alert (and admin accounts' booking emails). Kept out of the public repo |

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

## Demo day (TICKET-028)

The TechPro Academy Tech Meetup is on **Oct 1, 18:00-20:30**. The plan:
show the app **locally** (fast, doesn't depend on the venue wifi), and give
recruiters the **hosted link** to try afterwards.

### Before leaving home

- [ ] TICKET-041 (simple demo logins) and TICKET-039 (final redeploy +
      smoke test) are done
- [ ] The local app runs from scratch, since the venue may have no
      internet: `docker compose up -d`, then open http://localhost:4200.
      The footer dot is green ("API & database connected"). Log in once as
      the admin and once as a guest.
- [ ] The QR code is ready: `docs/booking-demo-qr.png`, on your phone or
      printed. It opens https://booking-demo-g4aw.onrender.com.

### Meetup day: keep it awake for the whole evening

**Around 17:30 on Oct 1: GitHub → Actions → "Keep demo awake" → Run
workflow** (hours: **3**, the default). This also works in the GitHub
mobile app. The run:

1. runs the full hosted check first, so the evening starts awake and
   verified. It fails straight away if something's broken.
2. then pings the API's health check (which also reaches the database)
   **every 10 minutes for 3 hours**, i.e. until ~20:30. That's below Render's
   15-minute sleep timer, so the API never falls asleep and every recruiter
   who scans the QR code gets an instant page.

Details:

- **Stopping early:** cancel the run on GitHub. **Starting it again**
  replaces the previous run (`concurrency`), so two never run at once.
- **If the API stops answering:** each missed ping is a warning in the
  log. After **3 missed pings in a row** the run fails, and GitHub emails
  you.
- **Cost:** free. Public repos get free GitHub Actions minutes, and 3
  hours is a tiny part of Render's 750 free hours a month.
- **Tested:** locally with a short window: 1 minute, a ping every 20 s,
  3 OK pings, then "Kept awake until …". With the API switched off it
  failed after 3 missed pings.

### A few minutes before showing the hosted link (any other day)

The free API sleeps after 15 minutes without visitors, and the first
visit then takes about a minute. Wake it up first. Either way works:

1. **GitHub → Actions → "Hosted demo check" → Run workflow**. This also
   works in the GitHub mobile app. It wakes the API, waits for it (up to
   ~3 minutes), then checks the whole chain and shows a green list on the
   run's summary page:
   - the API's health reports the database as `connected`
   - the API lists properties
   - the site serves the Angular app, deep links included
   - CORS allows the site
   - the security headers are present

   If anything is wrong the run turns red with the reason (for example
   "CORS: the API doesn't allow …"), and GitHub emails you.
2. Or just open the site and wait for the listings. While the API wakes
   up, the site shows the amber **"Waking up the demo server"** banner,
   so a visitor knows it's loading, not broken.

After that, it stays awake for about 15 minutes after the last visitor.
If a recruiter opens the link days later, the banner explains the wait.

The same check runs anywhere with bash, curl and python3:
`bash scripts/hosted-check.sh` (`API_URL` and `SITE_URL` override the
addresses). It was tested against a local copy of the production setup
(gunicorn plus the built site with the same rewrite and headers). It
passes there, and it fails on the CORS step, with the message above, when
the site address is wrong. The first real run on GitHub, against the live
site, passed all five checks.

### Dates to remember

- **~Oct 25:** Render's free Postgres expires 30 days after creation
  (Sep 25), then has a 14-day grace period. Upgrade it or recreate it
  (the Blueprint seeds a new empty database on the next deploy) before
  sharing the link again after that.
- Free web services get 750 hours a month per workspace. One API that
  sleeps when idle uses far less.

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
| `STRIPE_SECRET_KEY` | backend | Stripe restricted key `rk_test_...` (Checkout Sessions: Write + Charges and Refunds: Write). Empty = payments off. See "Payments (Stripe)" |
| `STRIPE_CLI_API_KEY` | stripe-cli (local only) | Full `sk_test_...` key for the local webhook forwarder (`docker-compose.yml`). Unset = forwarding off. Never on Render |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_FILE` | backend | Webhook signing secret (Render), or the file the local stripe-cli service writes it to (`/stripe/webhook_secret`, set in `docker-compose.yml` - leave `STRIPE_WEBHOOK_SECRET` unset locally) |
| `STRIPE_CHECKOUT_HOLD_MINUTES` / `FRONTEND_URL` / `STRIPE_API_VERSION` / `STRIPE_ALLOW_LIVE_KEYS` | backend | Optional: date-hold length (default 30), where Stripe returns the guest (default `http://localhost:4200`), pinned API version, live-key override (default off) |
| `EMAIL_PROVIDER` | backend | Where emails go: `console` (log, default), `smtp` (Docker sets this → Mailpit), `gmail` (Render). See "Emails" |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | backend | Gmail API credentials for `EMAIL_PROVIDER=gmail` (the refresh token from `manage.py gmail_authorize`); without all three, emails are printed to the log |
| `DEFAULT_FROM_EMAIL` | backend | The sender, e.g. `Booking Demo <you@gmail.com>` - with the Gmail API, the authorised Gmail itself |
| `BOOKING_ALERT_EMAILS` | backend | Comma-separated list that gets the "new booking" alert and admin accounts' booking emails. Empty = no alert |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` / `EMAIL_USE_TLS` / `EMAIL_TIMEOUT` / `EMAIL_SENDING_STALE_MINUTES` | backend | SMTP details (Docker: `mailpit:1025`), timeout in seconds (default 10), minutes before a stuck send is retried (default 10) |
| `POSTGRES_DB/USER/PASSWORD` | db, backend, pgadmin | Database name and credentials |
| `PGADMIN_DEFAULT_EMAIL/PASSWORD` | pgadmin | Login for the pgAdmin web UI itself |
| `GEOCODING_URL` / `GEOCODING_USER_AGENT` / `GEOCODING_LANGUAGE` / `GEOCODING_TIMEOUT` | backend | Optional: the admin form's "Find on map" place search (TICKET-034). Defaults: OpenStreetMap Nominatim, an identifying User-Agent for this project, `en`, `5` seconds. An empty `GEOCODING_URL` switches the search off. See "Admin place search API" |

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
  in TICKET-012, gunicorn + whitenoise in TICKET-026, or stripe in
  TICKET-029). Rebuild the image
  with `docker compose up -d --build backend`.
- **After pulling new code: "relation/column does not exist"**: a ticket
  added a migration (e.g. TICKET-015's `bookings/0002`). The container runs
  `migrate` only when it starts, and hot reload doesn't. Either restart it
  (`docker compose restart backend`) or run
  `docker compose exec backend python manage.py migrate`.
- **Paid locally, but the page stays on "Waiting for confirmation"**
  (TICKET-029): the webhook isn't reaching the backend. `docker compose
  logs stripe-cli` - "forwarding is OFF" → add `STRIPE_CLI_API_KEY` to
  `.env` and `docker compose up -d`; `<-- [400]` → secrets don't match,
  `docker compose restart stripe-cli`; `<-- [503]` → the backend has no
  secret, `docker compose up -d` (it needs the shared volume). Then run
  `docker compose exec backend python manage.py release_stale_holds` to
  settle any booking whose webhook was missed (it asks Stripe first).
- **No email arrived** (TICKET-030): locally, open Mailpit at
  http://localhost:8025 - emails never reach a real inbox from Docker unless
  `EMAIL_PROVIDER=gmail` is set. Otherwise look at Django Admin → *Booking
  emails*: `failed` shows the reason (`invalid_grant` → the refresh token was
  revoked/expired, run `gmail_authorize` again; `invalid_client` → wrong
  `GMAIL_CLIENT_ID` / `SECRET`; `403 … Delegation denied` or similar →
  `DEFAULT_FROM_EMAIL` isn't the authorised Gmail; `Couldn't reach …` →
  Google/Mailpit down) - fix it, then select the row → *Retry sending* (or
  `manage.py send_pending_emails`). `skipped` means the booking changed
  before the email could go out. No row at all: the account has no email,
  or `BOOKING_ALERT_EMAILS` is empty for the admin alert. Sent but not in
  the inbox: check spam; the Gmail's *Sent* folder shows what went out.
- **Ports already in use**: something else on your machine is using 4200,
  8000, 5432, 5050 or 8025. Either stop it or change the left-hand side of the
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
and "Frontend on Render". TICKET-028 adds the "Hosted demo check" button
and the meetup plan; see "Demo day". **Epic 6 has started:** TICKET-029
(Stripe test-mode checkout) is **done** - the `payments` app (data model,
Stripe settings and startup checks), the payment hold at booking time and
the idempotent checkout endpoint, the signed, de-duplicated webhook that
confirms or releases bookings, settling holds whose webhook was missed,
closing the payment page before a cancel, the frontend (Confirm and pay,
the return page, Pay now with a live countdown, the admin Payment column),
the `stripe-cli` forwarder in Docker and the Render setup - all tested end
to end locally and on Render; see "Payments (Stripe)", "Payments: business
rules & test cases" and "End-to-end results". **TICKET-040 (automatic
refunds) is done:** cancelling a paid booking refunds the full amount
automatically (guest before the 48h deadline, admin any time), Stripe's
refund events confirm it, admins have Refund now and `sync_refunds` for
anything that failed or was missed, and every screen shows where the money
is - tested end to end locally and on Render; 214 backend and 213 frontend
tests pass. See "Refunds (TICKET-040)" and "Refunds: business rules & test
cases". **TICKET-030 (booking emails) is in progress:** step 1 (the
`BookingEmail` outbox, the email settings, the email backend and the
Mailpit service) and step 2 (the four emails - received, confirmed,
cancelled, admin alert - sent at every booking change) and step 3
(`send_pending_emails` + a Retry action in Django Admin) are done, and
**TICKET-030 is done**: tested end to end locally (Mailpit) and on Render
(the owner alert in the real Gmail inbox); changes after review: admin
accounts' mail goes to the owner's inbox, and emails are sent through the
**Gmail API** as the owner's real Gmail (Brevo removed) - tested locally
and on Render; see "Emails". **TICKET-031 (responsive layout + PWA) is
done:** shared breakpoints, admin tables as cards, the detail page's bottom
bar, safe areas, and the app is installable (manifest + icons, no service
worker) with an Install app button (iPhone: the Share → Add to Home Screen
steps); see "Mobile & PWA". **TICKET-032 (reviews/ratings) is in
progress:** step 1 (the reviews API - public list with a star summary,
posting after a confirmed stay, `can_review`/`my_review` for the buttons,
admin hide/unhide) is done; see "Reviews API (TICKET-032)"; step 2 (the
Reviews section on the property page: star summary with per-star bars,
reviews, Show more) is done; see "Property detail page → Reviews
section"; step 3 (writing a review: the shared review dialog with a star
picker, "Write a review" on the property page and "Leave a review" on past
stays in My bookings) is done; see "The review dialog"; step 4 (the admin
Reviews page with filters and Hide / Show again) is done; see "Admin
reviews"; **TICKET-032 is done** (step 5: full test runs, a 27-check
browser regression on a fresh database and the live Render check; see
"Reviews: final check"). **TICKET-033 (favorites) is in progress:** step 1
(the favorites API - save/remove, the Saved list, `is_favorite` on every
card and `favorite_count` for admins) is done; see "Favorites API
(TICKET-033)"; step 2 (the heart on every listing card and the property
page, with logged-out → login → saved) is done; see "Favorites: the
heart"; step 3 (the `/favorites` Saved page: Saved in the toolbar and the
account menu, Undo, deactivated places greyed out with Remove) is done;
see "Saved page"; step 4 (a "Saved by" column in admin Properties, and
"Saved by N guests" on the tablet/phone cards) is done; see "Admin
properties"; **TICKET-033 is done** (step 5: the seeder saves places for
the demo guests, full test runs, a 68-check browser regression on a fresh
database and the live Render check as admin and as a guest; see
"Favorites: final check"). **TICKET-034 (map view) is in progress:** step 1
(map positions on properties: `latitude`/`longitude`, exact for admins and
a ~500 m area for everyone else, the backfill migration and seeded
positions) is done; see "Map positions API (TICKET-034)"; step 2 (`GET
/api/properties/map/`: every stay matching the listings filters as a map
pin, with `missing_position` and a 500-pin safety limit) is done; see "Map
pins API (TICKET-034)"; step 3 (`GET /api/admin/geocode/`: up to 5
specific places in Greece from OpenStreetMap Nominatim for the admin
form's Find on map - cached, 1 request/s, 503 when unavailable) is done;
see "Admin place search API (TICKET-034)"; step 4 (the shared `<app-map>`
component: Leaflet + map tiles (CARTO Voyager at first, softened OpenStreetMap since step 5), price tags, `leaflet.markercluster`
bubbles, approximate-area circles, pop-up template, map clicks - all
lazy-loaded, initial bundle unchanged) is done; see "Shared map component
(Angular, TICKET-034)"; step 5 (the `/listings` map: a 60/40 split view
from 1100 px with a sticky map, Show map / Show list with `?view=map` on
phones, pins for every matching stay, card hover lifts its tag, pop-up card
with photo, rating, price, stay total and heart; the base map switched to
softened OpenStreetMap because CARTO now needs a key) is done; see
"Listings map (Angular, TICKET-034)". Next: step 6, the map on the
property page.
