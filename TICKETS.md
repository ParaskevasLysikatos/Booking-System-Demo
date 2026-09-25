# Booking System Demo — Tickets

Derived from `Booking System Demo — Build Plan.md` (Sep 24, 2026). Each
ticket is meant to be picked up on its own — hand them out one at a time.

**Priority key:** P0 = must-have (protect no matter what) · P1 = attempt
next if schedule allows · P2 = nice-to-have / first to cut if behind.

**Status key:** `[x]` done · `[ ]` not started.

---

## Epic 0 — Foundation & Infrastructure

- [x] **TICKET-001** — Scaffold Django + Angular + Postgres, wired together in Docker
  - Priority: P0
  - Django project (`config/`) + Angular app (Angular Material added), `docker-compose.yml` with hot-reload volumes for both.
  - Done: `docker compose up --build` brings up all services.

- [x] **TICKET-002** — Three-way connectivity check
  - Priority: P0
  - `/api/health/` runs a real query against Postgres; Angular's `ApiStatusComponent` calls it on load and shows the result.
  - Done: `localhost:4200` shows "Backend: connected" / "Database: connected".

- [x] **TICKET-003** — pgAdmin service with persistent config
  - Priority: P1
  - `pgadmin` service in `docker-compose.yml`, `pgadmin_data` volume so registered servers survive container recreation.
  - Done: verified working, DB browsable at `localhost:5050`.

- [x] **TICKET-004** — First commit to GitHub
  - Priority: P0
  - Repo initialized, `.gitignore` correctly excludes `.env`/`node_modules`, pushed to `origin/master`.

---

## Epic 1 — Data Layer

- [x] **TICKET-005** — `Property` model + migration
  - Priority: P0
  - Depends on: TICKET-001
  - Fields: `title`, `description`, `location`, `price_per_night`, `capacity`, `amenities`, `is_active`.
  - Acceptance: migration applies cleanly; model registered in Django Admin.
  - Done: new `listings` app (dedicated app for domain models, separate from the infra-only `core` app — `PropertyImage` will join it next; `accounts`/`bookings` apps planned for later tickets). `listings/models.py` adds `Property` with the ticket's fields plus `created_at`/`updated_at` timestamps; `amenities` is a `JSONField` (list of strings), `price_per_night` a `DecimalField`. Migration `listings/migrations/0001_initial.py` generated via `makemigrations` and verified with `manage.py check` + `makemigrations --check` (no live Postgres reachable from this environment, so the actual `migrate` against Postgres still needs to run via `docker compose up`). Registered in Django Admin (`listings/admin.py`, list/search/filter configured). README updated with a new "Data model" section and refreshed "Next steps".

- [x] **TICKET-006** — `PropertyImage` model + migration
  - Priority: P0
  - Depends on: TICKET-005
  - Fields: `property` (FK → Property), `image`, `is_cover`.
  - Acceptance: a property can have multiple images, exactly one flagged `is_cover` (validate or document the convention).
  - Done: added to the `listings` app alongside `Property`. `image` is a `URLField` (stock photo URLs for now — TICKET-036 swaps in real uploads later). "Exactly one cover" is enforced both ways: `PropertyImage.save()` un-covers any sibling when one is flagged `is_cover=True`, and a partial `UniqueConstraint` (`unique_cover_image_per_property`) backstops it at the DB level against bulk `.update()` calls that skip `save()`. `Property.cover_image` falls back to the earliest-added image when none is flagged. Verified with a real migrate + ORM exercise against a throwaway SQLite DB (cover hand-off, DB-constraint rejection, fallback ordering all passed) since Postgres isn't reachable from this environment. Registered in Django Admin with an inline on the Property page plus a standalone list. README's "Data model" section and "Next steps" updated.

- [x] **TICKET-007** — `Profile` model + migration
  - Priority: P0
  - Depends on: TICKET-001 (built-in `User`)
  - Fields: `user` (OneToOne → User), `role` (`guest`/`admin`), `phone`.
  - Acceptance: a `Profile` is auto-created on user signup (signal or `get_or_create` in the register view) so every user has a role.
  - Note: build plan allows substituting `is_staff` for admin instead of `Profile.role` — pick one and use it consistently across TICKET-013/014.
  - Decision: went with `Profile.role` (not `is_staff`) — kept independent of Django's built-in admin-site access; TICKET-013/014 should check `Profile.role == 'admin'` (`Profile.is_admin` convenience property added).
  - Done: new `accounts` app (sibling to `listings`, per the TICKET-005 plan). `Profile` has `role` (TextChoices guest/admin, default guest) and `phone`. A `post_save` signal on `User` (`accounts/signals.py`, wired via `AccountsConfig.ready()`) auto-creates a Profile on every user-creation path — not just a future register view — seeding `role='admin'` for staff/superuser accounts and `'guest'` otherwise; `role` stays independently editable afterwards. Migration `accounts/migrations/0001_initial.py` generated and verified with `manage.py check` + `makemigrations --check`. Behavior verified against a throwaway SQLite DB: regular user → guest, superuser → admin, no duplicate Profile on re-save, editing `role` doesn't touch `is_staff`. Registered in Django Admin as an inline on the built-in User page plus its own list. README's "Data model" section and "Next steps" updated.

- [x] **TICKET-008** — `Booking` model + migration
  - Priority: P0
  - Depends on: TICKET-005, TICKET-007
  - Fields: `property` (FK), `guest` (FK → User), `check_in`, `check_out`, `total_price`, `status` (`pending`/`confirmed`/`cancelled`), `created_at`.
  - Acceptance: no separate `Availability` model — availability is computed by querying non-cancelled `Booking` rows that overlap the requested date range.
  - Done: new `bookings` app (completes the app split alongside `listings`/`accounts`). `property` uses `on_delete=PROTECT` (booking history shouldn't block a hard-delete silently — use `Property.is_active` to retire a property instead); `guest` uses `CASCADE`. The acceptance criterion's query is implemented now as `Booking.objects.overlapping(property, check_in, check_out)` (a custom QuerySet method) — the standard interval-overlap test, cancelled bookings excluded by default — so TICKET-015's `POST /api/bookings/` can call it directly instead of reinventing it. `check_out > check_in` enforced twice: `clean()` (`ValidationError`) plus a DB `CheckConstraint` backstop. Verified against a throwaway SQLite DB: overlap detection, adjacent-range non-overlap, per-property isolation, cancelled-exclusion (and opt-in inclusion), `clean()` rejection, and the DB constraint all passed. Registered in Django Admin (filterable by status, date-hierarchy on `check_in`). README's "Data model" section and "Next steps" updated.
  - Follow-up raised after this ticket shipped: `Booking.objects.overlapping()` is a query, not a concurrency guarantee — two simultaneous `POST /api/bookings/` requests for the same property/dates can both pass that check before either commits (a classic check-then-act race). That gap, plus the equivalent one for cancellations and Stripe payments, is deliberately delegated forward rather than patched onto this already-shipped ticket — see the new requirements added to TICKET-015 and TICKET-029.

- [x] **TICKET-009** — `Review` model + migration (nice-to-have)
  - Priority: P2
  - Depends on: TICKET-005, TICKET-007
  - Fields: `property` (FK), `guest` (FK), `rating`, `comment`, `created_at`.
  - Done: new `reviews` app (same one-app-per-model pattern as `listings`/`accounts`/`bookings`). `property` uses `on_delete=PROTECT` (same reasoning as `Booking` — use `Property.is_active` to retire a property instead of deleting review history); `guest` uses `CASCADE`. `rating` is a `PositiveSmallIntegerField` validated 1–5. Two invariants added beyond the bare fields, each enforced at both the application and DB layer (matching `PropertyImage`/`Booking`'s pattern): rating in range 1–5 (field validators + a DB `CheckConstraint` backstop), and one review per guest per property (`full_clean()`'s built-in uniqueness check + a DB `UniqueConstraint` backstop — a guest updates their existing review rather than duplicating). Verified against a throwaway SQLite DB: valid reviews from different guests, out-of-range ratings and duplicate (property, guest) pairs rejected at the application level, and both DB constraints rejecting the same via a bulk `.create()` that bypasses `clean()`. Registered in Django Admin (filterable by rating). README's "Data model" section and "Next steps" updated.

- [x] **TICKET-010** — Register all models in Django Admin
  - Priority: P0
  - Depends on: TICKET-005–008
  - For quick DB inspection during development only — not the demo-facing admin UI (that's Epic 4).
  - Done: mostly a verification pass, since each model got its admin registration as it shipped (TICKET-005–009). Confirmed against the live admin registry (`admin.site._registry`), not just assumed: `Property`, `PropertyImage`, `Profile`, `Booking`, `Review`, and the built-in `User` (customized with a `Profile` inline) are all registered. Added one small polish in the spirit of the ticket: `core/admin.py` (that app has no models of its own) relabels the admin site itself — header "Booking System Demo — Dev DB Inspection" — so it's unmistakable at a glance that this is the dev tool, not the demo-facing UI. README gets a new consolidated "Django Admin" section instead of repeating the same note per model.

- [x] **TICKET-011** — Faker seed script
  - Priority: P0
  - Depends on: TICKET-005–008
  - A management command (e.g. `seed_demo_data`) that generates realistic properties, images (stock URLs are fine per the cut list), and bookings so the demo doesn't look empty.
  - Done: `core/management/commands/seed_demo_data.py` (`python manage.py seed_demo_data`), built with Faker. Generates 14 properties (Greek locations, curated adjective/noun titles, realistic price/capacity/amenities), 2-5 images each (picsum.photos URLs, first flagged as cover), 10 guest users (`guest_<n>_<name>` / `...@example.com`, shared password `DemoPass123!`), 0-5 bookings per property (reusing `Booking.objects.overlapping()` so seeded bookings never conflict, mix of past/future and pending/confirmed/cancelled), and reviews only from guests with a genuine past non-cancelled booking (skewed-positive ratings, realistic per-rating comments instead of lorem-ipsum). `--clear` (wipes only seeded data — reviews/bookings/images/properties plus `guest_*`/`@example.com` users, real/admin accounts untouched), `--properties`, `--guests`, and `--seed` flags. Whole command wrapped in one `transaction.atomic()`. Verified against a throwaway SQLite DB: correct counts, exactly one cover image per property, zero overlap violations, every review traces to a real past booking, ratings in range, a manually-created superuser survives `--clear`, and repeated `--clear` + reseed runs cleanly. README gets a new "Seeding demo data" section.
  - Follow-up: added one fixed-credential demo admin (`admin_demo` / `AdminPass123!`) to the same command, created as a superuser so the existing `Profile.role` signal promotes it to `role="admin"` the same way a real admin account would be. Idempotent (re-running without `--clear` leaves an existing one alone instead of erroring), included in `--clear`'s cleanup, and a separately-created real superuser account verified to survive `--clear` untouched. README's "Seeding demo data" section updated.

---

## Epic 2 — Backend API (DRF)

- [x] **TICKET-012** — JWT auth endpoints
  - Priority: P0
  - Depends on: TICKET-007
  - `POST /api/auth/register/`, `POST /api/auth/login/`, `POST /api/auth/refresh/` via `djangorestframework-simplejwt`.
  - Acceptance: register creates a `User` + `Profile` (role `guest`); login returns access + refresh tokens.
  - Decisions (agreed before building): **email + password login** (username auto-derived from the email on register, never shown to users); register returns the user **plus** tokens (logged in straight away); `email`/`username`/`role` added as **custom JWT claims** plus a new `GET /api/auth/me/` (always-current role — the claim is only a UI hint, TICKET-014 must re-check `Profile.role` server-side); lifetimes **30 min access / 1 day refresh**, no rotation/blacklist (so no server-side logout).
  - Done: `djangorestframework-simplejwt` added; `JWTAuthentication` is now DRF's default auth class (default permission still `AllowAny`, views tighten it). New `accounts/backends.py:EmailBackend` (case-insensitive email lookup; refuses login if two accounts share an email rather than guessing; runs the hasher on unknown emails to blunt timing-based enumeration), registered alongside `ModelBackend` so username login to the dev `/admin/` site still works. `accounts/serializers.py`: `RegisterSerializer` (lowercases + uniqueness-checks email, runs Django's `AUTH_PASSWORD_VALIDATORS`, no `role` field so nobody can self-register as admin, `transaction.atomic()` create; the Profile still comes from the existing `post_save` signal, register only fills in optional `phone`), `UserSerializer`, and `EmailTokenObtainPairSerializer` (claims). Views in `accounts/views.py`, routes in `accounts/urls.py` mounted at `/api/auth/`. `register/`/`login/`/`refresh/` have `authentication_classes = []` so a stale token attached by the future interceptor can't 401 a login. `JWT_ACCESS_MINUTES`/`JWT_REFRESH_DAYS` env overrides added to `.env.example`; dev-default `SECRET_KEY` lengthened to ≥32 bytes (JWT HMAC key-length warning). Seed command's summary output now prints the email logins. 19 API tests in `accounts/tests.py`, all passing against SQLite (Postgres not reachable from this environment); also smoke-tested end-to-end after `seed_demo_data` (admin + guest login by email, `/me/`). `manage.py check` + `makemigrations --check` clean (no migrations needed). README: new "Authentication (JWT)" section (endpoints, design, curl examples, tests), project layout/env vars/status/next steps updated.
  - Follow-up (not done, low priority): Django's `User.email` isn't unique at the DB level — register enforces it, but a concurrent double-submit could still create two accounts with the same email (login would then refuse both). If it matters later, add a partial unique index on `LOWER(email) WHERE email <> ''` via a `RunSQL` migration in `accounts`.

- [x] **TICKET-013** — Property serializer + viewset
  - Priority: P0
  - Depends on: TICKET-005, TICKET-006
  - `GET /api/properties/` (filterable by location, guests, price range, check-in/check-out), `GET /api/properties/{id}/` (detail + availability), `POST` / `PATCH` / `DELETE` restricted to admin.
  - Acceptance: filtering works via query params; non-admin `POST`/`PATCH`/`DELETE` returns 403.
  - Decisions (agreed before building): TICKET-014 built alongside (needed for the 403 acceptance); `DELETE` is a **soft delete** (`is_active=False`, 204; reactivate via `PATCH`), because `Booking.property` is `PROTECT`; images are **nested + writable** (sending `images` on PATCH/PUT replaces the set, omitting it leaves images alone); list **paginated**, 12/page (`?page_size=` up to 50).
  - Done: `listings/serializers.py` has a list/card serializer (`cover_image`, `rating_avg`, `review_count`) and a detail serializer that also handles admin writes (nested images, `price_per_night` > 0, `capacity` >= 1, at most one cover, amenities trimmed and de-duplicated, `transaction.atomic()` create/update). Its `availability` block lists upcoming non-cancelled `booked_ranges` (dates only, no guest or status info) and, with `?check_in=&check_out=`, `is_available`. `listings/filters.py` validates query params with a DRF serializer (no django-filter dependency; bad input → 400 per field): `location` (icontains), `guests` (capacity >=), `min_price`/`max_price` (inclusive), `check_in`+`check_out` (together, check-out > check-in, not in the past), `ordering` (`price`/`-price`/`capacity`/`-capacity`/`newest`), and `is_active` for admins only. The date filter reuses `Booking.objects.overlapping()` as a `NOT EXISTS` subquery: pending and confirmed bookings block, cancelled ones don't, and check-out day is exclusive. `listings/views.py:PropertyViewSet` uses `IsAdminOrReadOnly`; guests and anonymous visitors only see active properties (inactive = 404), admins see all. Ratings are annotated and images prefetched, so a list page is a fixed 3 queries (tested). Create/update responses are re-read with the same annotations. `core/pagination.py:StandardPagination` is reusable by later list endpoints. `listings/urls.py` (SimpleRouter) is mounted under `/api/`. 27 API tests in `listings/tests.py`; all 51 backend tests pass against SQLite (Postgres not reachable from this environment). Also smoke-tested on `seed_demo_data` output (filters, detail availability, anonymous POST 401, admin create + soft delete via real JWT). `manage.py check` + `makemigrations --check` are clean (no migrations). README: new "Properties API" section (filters table, response shapes, write rules, curl examples, tests); project layout, status and next steps updated.

- [x] **TICKET-014** — Admin permission class
  - Priority: P0
  - Depends on: TICKET-007
  - A DRF permission class checking `Profile.role == 'admin'` (or `is_staff`, per the choice made in TICKET-007) — applied to every admin-only endpoint.
  - Done (built together with TICKET-013): `accounts/permissions.py` has `is_app_admin(user)` (active + authenticated + `Profile.role == 'admin'`; a missing Profile counts as not-admin instead of raising), `IsAdminRole` (admins only) and `IsAdminOrReadOnly` (public reads, admin writes). The role is read from the DB on every request, never from the JWT's `role` claim, so promotions and demotions apply on the next request. `is_staff` is deliberately ignored in both directions. Anonymous → 401, non-admin → 403. Applied to `/api/properties/` now; TICKET-015/016 should use `IsAdminRole` / `is_app_admin` for their admin-only parts. 5 unit tests in `accounts/tests.py`, plus an end-to-end test in `listings/tests.py` that promotes and demotes a user holding a real token. README has a new "Permissions (admin vs guest)" section.

- [x] **TICKET-015** — Booking serializer + viewset
  - Priority: P0
  - Depends on: TICKET-008, TICKET-014
  - `GET /api/bookings/` (own bookings for a guest, all bookings for admin), `POST /api/bookings/` (create, with overlap validation against existing non-cancelled bookings), `PATCH /api/bookings/{id}/` (guest can cancel their own; admin can change status).
  - Concurrency requirements (delegated from TICKET-008 — closes the double-booking race):
    - `POST /api/bookings/`: `Booking.objects.overlapping()` alone is not race-proof (check-then-act). Add a Postgres `ExclusionConstraint` on `Booking` (needs the `btree_gist` extension — `django.contrib.postgres.operations.BtreeGistExtension` in a new `bookings` migration): `(property WITH =, daterange(check_in, check_out) WITH &&) WHERE status <> 'cancelled'`. This makes two overlapping non-cancelled bookings for the same property impossible at the DB level regardless of request timing — the real backstop, not just the pre-check.
    - Wrap booking creation in `transaction.atomic()`; catch the `IntegrityError` the constraint raises on a genuine race and return a clean 409/400 ("these dates were just booked by someone else") instead of a 500. Keep calling `overlapping()` first as a fast, friendly pre-check for the non-race case — just don't rely on it alone.
    - `PATCH /api/bookings/{id}/` (cancel/status-change): treat as a single atomic read-modify-write — `select_for_update()` the specific `Booking` row inside `transaction.atomic()` — so a guest's cancel and an admin's status change landing at nearly the same time can't produce a lost update. Validate the status transition explicitly (e.g. reject cancelling an already-cancelled booking, or confirming one that's cancelled) instead of blindly overwriting `status`.
  - Decisions (agreed before building): added a **`Booking.guests`** field (validated ≤ `Property.capacity`); guests may cancel their own booking (pending or confirmed) **only before check-in**; admin transitions are **strict**: `pending→confirmed`, `pending→cancelled`, `confirmed→cancelled`, and **cancelled is final**; stay limits are **1–30 nights**, check-in from today up to **365 days** ahead.
  - Done:
    - **Migration `bookings/0002_booking_guests_no_overlap.py`:**
      - adds `guests` (default 1, plus a DB `CheckConstraint` ≥ 1)
      - enables `BtreeGistExtension`
      - checks existing data first (`RunPython`): stops with a readable list of clashing booking pairs instead of a cryptic Postgres error
      - adds the `ExclusionConstraint` `booking_no_overlap_per_property`: `(property WITH =, daterange(check_in, check_out) WITH &&) WHERE status <> 'cancelled'`, with `[)` bounds so check-out day is exclusive, the same rule as `overlapping()`
      - `django.contrib.postgres` added to `INSTALLED_APPS`
    - **`bookings/serializers.py`:**
      - read serializer: property summary with cover, `nights`, `can_cancel` for the current caller, `guest_email` for admins only
      - create serializer: server-computed `total_price`, always `pending`, guest = the logged-in user; any client-sent price, status or guest is ignored; validation for an active property, the date rules above and capacity
      - status-only PATCH serializer: any other field is a 400
    - **`bookings/views.py:BookingViewSet`:**
      - guests see only their own bookings (someone else's is a 404), admins see all
      - filters: `?when=upcoming|past`, `?status=`, `?property=` (admin only); paginated
      - `POST`: the `overlapping()` pre-check returns 409, then the insert runs in `transaction.atomic()`; an `IntegrityError` for the exclusion constraint (SQLSTATE `23P01` + constraint name) becomes a clean 409 "just booked by someone else", while any other `IntegrityError` still raises
      - `PATCH`: `select_for_update(of=("self",))` inside `transaction.atomic()` plus the explicit transition tables (`Booking.ADMIN_TRANSITIONS` / `GUEST_TRANSITIONS`) → 400 with a reason
      - `PUT`/`DELETE` → 405
    - **Seed script:** now sets a random `guests` (1..capacity).
    - **Tests** (`bookings/tests.py`, 26):
      - DB-constraint tests
      - create, list and transition tests
      - **real concurrency tests** with threads, separate DB connections and committed data:
        - a barrier forces two requests past the pre-check before either inserts → exactly one 201 and one 409
        - a 6-request burst → one 201 and five 409s
        - a simultaneous guest cancel and admin cancel → one 200 and one 400 (no lost update)
    - **Verification:** all 77 backend tests pass on real Postgres. That was **Postgres 14** with contrib in the sandbox; the sandbox Postgres 16 build lacks the `btree_gist` extension, and the Docker `postgres:16-alpine` image does include it. `makemigrations --check` is clean. Smoke-tested after `seed_demo_data --clear`: admin list with emails, 409 on booking seeded dates, all seeded `guests` within capacity.
    - **README:** new "Bookings API" section (endpoints, create rules, the two-layer race protection, transition table, filters, curl, tests), data model, layout, status and next steps updated, and two new Troubleshooting entries (rebuild after new packages, migrate after new migrations).
  - To apply locally: `docker compose restart backend`. The container runs `migrate` on start, which creates the extension and the constraint.
  - Follow-up fix (during TICKET-021): simultaneous overlapping inserts can hit a Postgres **deadlock (40P01)** inside the exclusion check; the view now retries once (→ 409 or success) instead of returning a 500. See TICKET-021.
  - Change after review: guest cancellation now closes **48 hours before check-in**, instead of any time before check-in. Check-in is taken as **15:00 local time** on the check-in date (a setting, `BOOKING_CHECK_IN_TIME`; the hours are `BOOKING_GUEST_CANCELLATION_HOURS`, both overridable in `.env`). The logic is on the model: `Booking.check_in_datetime()` / `cancel_deadline()` / `guest_can_cancel()`, with the 48h subtracted in UTC so it's exact across DST. After the deadline a guest gets a 400 with the exact closing time; admins can still cancel any time. Responses now include `cancel_deadline`, and `can_cancel` uses the same rule. 3 new tests (mocked clock around the deadline, DST, configurable settings), all 80 backend tests passing on Postgres. **Refunds are out of scope here** (no payments exist yet) → **TICKET-040**.

- [x] **TICKET-016** — Admin stats endpoint
  - Priority: P1
  - Depends on: TICKET-015
  - `GET /api/admin/stats/` → booking counts, occupancy rate, revenue, for the admin dashboard (TICKET-023).
  - Decisions (agreed before building):
    - **Period:** defaults to the current calendar month, with `?from=&to=` for a custom range (both inclusive, max 366 days).
    - **Revenue:** spread **per night**, and only nights inside the period count. Confirmed = revenue, pending = expected revenue.
    - **Occupancy:** **confirmed nights only**; pending nights are reported separately.
    - **Extras:** a **per-property breakdown**.
  - Done:
    - `bookings/stats.py:compute_stats` reads the bookings whose stay overlaps the period in one query and computes everything in exact `Decimal`, rounded to cents once at the end.
    - Occupancy = confirmed nights of **active** properties ÷ (active properties × period nights). It is `null` when there are no active properties, not a misleading 0.
    - Retired properties' revenue still counts.
    - Cancelled bookings only appear in the status counts.
    - `bookings.created_in_period` counts bookings made in the period.
    - The breakdown lists every active property (including empty ones) plus retired ones that earned in the period, sorted by revenue.
    - `AdminStatsView` (`IsAdminRole`) at `GET /api/admin/stats/`; params are validated → 400.
    - The query count is constant regardless of data size (tested).
    - 10 tests with hand-calculated numbers (edge-crossing stays, boundary exclusions, cancelled, retired and empty properties, thirds rounding, single-night period, default month, empty period, null rate, bad params, 401/403, query count).
    - All 90 backend tests pass on Postgres. Smoke-tested on `seed_demo_data` output.
    - README: new "Admin stats API" section (definitions, response shape, curl, tests); layout, status and next steps updated (**Epic 2 complete**).

---

## Epic 3 — Frontend: Customer Experience

- [x] **TICKET-017** — `AuthService` + JWT interceptor + login/register pages
  - Priority: P0
  - Depends on: TICKET-012
  - Attaches the access token to outgoing requests, handles refresh on expiry, `/login` and `/register` routes.
  - Decisions (agreed before building):
    - tokens in **localStorage**
    - **reactive refresh** (on 401: refresh once and retry, no timer)
    - a **minimal toolbar** now (Log in / Sign up, or email + Log out); TICKET-022 adds the role-aware Admin link
    - no new npm packages
  - Done:
    - **`core/auth/`:**
      - `AuthService`: signals `currentUser` / `isLoggedIn` / `isAdmin`; `login`, `register` (logs in straight away), `loadMe`, `logout`, `expireSession`
      - `init()` runs through `provideAppInitializer`: it drops an expired refresh token without calling the API and re-reads the user and role from `/auth/me/`; the JWT role claim is never trusted
      - `TokenStorage`: localStorage with try/catch everywhere
      - `jwt.ts`: a tiny `exp` reader
      - `guestOnlyGuard` on `/login` and `/register`
      - `safeReturnUrl()` to block open redirects
    - **`authInterceptor`:**
      - adds the Bearer token to our API URLs only (never third-party or look-alike URLs), and not to login/register/refresh
      - on a 401: **one** refresh, shared by concurrent 401s, then a replay with the new token
      - a failed refresh → `expireSession()` → `/login?returnUrl=…&reason=expired`, with a "session expired" banner
      - no refresh loops; non-401 errors pass through
    - **`core/api-errors.ts`** maps DRF errors to per-field and general messages.
    - **Pages** (`pages/login`, `pages/register`, lazy-loaded Material forms):
      - checks as the user types; password confirmation re-checked when the first password changes
      - backend messages shown under the matching field
      - spinner and disabled button while submitting
      - redirect to `returnUrl` afterwards
    - **Home and toolbar:** the temporary `pages/home` (connectivity card) and `layout/toolbar`.
    - **Tests:** 34 Vitest tests (jwt, api-errors, service incl. `init()` cases, interceptor incl. 3 concurrent 401s → 1 refresh and no loop, login/register forms, toolbar states), all passing. `ng build` (production) is clean.
    - **Browser check:** the pages render and validate in the running app via Chrome; I did not submit real credentials.
    - **README:** new "Frontend auth" section; layout, status and next steps updated.

- [x] **TICKET-018** — `PropertyService` + `PropertyListComponent` (`/listings`)
  - Priority: P0
  - Depends on: TICKET-013
  - Grid of properties + filters (dates, location, guests, price).
  - Decisions (agreed before building):
    - search state in the **URL** (API param names)
    - dates, location and guests apply on the **Search button**; sort applies instantly and price after a 0.5 s pause
    - **Material paginator** (12/24/48 per page)
    - **`/` redirects to `/listings`**; the temporary home page was removed and the connectivity card became a footer status dot
  - Done:
    - **`core/properties/`:**
      - `PropertyService.list()` always sends `is_active=true`, so an admin sees the same active-only list; TICKET-024 lists all
      - `toPropertyParams()` leaves out empty values and defaults
    - **`core/dates.ts`:** local `YYYY-MM-DD` formatting with no UTC shift; parsing rejects roll-overs like Feb 30; DST-safe night counts.
    - **`core/money.ts`:** € formatting in one place.
    - **`pages/listings/`:**
      - the URL is the single source of truth (`queryParamMap` → `switchMap` → API, which cancels stale requests); the form is refilled from the URL with `emitEvent: false`
      - `listing-query.ts` converts both ways and drops junk from hand-edited URLs
      - Material date range picker (past dates and dates over 365 days ahead disabled, dd/mm/yyyy), location, guests 1–16, min/max €, sort, Clear filters
      - validation: a lone date or zero nights is blocked; min can't exceed max
      - states: skeleton, empty, a 400 with the API message humanized ("Check-in can't be in the past.") + Clear filters, a 5xx with Try again
      - paginator; changing pages updates the URL and scrolls to the top
    - **`property-card/`:**
      - cover photo (lazy-loaded, with a fallback), rating or "New", "Sleeps N", 3 amenity chips with readable labels + "+N"
      - € price / night, plus the stay total when dates are picked
      - links to `/listings/:id` carrying the dates and guests (the page arrives in TICKET-019)
    - **`layout/footer/`** has the API/DB status dot.
    - **Tests:** 20 new Vitest tests (54 total, all passing); the production build is clean.
    - **Checked in Chrome** against the seeded data: a URL search, typed Search, price refining, Back, a past-date URL and the empty state. This caught two bugs, both fixed: inactive properties were showing for admins (fixed with `is_active=true`), and "€91/ night" was missing its space.
    - **README:** new "Listings page" section; layout, status and next steps updated.

- [x] **TICKET-019** — `PropertyDetailComponent` (`/listings/:id`)
  - Priority: P0
  - Depends on: TICKET-018
  - Gallery, amenities, availability calendar, "Book Now" → routes to the booking form.
  - Decisions (agreed before building):
    - gallery = **hero + thumbnails + full-screen lightbox**
    - an **inline 2-month availability calendar** kept in sync with the booking panel
    - **Book now while logged out → login, then continue** (`/login?returnUrl=/booking/…`)
  - Done:
    - **`core/`:**
      - `PropertyService.get(id, dates?)` and the detail models
      - `core/properties/availability.ts` (`BookedNights`: `[check_in, check_out)` rules shared by the calendar, picker and validation)
      - `core/amenities.ts` (labels + icons, now shared with the cards)
    - **`pages/property-detail/`:**
      - "Back to results" returns to the exact previous listings search
      - header (rating/New, Sleeps N); the tab title becomes the property's name
      - `gallery/`: arrows, counter, thumbnails; the lightbox has ← → keys, swipe, Esc/backdrop to close and keeps the photo you closed on
      - all amenities with icons
      - `availability-calendar/`: two months (one on phones), shared ‹ › navigation, booked nights struck through; the check-in/check-out click flow disables invalid dates and allows checking out on someone else's check-in day
      - sticky booking panel: date range picker (booked nights disabled), guests capped at capacity, instant local checks (booked nights, check-out missing, 30-night and 365-day limits), then an API `is_available` confirmation driven by a single computed signal (glitch-free), a price breakdown estimate, and Book now only when confirmed
      - dates and guests are synced into the URL (`replaceUrl`)
      - states: skeleton, 404 "no longer available", Try again, and an admin "Hidden from guests" banner for inactive properties
    - **Route:** `listings/:id` has no static route title, so the router doesn't overwrite the property's title on every query change.
    - **Tests:** 22 new Vitest tests (76 total), all passing, including a test that caught and prevented a spurious availability request with half-updated values. The production build is clean.
    - **Checked in Chrome** against the seeded data: card → detail with the search carried over; booked nights Feb 4–15, 2027 on property 42; the clash message with Book disabled; a calendar pick ending on someone's check-in day → API "Available" / €364 / URL updated; the lightbox with ← → and Esc.
    - **README:** new "Property detail page" section; layout, status and next steps updated.
  - Note: Book now links to `/booking/:id?check_in=…&check_out=…&guests=…`, which lands back on the listings page until TICKET-020 adds the booking form.

- [x] **TICKET-020** — `BookingService` + `BookingFormComponent` (`/booking/:propertyId`)
  - Priority: P0
  - Depends on: TICKET-015, TICKET-019
  - Date picker, live price calculation, confirm → `POST /api/bookings/`.
  - Decisions (agreed before building):
    - **`authGuard` built now** (TICKET-021 reuses it)
    - **two steps** (Your trip → Review & confirm)
    - a **confirmation screen** after booking
  - Done:
    - **`core/bookings/`:**
      - `BookingService.create/get` + models
      - `booking-policy.ts`: 15:00 check-in and the 48h cancel-deadline *preview*, mirroring the backend settings; the server's `cancel_deadline` is shown after booking
    - **`core/properties/stay-rules.ts`:** shared stay validation messages and the picker date filter, now also used by the detail page and its calendar (removes duplicated logic).
    - **`core/auth/auth.guards.ts:authGuard`:** logged out → `/login?returnUrl=<booking URL>`.
    - **`pages/booking/`:**
      - a linear vertical `MatStepper`
      - step 1: dates (booked nights disabled) and guests pre-filled from and synced to the URL, instant local checks, then an API availability confirmation that gates Continue
      - step 2: review, the cancellation policy text, "pending, not charged" note, and Confirm booking
      - side card with photo and live price
      - Confirm: an in-flight guard (one POST even on a double click)
      - 409: message + booked nights reloaded (new ones crossed out) + back to step 1, keeping the form
      - 400: a humanized message
      - confirmation screen from the server response (#id, Pending, total, server deadline, My bookings / Browse more stays)
      - states: inactive/404 "can't be booked", error with Try again, bad id → listings; the page sets the tab title (no static route title)
    - **Tests:** 15 new Vitest tests (91 total), all passing; the production build is clean.
    - **Checked in Chrome** through steps 1 → 2; this caught a policy-line layout bug, now fixed. A real booking was **not** submitted from the browser without the user's go-ahead.
    - **README:** new "Booking form" section; layout, status and next steps updated.
  - Note: the confirmation's "My bookings" button lands on the listings page until TICKET-021 adds `/my-bookings`.

- [x] **TICKET-021** — `MyBookingsComponent` (`/my-bookings`) + `AuthGuard`
  - Priority: P0
  - Depends on: TICKET-017, TICKET-020
  - Upcoming/past bookings, cancel action; route guarded so only logged-in guests can reach it.
  - Decisions (agreed before building):
    - **small backend tweak**: `?mine=true` (own bookings only, even for admins) and a comma-list `?status=`
    - cancelling via a **confirmation dialog**
  - Done:
    - **Backend** (`bookings/views.py:BookingFilterSerializer`): `mine` and the comma-list `status`, both backward-compatible; unknown statuses → 400; 3 new tests.
    - **Frontend:**
      - `BookingService.list/cancel`
      - `pages/my-bookings/`:
        - Upcoming / Past / Cancelled tabs, with the tab and page in the URL
        - Upcoming and Past both exclude cancelled; Upcoming includes a stay in progress
        - booking cards: photo/title linking to the property, status chip + "Staying now", dates/nights/guests, server total, #id, booked-on date, "Waiting for the host to confirm"
        - the cancel deadline from the server with Cancel only when `can_cancel`, otherwise "Can no longer be cancelled online"
      - `cancel-dialog.ts`: "Keep booking" / red "Cancel booking", noting it's final and there's nothing to refund yet (TICKET-040)
      - cancel flow: PATCH → snackbar → list refresh (the card moves to Cancelled); a server refusal shows its reason and refreshes
      - states: skeletons, per-tab empty text + Browse stays, an error with Try again, a paginator
      - `/my-bookings` route behind the existing `authGuard`
      - a toolbar "My bookings" link (logged in only, highlighted while on the page)
    - **Tests:** 9 new frontend tests (100 total), all passing; the production build is clean.
    - **Checked in Chrome** as the demo admin: only their own booking #56 shows, the tabs work, and the dialog opened and was closed with Keep booking, so nothing was cancelled.
    - **README:** new "My Bookings page" section; the Bookings API filters table, layout, status and next steps updated. **Epic 3 is complete.**
  - **Bug found and fixed in TICKET-015's code while testing this ticket:**
    - With truly simultaneous overlapping inserts, Postgres sometimes resolves the exclusion-constraint wait with a **deadlock abort (40P01)** instead of 23P01. The concurrency test failed about 1 run in 3, and in production this would have been a 500.
    - `POST /api/bookings/` now retries once on a deadlock (the retry → 409 or success), and a repeated deadlock → 409.
    - 2 new tests; the concurrency test's barrier now only waits on the first attempt.
    - The concurrency tests passed 12/12 runs afterwards, and all 94 backend tests pass.

---

## Epic 4 — Frontend: Admin Experience

- [x] **TICKET-022** — `AdminGuard` + admin route group + role-aware `NavbarComponent`
  - Priority: P0
  - Depends on: TICKET-017
  - Admin routes only reachable by admin accounts; navbar shows the Admin link only when logged in as admin.
  - Decisions (agreed before building):
    - a **side-nav admin shell**
    - a friendly **403 page** for logged-in non-admins
    - a navbar with **links + an account menu** (email/role + Log out; links move into the menu on phones)
    - the guard **re-checks `/me/`** on entry
  - Done:
    - **`adminGuard`** (`core/auth/auth.guards.ts`):
      - logged out → login with returnUrl
      - logged in → `GET /auth/me/` first, so a demotion on the server wins over the cached role; if the server is unreachable, the cached role decides
      - non-admin → `/forbidden?from=…`
      - navigation only; the backend 403s remain the real protection
    - **`/admin` route group** (lazy, guarded once):
      - `pages/admin/admin-layout.ts`: side nav Dashboard/Properties/Bookings, active item + `aria-current`, Back to site, the admin's email; a top scroll bar on phones
      - `/admin` → `/admin/dashboard`
      - `admin-placeholder.ts` pages driven by route data, pointing to TICKET-023/024/025
    - **`pages/forbidden/`:** "Admins only" + who's logged in, Back to stays, and "Log in as someone else" (logs out and keeps the returnUrl).
    - **Toolbar:**
      - My bookings + Admin (admins only), with the active section highlighted
      - an account button → menu with email, Guest/Admin badge and Log out
      - follows the `isAdmin` signal live
      - on phones the links move into the menu
      - fixed the caret icon position (`iconPositionEnd`)
    - **Bundle budget:** the `angular.json` initial-bundle warning threshold was raised 500 kB → 700 kB (the Material menu took it to ~523 kB raw / ~127 kB transferred); the error limit stays at 1 MB.
    - **Tests:** 12 new Vitest tests (112 total), all passing; the production build is clean.
    - **Checked in Chrome** as the admin: the redirect, the side nav, the active Admin link, the account menu. The guest 403 is covered by tests.
    - **README:** new "Admin area" section; layout, status and next steps updated.

- [x] **TICKET-023** — `AdminDashboardComponent` (`/admin/dashboard`)
  - Priority: P1
  - Depends on: TICKET-016, TICKET-022
  - Stat cards: bookings, occupancy, revenue.
  - Decisions (agreed before building):
    - **presets + custom** period (in the URL)
    - a **per-property breakdown table** under the cards
    - **changes vs the previous period** on each card
  - Done:
    - **`core/admin/`:**
      - `AdminStatsService.getStats(from, to)`
      - `periods.ts`: presets This/Last/Next month, Next 30 days, Last 12 months (always ≤ 366 days); the comparison period (previous calendar month for whole months, else the same-length window before); URL parse/serialize with fallbacks; compact range labels; % and percentage-point changes flagged better/worse
    - **`pages/admin/dashboard/`:**
      - button-toggle presets + a Custom date range (max 366 days)
      - current + comparison stats loaded in parallel (`forkJoin`); a failed comparison degrades to no changes
      - 4 stat cards: Revenue (hero figure, + expected from pending), Occupancy (meter, booked/available nights, active properties, pending nights), Stays in period (confirmed/pending/cancelled split, new bookings made), Avg. revenue per booked night
      - changes shown as ▲/▼ + text + "vs August", colour only reinforcing, with better/worse in the screen-reader label
      - `property-breakdown.ts` table (booked nights, occupancy meter %, revenue, expected; Retired badge; tabular numbers; links to the property)
      - states: skeletons, empty-period hint, error with Try again
      - replaces the placeholder route
    - Built following the dataviz guidance: stat-tile contract, one hero figure, same-colour meter tracks, never colour-only changes, tabular digits only in columns.
    - **Tests:** 14 new Vitest tests (126 total), all passing; the production build is clean.
    - **Checked in Chrome** against the seeded data: This month and Last 12 months, the comparisons, and the breakdown.
    - **README:** new "Admin dashboard" section; admin routes table, layout, status and next steps updated.

- [x] **TICKET-024** — `AdminPropertyListComponent` + `PropertyFormComponent` (`/admin/properties`, `/admin/properties/:id/edit`)
  - Priority: P0
  - Depends on: TICKET-013, TICKET-022
  - CRUD table for properties — this is the real demo-facing admin UI, not Django Admin.
  - Decisions (agreed before building):
    - amenities as a **checklist + custom** field
    - photos as a **drag & drop** list (URLs; S3 uploads come in TICKET-036)
    - a small backend **`?search=`** over title or location
    - an **unsaved-changes warning**
  - Done:
    - **Backend:** `GET /api/properties/?search=` (case-insensitive, title OR location; blank ignored); 2 new tests; 96 backend tests pass on Postgres.
    - **`core/`:**
      - `AdminPropertiesService` (list all with status/search/sort/page, get, create, update, retire = soft DELETE, reactivate = PATCH `is_active`)
      - `unsaved-changes.guard.ts` (canDeactivate dialog)
      - `shared/confirm-dialog.ts` (generic, danger variant)
      - `KNOWN_AMENITIES` + `toAmenityKey()`
    - **`/admin/properties` table:**
      - `mat-table` with thumbnail, title → edit, location, €/night, sleeps, rating, Active/Retired chip (retired rows greyed)
      - ⋮ menu: View public page, Retire… (confirm dialog explaining the soft delete), Reactivate
      - snackbars + refresh; status toggle / debounced search / sort / page all in the URL
      - skeleton, empty and error states
    - **`/admin/properties/new` and `/:id/edit` form:**
      - details with validation and an Active switch
      - `amenities-picker` (CVA: icon checklist + custom keys as chips, stable order)
      - `images-editor` (CVA: add URL with validation and duplicate check, CDK drag & drop reorder, exactly one ★ cover, remove, broken-URL warning)
      - save = POST / PATCH (full image list → the backend replaces the set), spinner and double-submit block
      - server 400s mapped to fields, including nested image errors
      - snackbar + back to the list; canDeactivate "Discard unsaved changes?" + `beforeunload`
      - not-found and error states
    - **Tests:** 23 new Vitest tests (149 total), all passing; the production build is clean.
    - **Checked in Chrome** as the admin: table incl. the retired property, search, the edit form (amenities, 5 photos, cover), a drag reorder, and the discard dialog. Nothing was saved or retired without the user's OK.
    - **README:** new "Admin properties" section; the API filter table, admin routes, layout, status and next steps updated.

- [x] **TICKET-025** — `AdminBookingsComponent` (`/admin/bookings`)
  - Priority: P0
  - Depends on: TICKET-015, TICKET-022
  - Table of all bookings with status-change actions.
  - Requirements added after TICKET-021 (agreed):
    - Admins see **all guests' bookings** here, split like My Bookings: **Upcoming / Past / Cancelled** tabs (tab + page in the URL), so old bookings are separate from upcoming ones.
    - Columns: reference #, **guest email**, property, dates, nights, guests, total, status, created. Filter by property (`?property=`) and search by guest email.
    - Status actions per the backend's transition table (Confirm pending, Cancel pending/confirmed; cancelled is final), using the same confirmation-dialog pattern as My Bookings.
    - Uses the unfiltered `GET /api/bookings/` (no `mine=true`); **"My bookings" stays personal for everyone**, admins included.
    - Access control stays on the backend (already in place and tested since TICKET-014/015): guests only ever get their own bookings (list filtered server-side, others' ids → 404, `?property=`/`?mine=false` can't widen it); only `Profile.role == 'admin'` (checked in the DB per request) gets everyone's, with emails. The frontend AdminGuard (TICKET-022) is for navigation only, not security.
  - Decisions (agreed at the start of TICKET-025): a **Pending only** toggle (`?pending=1`) and a **pending-count badge** on "Bookings" in the admin side nav; search covers guest email **or** property title (one box).
  - Done: `AdminBookingsPage` with Upcoming / Past / Cancelled tabs, debounced search, property dropdown (retired ones marked), Pending only, paginator, all in the URL; table with #, guest, property (→ edit), stay + nights + "Staying now", guests, total, status chip, booked date; Confirm (pending) and Cancel (pending/confirmed) behind confirm dialogs, snackbars, server refusals shown and the list refreshed. `AdminBadgesService` feeds the side-nav badge and refreshes after every action. Backend: admin-only `?search=` on `GET /api/bookings/` (ignored for guests; 2 new tests, 98 total). The old admin placeholder page was removed. 159 frontend tests passing; production build clean; checked in Chrome as admin without changing any data. README: new "Admin bookings" section. **Epic 4 complete.**

---

## Epic 5 — Hosting & Deployment

- [x] **TICKET-026** — Deploy backend skeleton to Render
  - Priority: P0
  - Depends on: TICKET-004
  - Managed Postgres (free tier) + Web Service for the Django/DRF API, auto-deploy from GitHub. Do this early, not the night before.
  - Decisions (agreed): Render **Blueprint** (`render.yaml`) in Frankfurt; demo data **seeded once automatically** on the first deploy (`seed_demo_data --if-empty`, skipped once properties exist); the hosted admin keeps the **same demo password** as locally (the repo is public, so this was a deliberate choice for the demo).
  - **Live: https://booking-demo-api.onrender.com** (Blueprint `booking-demo-render`, deployed Sep 25; free Postgres expires ~Oct 25). Checked from Chrome: health `connected`, 13 active properties listed with `https://` pagination links, property detail with images/amenities, `401` without a token on /me, bookings, admin stats and creating a property, a wrong login gets `401`, 404s without debug pages, Django Admin login page styled (hashed static files, cached for a year). Done: gunicorn + WhiteNoise, `DATABASE_URL` support, `RENDER_EXTERNAL_HOSTNAME` → allowed hosts/CSRF origins, production hardening with `DEBUG=False` (proxy HTTPS header, secure cookies, HSTS, errors logged to stdout, refuses the dev secret key), `build.sh` (install, collectstatic, migrate, first-deploy seed), health check hides DB details in production, `.python-version` 3.12. Verified locally in production mode against a fresh database (build twice, gunicorn, static files, admin login, stats, 400 for foreign hosts). 103 backend tests passing. README: "Deploying to Render".

- [x] **TICKET-027** — Deploy Angular build to Render Static Site
  - Priority: P0
  - Depends on: TICKET-026, TICKET-018
  - Confirm the hosted frontend can reach the hosted API (CORS/env config for the production API URL).
  - Decisions (agreed): site name **`booking-demo`** → https://booking-demo-g4aw.onrender.com (the plain name was taken by another Render user, so Render added `-g4aw`; CORS updated to match); add a **"Waking up the demo server"** notice for the free API's cold start.
  - **Live: https://booking-demo-g4aw.onrender.com.** Checked in Chrome: before the CORS fix the site showed "Can't reach the server"; after it, 13 stays load from the live API with photos, the footer reads "API & database connected", `/listings/14` opens directly (SPA rewrite), `/admin/bookings` logged out redirects to login, and the X-Frame-Options/nosniff/Referrer-Policy headers are served. The waking-up banner can only be seen once the API has been idle for 15 minutes (TICKET-028). Done: `environment.production.ts` (Render API URL) via `fileReplacements`; `render.yaml` static site (`npm ci && npx ng build`, `dist/frontend/browser`, Node 22, `/*` → `/index.html` rewrite, X-Frame-Options/nosniff/Referrer-Policy headers); `CORS_ALLOWED_ORIGINS` on the API; committed `frontend/package-lock.json`; `ServerWakeService` + interceptor + banner (4 s); `AuthService.init()` waits at most 3 s for `/me/` so a sleeping API can't blank the page. 167 frontend tests passing; production bundle checked (Render URL, no localhost). README: "Frontend on Render".

- [ ] **TICKET-028** — Pre-demo hosted-URL check
  - Priority: P0
  - Depends on: TICKET-027
  - Free services spin down after ~15 min idle (30–60s cold start). Ping the hosted URL a few minutes before demoing; plan to run **locally** as the primary during the pitch and hand out the hosted URL as a leave-behind link.
  - Decisions (agreed): a **manual "Run workflow" button only**, with no scheduled keep-alive; plus a **QR code** of the site link.
  - Done: `scripts/hosted-check.sh` wakes the API (retries for ~3 min while it cold-starts), then checks: health `connected`, properties listed, the site serving the Angular app on `/`, `/listings/1` and `/admin/bookings`, CORS allowing the site, and `X-Frame-Options`. It writes a ✅/❌ list to the GitHub run summary and fails with a clear reason. `.github/workflows/hosted-check.yml` runs it via `workflow_dispatch` (also from the GitHub mobile app). Tested offline against a local copy of the production setup: passes, and fails on CORS with a wrong site origin. `docs/booking-demo-qr.png` (verified to decode to https://booking-demo-g4aw.onrender.com). README "Demo day": checklist, warm-up, dates (DB expires ~Oct 25).

---

## Epic 6 — Attempt-next (build if the schedule allows)

- [ ] **TICKET-029** — Stripe test-mode checkout on booking confirm
  - Priority: P1 · Depends on: TICKET-020
  - Payment-safety requirements (delegated from TICKET-008 — avoids double charges):
    - Use a Stripe idempotency key per checkout attempt, derived from the booking id, so a double-click or a network retry never creates two PaymentIntents/charges for the same booking.
    - Only start payment after the booking row has been committed (i.e. it already survived TICKET-015's exclusion-constraint check) — never take payment for a booking that lost the race and was rejected.
    - Drive `Booking.status -> confirmed` from a Stripe webhook confirming payment actually succeeded, not optimistically the moment the client calls confirm — a booking should never read as confirmed before money has actually moved.
    - Refunds for cancelled bookings are a separate follow-up: see TICKET-040.

- [ ] **TICKET-040** — Refunds on cancellation
  - Priority: P1 · Depends on: TICKET-029 (payments must exist first), TICKET-015 (cancellation rules)
  - Raised during TICKET-015: cancelling a paid booking must return the guest's money according to a policy, not ad hoc.
  - Policy to confirm before building (suggested starting point):
    - guest cancels **before** the cancellation deadline (`Booking.cancel_deadline()`, 48h before 15:00 check-in): full refund
    - after the deadline guests can't cancel online at all (TICKET-015); if an **admin** cancels a booking (e.g. the property becomes unavailable): always a full refund
    - cancelling an unpaid `pending` booking: nothing to refund
    - decide whether partial refunds or a fee are wanted later
  - Implementation requirements:
    - Use the Stripe Refund API against the booking's PaymentIntent, with an **idempotency key derived from the booking id**, so a retried or double-clicked cancel can never refund twice.
    - Record refund state on the booking (e.g. `refund_status`: `none` / `pending` / `refunded` / `failed`, plus amount and Stripe refund id) via a migration.
    - Mark it refunded from the Stripe **webhook** (`charge.refunded` / `refund.updated`), not optimistically when the request is sent, the same principle as TICKET-029's confirmation.
    - The cancel `PATCH` stays the trigger: after the status change commits, start the refund. Never block or roll back the cancellation because Stripe is slow; retry failed refunds instead.
    - Show refund status in the guest's My Bookings and the admin bookings table.

- [ ] **TICKET-030** — Booking-confirmation email (Brevo or Resend free tier)
  - Priority: P1 · Depends on: TICKET-020

- [ ] **TICKET-031** — Responsive layout + PWA manifest
  - Priority: P1 · Depends on: Epic 3 complete
  - Covers the "mobile app" goal without a separate codebase.

---

## Epic 7 — Nice-to-have

- [ ] **TICKET-032** — Reviews/ratings UI
  - Priority: P2 · Depends on: TICKET-009, TICKET-019

- [ ] **TICKET-033** — Favorites
  - Priority: P2 · Depends on: TICKET-017, TICKET-018

- [ ] **TICKET-034** — Map view for listings
  - Priority: P2 · Depends on: TICKET-018

- [ ] **TICKET-035** — Revenue chart over time (admin dashboard)
  - Priority: P2 · Depends on: TICKET-023

- [ ] **TICKET-036** — Real photo uploads
  - Priority: P2 · Depends on: TICKET-006
  - Replaces the fallback of fixed stock photo URLs. ( i want to add my S3 aws bucket)

---

## Epic 8 — Final polish (last day before the meetup)

- [ ] **TICKET-037** — UI polish pass + refresh seed data
  - Priority: P0 · Depends on: Epic 3 & 4 complete

- [ ] **TICKET-041** — Simple demo logins in the seeder (admin + guests)
  - Priority: P0 · Depends on: TICKET-026 · Do before TICKET-038 (requested after TICKET-026)
  - Goal: logins that are easy to type at the meetup table, for both roles, e.g. `admin@demo.com` / `admin123` and `guest1@demo.com` … `guest10@demo.com` / `guest123` (exact values to agree when the ticket starts).
  - Seeder (`seed_demo_data`): fixed, numbered guest emails instead of Faker usernames (Faker still provides the first/last names); one shared guest password; simple admin email/password. Keep them as constants in one place so the README and the login page hint can't drift.
  - Simple passwords are fine here: the seeder uses `set_password()`, which skips Django's password validators. Registration still enforces them for real sign-ups.
  - `--clear` must also remove the old-style `guest_*@example.com` / `admin_demo` accounts, so re-seeding doesn't leave both sets behind.
  - **Hosted copy (Render):** `--if-empty` won't re-seed a database that already has data, so plan a one-off re-seed there. There's no shell on the free plan, so e.g. a temporary env var (`SEED_DEMO_DATA=reset`) that makes `build.sh` run `seed_demo_data --clear` once, removed right after that deploy.
  - Optional: a small "Demo logins" hint on the login page (or the README only), so visitors know which accounts exist.
  - Update the README (Seeding demo data, Deploying to Render → logins) and the tests for `--clear` / `--if-empty`.

- [ ] **TICKET-038** — Final redeploy + smoke test (local + hosted)
  - Priority: P0 · Depends on: TICKET-026, TICKET-027

- [ ] **TICKET-039** — Record a backup demo video
  - Priority: P0
  - In case live wifi/hosting fails at the meetup table.

---

## Explicitly cut unless way ahead of schedule

Not tickets to plan around — only pick these up if everything above is done
with time to spare:

- Multi-language (Greek/English) — if attempted at all, two JSON label
  dictionaries, not full Angular i18n tooling.
- A true native mobile app — the responsive/PWA work in TICKET-031 already
  covers this need.

## If a day slips

Trim from the bottom up: Epic 7 first, then Epic 6, then reduce Epic 8 to
just TICKET-039. Do not cut anything in Epic 0–5 — the core booking flow,
admin visibility, and a stable public URL are what make the demo credible.
