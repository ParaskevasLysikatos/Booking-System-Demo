# Booking System Demo — Tickets

Derived from `Booking System Demo — Build Plan.md` (Sep 24, 2026). Each
ticket is meant to be picked up on its own — hand them out one at a time.

**Priority key:** P0 = must-have (protect no matter what) · P1 = attempt
next if schedule allows · P2 = nice-to-have / first to cut if behind.

**Status key:** `[x]` done · `[ ]` not started.

**Working order (agreed after TICKET-029):** one ticket at a time, in the
order they appear in this file - TICKET-040 → 030 → 031 → 032 → 033 → 034 →
035 → 036 → 037 → 041 → 038 (two languages) → 039 (final redeploy + smoke
test, always last).

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

- [x] **TICKET-028** — Pre-demo hosted-URL check
  - Priority: P0
  - Depends on: TICKET-027
  - Free services spin down after ~15 min idle (30–60s cold start). Ping the hosted URL a few minutes before demoing; plan to run **locally** as the primary during the pitch and hand out the hosted URL as a leave-behind link.
  - Decisions (agreed): a **manual "Run workflow" button only**, with no scheduled keep-alive; plus a **QR code** of the site link.
  - Done: `scripts/hosted-check.sh` wakes the API (retries for ~3 min while it cold-starts), then checks: health `connected`, properties listed, the site serving the Angular app on `/`, `/listings/1` and `/admin/bookings`, CORS allowing the site, and `X-Frame-Options`. It writes a ✅/❌ list to the GitHub run summary and fails with a clear reason. `.github/workflows/hosted-check.yml` runs it via `workflow_dispatch` (also from the GitHub mobile app). Tested offline against a local copy of the production setup: passes, and fails on CORS with a wrong site origin. `docs/booking-demo-qr.png` (verified to decode to https://booking-demo-g4aw.onrender.com). **First real run on GitHub (Sep 25) passed**: all five checks green against the live site (13 properties). Pushing the workflow needed the token's *Workflows* permission (added).
  - Follow-up (requested): **"Keep demo awake"** workflow, started by hand on Oct 1 (~17:30). It runs the hosted check, then `scripts/keep-awake.sh` pings `/api/health/` every 10 minutes for **3 hours** (a 1-5 h choice). It fails after 3 missed pings in a row, starting it again replaces the running one, and it can be cancelled to stop early. Tested locally (short window OK, API down → fails after 3 misses). README "Demo day": checklist, warm-up, dates (DB expires ~Oct 25).

---

## Epic 6 — Attempt-next (build if the schedule allows)

- [x] **TICKET-029** — Stripe test-mode checkout on booking confirm
  - Priority: P1 · Depends on: TICKET-020
  - Payment-safety requirements (delegated from TICKET-008 — avoids double charges):
    - Use a Stripe idempotency key per checkout attempt, derived from the booking id, so a double-click or a network retry never creates two PaymentIntents/charges for the same booking.
    - Only start payment after the booking row has been committed (i.e. it already survived TICKET-015's exclusion-constraint check) — never take payment for a booking that lost the race and was rejected.
    - Drive `Booking.status -> confirmed` from a Stripe webhook confirming payment actually succeeded, not optimistically the moment the client calls confirm — a booking should never read as confirmed before money has actually moved.
    - Refunds for cancelled bookings are a separate follow-up: see TICKET-040.
  - Decisions (agreed before building):
    - **Stripe-hosted Checkout** (redirect to Stripe's page, then back); Checkout Sessions API, not raw PaymentIntents, per Stripe's best-practice guidance. Payments only - Invoicing and Identity were suggested by Stripe's onboarding but are out of scope.
    - **Auto-confirm:** the webhook moves `pending → confirmed` once the money has actually arrived. Bookings without a payment (seeded ones, or payments switched off) keep the admin's manual Confirm.
    - **Unpaid bookings hold their dates for 30 minutes** (the Checkout Session's lifetime, Stripe's minimum). The guest can **Pay now** from My Bookings in that window; on expiry the webhook cancels the booking and frees the dates. A lazy check (asking Stripe, so a paid booking with a late webhook is never cancelled) covers missed expiry webhooks.
    - **Local + Render:** a `stripe-cli` Docker service forwards webhooks locally (sharing its signing secret with the backend through a volume, so nothing to copy); Render gets a Stripe webhook endpoint and its own minimal restricted key.
    - Keys: a **restricted key** (`rk_test_`) as `STRIPE_SECRET_KEY`; the full `sk_test_` key only as `STRIPE_CLI_API_KEY` for the local forwarder. Live keys are refused at startup.
  - Build steps: 1) model + settings, 2) checkout endpoint, 3) webhook, 4) hold cleanup + cancel handling, 5) frontend, 6) Docker + Render, 7) end-to-end test with card 4242, 8) docs + push.
  - Progress:
    - **Step 1 done:** new `payments` app. `Payment` (one per booking: Checkout Session id + URL, amount snapshot in `Decimal` with exact `amount_cents`, status `open/processing/paid/expired/failed`, `expires_at`, PaymentIntent id for TICKET-040, DB check `amount > 0`) and `StripeEvent` (webhook event ids, for at-least-once de-dup in the same transaction as the update), migration `payments/0001_initial.py`, read-only admin. Settings: `STRIPE_SECRET_KEY` (empty = payments off), `STRIPE_API_VERSION=2026-08-26.dahlia`, `STRIPE_WEBHOOK_SECRET` / `_FILE`, `STRIPE_CHECKOUT_HOLD_MINUTES=30`, `FRONTEND_URL`, `STRIPE_ALLOW_LIVE_KEYS`; `stripe>=15.6,<16` in requirements. `payments/checks.py` system checks (publishable/live/unknown keys and out-of-range hold = errors; full `sk_` key and missing webhook secret = warnings). 16 new tests; all 119 backend tests pass on Postgres; `makemigrations --check` clean. README: new "Payments (Stripe)" section, env vars, layout, admin table.
    - To apply locally: `docker compose up -d --build backend` (new package + migration).
    - **Step 2 done:** the payment hold + `POST /api/bookings/{id}/checkout/`.
      - Refinement agreed in the step: the `open` Payment is created **in the same transaction as the booking** (`start_hold`), so the 30-minute hold runs from booking time and a booking that loses the race never gets one; the Stripe session is created later at checkout. Migration `payments/0002` (session id/URL optional until then, `checkout_attempt`).
      - `start_checkout` in three phases: lock + decide the exact request (params + key `booking-<id>-checkout-<attempt>`, built only from stored values) → call Stripe with no DB lock held → lock + record. Any repeat sends Stripe the identical request, so it returns the same session. 2 minutes of slack on the hold keep an identical retry valid (Stripe needs `expires_at` ≥ 30 min after creation); a later retry of an attempt that never produced a session bumps the attempt. Pay now reuses the stored page.
      - Session: one line item in integer cents (exact from `Decimal`), `eur`, `booking_id` metadata (session, PaymentIntent, `client_reference_id`), guest email, success/cancel URLs to `FRONTEND_URL/bookings/{id}/payment`, `integration_identifier`, no `payment_method_types`.
      - Errors: 409 `payment_not_required` / `already_confirmed` / `booking_cancelled` / `already_paid` / `payment_window_closed` / `checkout_in_progress`, 502 `payment_provider_error`, 503 `payments_disabled`; a booking cancelled mid-call gets its new session expired immediately. Only the booking's own guest (others and admins 404).
      - Every booking response has a `payment` block (`status`, `amount`, `currency`, `expires_at`, `paid_at`, `can_pay`), LEFT JOINed - still 3 queries per page.
      - 16 new tests (32 in `payments`); all 135 backend tests pass on Postgres. README: hold, endpoint, idempotency design, error table, curl.
    - **Step 3 done:** the webhook, `POST /api/payments/stripe/webhook/` (`payments/views.py` + `payments/webhooks.py`).
      - Plain Django view (raw body): `stripe.Webhook.construct_event` verifies the signature first → 400 on a bad/missing/old signature or tampered body; no login/CSRF. Secret from `STRIPE_WEBHOOK_SECRET` or the stripe-cli file (read per request); none → 503.
      - De-dup: `StripeEvent` insert in the same transaction as the changes → repeat = skipped, simultaneous repeat waits then skipped, failure rolls everything back (500) so Stripe's retry is clean.
      - Events: completed+paid / async_payment_succeeded → payment `paid`, booking `confirmed`; completed+unpaid → `processing`; async_payment_failed / expired → `failed` / `expired`, booking `cancelled` (dates freed). Matched by stored session id only (one sandbox serves local + Render). Admin-confirmed bookings stay confirmed on expiry; paid-after-cancelled stays cancelled + refund warning (TICKET-040); amount/currency mismatch never confirms.
      - 19 new tests with real HMAC signatures, incl. two simultaneous deliveries of one event → handler runs exactly once (6/6 runs). All 154 backend tests pass on Postgres. README: event table, safety design, tests.
    - **Step 4 done:**
      - Decision (agreed): **Adaptive Pricing off** per session (`adaptive_pricing.enabled=false`) - always EUR, so the webhook's amount/currency check can't trip on a foreign card. (Confirmed a guest can't change the amount: server-side price, server-created session, no quantity/custom amount/promo/tax/shipping enabled.)
      - Stale holds (`sync_stale_hold`): open hold past `expires_at` with no webhook → no session: released directly; with a session: Stripe is asked first (expire, or retrieve if finished) and the real state applied like the webhook (paid → confirmed, keeps the dates); Stripe unreachable → untouched. Runs before the overlap check on `POST /api/bookings/`, on checkout (Pay now tells the truth), and via `manage.py release_stale_holds`.
      - Status changes (`PATCH`): unlocked transition pre-check → close the open page at Stripe → locked re-check, payment `cancelled` (new status, migration `payments/0003`), booking changed. Paid a moment ago → 409 `payment_completed` (recorded as confirmed right away); processing → 409 `payment_processing` (+ `can_cancel: false`); Stripe down → 502, not cancelled; page opened mid-cancel → 409 `checkout_just_opened`; paid-then-cancelled keeps the payment `paid` (refund = TICKET-040).
      - 18 new tests (69 in `payments`); all 172 backend tests pass on Postgres. README: stale holds, status changes table, the "different amount?" answer.
      - Follow-up (docs, requested): README "Bookings API → Status changes" now states admins have **no deadline** (cancel pending/confirmed any time, even after check-in; confirm pending any time; only `cancelled` is final) and has an **"Every case at a glance"** guest-vs-admin table. Admins are held back only by the temporary payment-safety cases (`payment_completed`, `payment_processing`, `payment_provider_error`, `checkout_just_opened`), same as guests.
    - **Step 5 done (frontend):**
      - Decisions (agreed): paid bookings cancelled before the 48h deadline get a **full refund** (manual from the Stripe Dashboard until TICKET-040; UI says "processed by the host", admin sees "Refund due"); a **live countdown** for the 30-minute hold; admins **can confirm an unpaid booking with a warning** (payment waived); after paying the guest lands on an **in-app confirmation page**.
      - Backend: public `GET /api/payments/config/` (`enabled`, `hold_minutes`, `currency`) for wording before a booking exists; 2 tests.
      - `core/payments/` (models, `PaymentService` with cached config, countdown clock, labels + `refundDue`, `BrowserRedirect`); `shared/booking-summary.ts` shared by both confirmation screens.
      - Booking form: step 2 payment/refund wording and **Confirm and pay** → create booking → checkout → Stripe; if the page can't open, "dates held" + Try again that **reuses the same booking**.
      - New `/bookings/:id/payment` return page: confirming (polls every 2 s, 15×) → confirmed / processing / waiting for confirmation; backed out → countdown + Pay now + Cancel → time ran out + Book again; failed / expired / cancelled / refund texts; no payment → My bookings; unknown → not found.
      - My Bookings: payment line per card (countdown + Pay now, processing, paid, refund, expired, failed, waived) and money-aware cancel dialog. Admin bookings: Payment column with chips incl. **Refund due**, confirm "waived" warning, cancel refund reminder.
      - 33 new frontend tests (200 total) + production build clean; 174 backend tests pass on Postgres. Checked in Chrome as the demo admin without booking anything: config endpoint live, step 2 wording + Confirm and pay, My bookings (no-payment booking unchanged), admin Payment column ("—" for seeded).
      - README: "Payments in the frontend" + a new **"Payments: business rules & test cases"** section - every rule numbered (CFG, HOLD, CHK, WH, STALE, CAN, UI) with how to test, expected result, the automated test that covers it, and which ones to run by hand in step 7 (plus Stripe test cards).
    - **Step 6 done (Docker + Render):**
      - `docker-compose.yml`: new `stripe-cli` service (`stripe/stripe-cli`, logs in with `STRIPE_CLI_API_KEY`; idles with a clear message if unset). On start it writes its signing secret to a shared volume `stripe_cli` (read-only in the backend at `/stripe`, `STRIPE_WEBHOOK_SECRET_FILE=/stripe/webhook_secret`) - nothing to copy into `.env` - then forwards only the 4 handled `checkout.session.*` events to `http://backend:8000/api/payments/stripe/webhook/`. Verify with `stripe trigger checkout.session.completed` → `<-- [200]`.
      - `render.yaml`: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` as `sync: false` (dashboard-only secrets), `FRONTEND_URL` = the Render site. Payments stay off on Render until both are set, so deploying first is safe.
      - `scripts/hosted-check.sh`: new informational line "Payments are ON/OFF" from `/api/payments/config/`.
      - README: "Local webhook forwarding" (how it works, switch on, check the chain, expire a session on purpose for the time-ran-out cases), "Payments on Render" (restricted key, webhook endpoint + events, env vars, check), env tables, troubleshooting ("Waiting for confirmation" locally), quick start services. `.env.example` note.
      - To apply locally: `docker compose up -d` (pulls the CLI image, recreates the backend with the volume).
    - Found at the start of step 7: the Stripe sandbox has **Managed Payments** (Stripe as merchant of record; digital products only, +3.5%, adds tax) **on by default**, which broke `stripe trigger` and would make paid totals differ from booking prices. Decision (agreed): **off in code** (`managed_payments.enabled=false` on every session, test assertion, README rule CFG-05) **and** off in the dashboard.
    - **Step 7 (local) done - all passed.** 10 rounds in Chrome with Stripe test cards (4242, declined 9995, 3-D Secure 3155) + `stripe-cli` commands: pay → confirmed, blocked dates, back out + Pay now (same session), cancel with open page (Stripe page closed), admin confirm → Waived, cancel paid → Refund due, CLI expire → released, event resend → no change, forwarder down → "Waiting for confirmation" → resend → confirmed, and an unplanned real missed-webhook case (computer asleep) settled by `release_stale_holds`. Found + fixed: the policy line on cancelled bookings (hidden now, new `booking-summary.spec.ts`, 203 frontend tests) and "held for about 30 minutes". Results table in README "End-to-end results - local". Next: push, Render setup, same run on Render.
    - Agreed for the end of this ticket: **end-to-end tests** (step 7), locally and on Render, with real Stripe test payments (card 4242), covering pay → confirmed, abandon → expired/released, and Pay now.
    - **Step 7 (Render) done - all passed.** Pushed (payments off until secrets set), then Render got its own restricted key, a Stripe webhook endpoint (4 `checkout.session.*` events) and `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`; `/api/payments/config/` → enabled. Runs on the hosted site (guest typed logins + cards, the rest driven in Chrome): 4242 ×2 → confirmed/Paid, back out + Pay now (same session) + cancel (Stripe page closed), 3-D Secure → confirmed, cancel paid → Refund due, admin confirm unpaid → Waived, the local forwarder received Render's events and ignored them (WH-10), Hosted demo check green. Dashboard: Managed Payments inactive/off by default. Results in README "End-to-end results - Render".
  - **Done.** Stripe test-mode Checkout with a 30-minute hold, idempotent sessions, signed + de-duplicated webhook as the only thing that confirms bookings, stale-hold settlement, safe cancel/confirm with an open page, full frontend (Confirm and pay, return page, Pay now countdown, admin Payment column), Docker `stripe-cli` forwarder, Render setup; 58 numbered business rules in the README with automated + manual (local and Render) coverage. Backend 174 tests, frontend 203 tests. Follow-ups: **TICKET-040** (automate the refunds now flagged "Refund due"; policy agreed: full refund before the 48h deadline, none after since guests can't cancel then), TICKET-030 (confirmation email).

- [x] **TICKET-040** — Refunds on cancellation
  - Priority: P1 · Depends on: TICKET-029 (payments must exist first), TICKET-015 (cancellation rules)
  - Raised during TICKET-015: cancelling a paid booking must return the guest's money according to a policy, not ad hoc.
  - Decisions (agreed before building):
    - **Policy:** cancelling a paid booking always refunds the **full amount**. Guests can only cancel before the 48h deadline; an **admin** cancel (any time) is always a full refund. No partial refunds or fees.
    - Money that arrives **after** a cancellation is refunded automatically.
    - Stripe Refund API against the booking's PaymentIntent, idempotency key `booking-<id>-refund-<n>` (`n` only goes up when Stripe created a refund that then failed).
    - Refund state beside the payment (`refund_status` none / pending / refunded / failed, amount, Stripe refund id, timestamps, reason).
    - The **webhook** confirms refunds (`refund.updated`, `refund.failed`, `charge.refunded` - the last also catches refunds made by hand in the Stripe Dashboard); never marked refunded when the request is sent.
    - The cancel is **never blocked or rolled back** because of Stripe; a failed refund is shown as such.
    - Failed refunds: an admin **Refund now** button, plus `manage.py sync_refunds` to retry failed ones and sync pending ones whose webhook was missed.
    - Guest wording: "full refund of €X, back to your card within 5–10 business days"; "Refund of €X on its way" / "Refunded €X on …"; failed → "the host is arranging your refund". Admin chips: Refund pending / Refunded / Refund failed + Refund now.
    - Configuration: the Render key needs **Charges and Refunds: Write**; the Render webhook endpoint and the local `stripe-cli --events` list get the three refund events.
  - Steps: 1) model + refund logic + cancel hook-up; 2) webhook refund events + admin endpoint + command; 3) frontend; 4) Docker/Render config + docs; 5) local E2E → push → Render E2E → done.
  - Progress:
    - **Step 1 done.** `Payment` gets `refund_status`, `refund_amount`, `stripe_refund_id`, `refund_attempt`, `refund_requested_at`, `refunded_at`, `refund_failure_reason` (migration `payments/0004_refunds.py`). New `payments/refunds.py`: `request_refund` (inside the locked cancel transaction; returns whether a refund must be sent, so never twice) and `send_refund` (after commit, no lock held, never raises; failures recorded as `failed` with an admin-only reason, attempt +1 only when Stripe itself reports the refund failed). Hooked into the cancel `PATCH` (guest and admin) and the webhook's paid-after-cancelled case (`on_commit`). Every booking's `payment` block has `refund` (null when none; `failure_reason` for admins only). 12 new tests + 2 updated (REF-01…REF-12 in the README); **185 backend tests pass on Postgres**. README: new "Refunds (TICKET-040)" and "Refunds: business rules & test cases" sections.
    - **Step 2 done.** Webhook handles `refund.updated` / `refund.failed` / `charge.refunded` (matched by PaymentIntent; ours = stored refund id, or metadata payment id + current attempt; succeeded → refunded, failed/canceled → failed with attempt +1, even after succeeding; a late `charge.refunded` never undoes a failure; Dashboard refunds recorded with a warning; partial refunds logged only; unknown PaymentIntents ignored). Admin **Refund now** `POST /api/bookings/{id}/refund/` (403 for guests; 409 `not_paid` / `not_cancelled` / `refund_in_progress` / `already_refunded`; also covers old "Refund due" bookings and pending refunds that were never sent) + `can_refund` in the admin payment block. `manage.py sync_refunds` (send unsent, sync unconfirmed from Stripe, retry failed unless `--no-retry`, `--backlog` for old cancelled+paid bookings). An unexpected error while sending never turns the cancel into a 500. Django Admin shows/filters refund status (read-only). 27 new tests (REF-13…REF-30), **212 backend tests pass on Postgres**.
    - **Step 3 done.** One helper, `refundView()` (`core/payments/payment-labels.ts`), drives every screen. Guest (My Bookings Cancelled tab + payment return page): "Refund of €X on its way - back to your card within 5–10 business days" / "Refunded €X on …" / failed or never started → "Full refund of €X - the host is arranging your refund" (never the reason). Guest cancel dialog: "full refund of €X, back to your card within 5–10 business days"; snackbar "Refund of €X on its way". Admin: chips Refund pending / Refunded (+date) / Refund failed (+reason) / Refund due; **Refund now** button where `can_refund` (confirm dialog with the last failure → `POST …/refund/` → snackbar; 409 reasons shown); admin cancel dialog/snackbar report the automatic refund or its failure. `PaymentSummary` gets optional `refund` / `can_refund`; `BookingService.refund()`. 10 new frontend tests (REF-31…REF-37), **213 frontend tests pass**, production build OK.
    - **Step 4 done.** `docker-compose.yml`: the `stripe-cli` forwarder also forwards `refund.updated`, `refund.failed`, `charge.refunded` (run `docker compose up -d` to recreate it). Key permission "Charges and Refunds: Write" documented in `.env.example`, `render.yaml`, `settings.py`, the `payments.W001` startup-check hint and the README env tables. README "Payments on Render" gets the two Render changes (key permission, three webhook events) and notes that without a shell on Render's free plan, Refund now replaces `sync_refunds`; "Local webhook forwarding" gets a `stripe trigger charge.refunded` chain check.
    - **Step 5 - local end-to-end run passed** (27 Sep, 11 rounds in Chrome: guest/admin cancels, Refund now, the refund-fails-later test card, a refund made outside the app, a missed webhook caught by `sync_refunds`, stale holds). It found one real bug, fixed: after Stripe *refused* a refund (4xx - e.g. the backend was using an **agent** key, so Stripe answered `403 approval_required`), the retry reused the idempotency key and Stripe replayed the refusal; now a refusal moves to the next attempt, an unknown outcome (network/5xx/409/429) keeps the key. Clear agent-key reason, no double full stop, no traceback for refusals. The local backend now uses a normal restricted key. 3 new backend tests (REF-38, REF-39): **214 backend + 213 frontend tests pass**. Next: push → Render settings (key permission + 3 webhook events) → Render end-to-end run.
    - **Step 5 - Render end-to-end run passed** (27 Sep, after the push `a3828b5` and the two Stripe changes: Render key + Charges and Refunds: Write, Render webhook endpoint + the 3 refund events): admin Refund now on old "Refund due" #38, guest cancel of paid #40, admin cancel of paid #41 → all **Refunded** within ~2 s; the Cancelled tab shows "Refunded €424 on 27 Sep 2026"; Hosted demo check green.
  - **Done.** Full refund on every paid cancellation (guest before 48h, admin any time; late payments too), sent after the cancel commits and never blocking it; Stripe's refund events confirm it; admin Refund now + `sync_refunds` for failures and missed webhooks; idempotency keys that can never refund twice (a refusal moves to a new key, an unknown outcome keeps it); guest and admin screens for every refund state. 39 numbered rules (REF-01…REF-39) in the README; tested end to end locally (11 rounds) and on Render (6 rounds). Backend 214 tests, frontend 213 tests.
  - Coverage, honestly: all 39 rules have automated tests; 24 were also checked by hand with real Stripe test payments. The rest are "auto only" in the README's E2E column - mostly failures and races that can't be caused on demand (Stripe unreachable, events out of order, a crash mid-send, partial refunds), plus the short-lived "Refund of €X on its way" guest text (the webhook confirms within 1–2 s), `sync_refunds --backlog`, and an admin cancel inside the 48 h.

- [x] **TICKET-030** — Booking-confirmation email (Brevo or Resend free tier)
  - Priority: P1 · Depends on: TICKET-020
  - Decisions (agreed before building):
    - **Brevo, HTTP API** (free: 300 emails/day; one verified sender address, no domain needed). Not SMTP: Render's free web services block outbound SMTP ports. A small custom Django email backend using the standard library, so no new package.
    - **Four emails:** `booking_received` (guest, on booking, with Pay now + the 30-minute hold), `booking_confirmed` (guest, on pending → confirmed by webhook, stale-hold settle or admin Confirm), `booking_cancelled` (guest, on any cancel incl. an expired hold, with the refund amount when paid), `admin_new_booking` (admin alert on confirmation). "Received" and "confirmed" are sent separately, even when the guest pays straight away.
    - **Outbox:** one `BookingEmail` row per (booking, kind), created in the same transaction as the status change and sent after commit → never sent twice (a repeated webhook is safe), never blocks or rolls back a booking; failures recorded and retried (`manage.py send_pending_emails` + a Django Admin action, since Render's free plan has no shell).
    - **Local:** a **Mailpit** Docker service catches every email (UI at `localhost:8025`). Tests use Django's in-memory backend.
    - **Sender:** the owner's Gmail (verified in Brevo). **Admin alert recipients:** a fixed list in `.env` (`BOOKING_ALERT_EMAILS`), for now the same Gmail. Both are set in `.env` / the Render dashboard only, never committed (the repo is public).
  - Steps: 1) outbox model + settings + Brevo backend + Mailpit; 2) templates + hooks at every status change; 3) retry command + Django Admin; 4) docs/config; 5) local E2E in Mailpit → push → Brevo on Render → Render E2E.
  - Progress:
    - **Step 1 done.** New `notifications` app: `BookingEmail` outbox (one row per booking + kind, DB constraint `one_email_per_booking_kind`; status pending / sending / sent / failed / skipped; attempts, last error, Brevo messageId). `outbox.py`: `enqueue()` inside the booking's transaction (savepoint, duplicates dropped), `send_email()` after commit - claims the row under a short lock, renders + sends with no lock held, records the result, never raises; out-of-date emails are `skipped`, a send stuck for 10 minutes may be retried. `BrevoEmailBackend` (stdlib `urllib`, `api-key` header, text + HTML, tags, `Idempotency-Key` header; 4xx = refused, network/5xx/429 = unknown outcome; the key never appears in errors). Settings `EMAIL_PROVIDER` (console / smtp / brevo - brevo without a key falls back to console), `BREVO_API_KEY`, `DEFAULT_FROM_EMAIL`, `BOOKING_ALERT_EMAILS`, `EMAIL_TIMEOUT`; startup **warnings only** (`notifications.W001`-`W004`), so emails can never block a deploy. `mailpit` service in `docker-compose.yml` (UI :8025), backend defaults to `smtp` → `mailpit:1025`. 18 tests; 232 backend tests pass on Postgres. Pushed as `3b57bb0` (from the local folder - the cloud workspace can't push to this repo).
    - **Step 2 done.** The four emails, rendered from Django templates (`notifications/templates/notifications/emails/`: HTML with inline styles + plain text) with the app's money/date formatting, and recorded at every status change: booking create → received (Pay now + hold end time when payments are on); admin Confirm and the payment webhook (incl. a stale hold that turns out paid) → confirmed + admin alert; cancel via `PATCH` (reason `guest` / `host`), the expired / failed webhook and a released stale hold (`payment_expired` / `payment_failed`) → cancelled, with the refund wording from TICKET-040. The cancel reason is stored on the row (migration `notifications/0002_cancel_reason.py`). Seeded / Django Admin bookings send nothing. 16 new tests through the real API and signed webhooks (incl. Stripe repeating an event → still one email); **248 backend tests pass** on Postgres. Checked the HTML in a headless browser.
    - **Step 3 done.** `manage.py send_pending_emails` (pending, failed and stuck-`sending` emails, oldest first; `--max-attempts` default 5, `--dry-run`; failures listed with the reason) and Django Admin: a read-only outbox list (filters status / kind / reason, search by booking id / address, error text) with a **"Retry sending the selected emails"** action - the way to resend on Render, which has no shell - plus the emails inline on each Booking page. Both use `send_email()`, so a sent email is never re-sent and an out-of-date one is skipped. 5 new tests (39 in `notifications`); **253 backend tests pass** on Postgres.
    - **Step 4 done.** `render.yaml`: `EMAIL_PROVIDER=brevo` plus `BREVO_API_KEY`, `DEFAULT_FROM_EMAIL`, `BOOKING_ALERT_EMAILS` as dashboard-only secrets (`sync: false`; until the key is set Render only logs the emails, so deploying first is safe). Found while writing the setup guide: Brevo **replaces a free-mail sender** (e.g. @gmail.com) with its own address for DMARC reasons → every email now sets **Reply-To** = `DEFAULT_FROM_EMAIL`, so guests' replies still reach the owner. README: "Emails on Render (Brevo)" (account, sender, API key, Render variables, check, Gmail/spam note), Render env table, a "No email arrived" troubleshooting entry, and **"Emails: business rules & test cases"** (EM-01…EM-20, each with the manual check and its automated test). Local `.env`: sender + alert list set to the owner's Gmail.
    - **Step 5 - Render end-to-end run passed** (28 Sep; Brevo API key + the three Render variables added by the owner, redeployed `dbe7e77`). In Chrome as `admin_demo`: booking #44 → "Complete your payment" sent (Brevo log, tag `booking_received`); admin Confirm → "confirmed" + the owner alert **delivered to the Gmail inbox** (not spam) with the right content; admin Cancel → "cancelled" sent. Brevo replaced the Gmail sender with its `brevosend.com` address as documented; the guest emails to `admin_demo@example.com` bounced / were blocked as expected (no real inbox). No errors in Render's log. Next: the local run in Mailpit (needs `docker compose up -d`).
    - **Step 5 - local end-to-end run passed** (28 Sep, Chrome as a seeded guest, emails read in Mailpit): booking #78 → "Complete your payment" (hold time, Pay now → the app's payment page with the same hold, Reply-To = owner); paid with 4242 → "confirmed" + owner alert, one each; guest cancel → "cancelled" with "A full refund of €462 is on its way"; Mailpit stopped → booking #79 still created, its email **Failed** with the reason in Django Admin; Mailpit started → **Retry sending** on the failed one + an already-sent one → "1 already sent, 1 sent", no duplicate.
  - **Done.** Four booking emails (received with Pay now, confirmed, cancelled with the refund wording, owner alert) sent at every booking change, through a `BookingEmail` outbox: recorded in the booking's transaction, sent after commit, at most once per booking + kind, never blocking a booking, out-of-date ones skipped, failures retried from Django Admin or `send_pending_emails`. Brevo HTTP API on Render (Render's free plan blocks SMTP), Mailpit locally. 20 numbered rules (EM-01…EM-20) in the README with automated tests (39 in `notifications`, **253 backend tests**) and manual runs locally and on Render. Notes: Brevo sends from its own `brevosend.com` address for a Gmail sender (Reply-To keeps replies with the owner); for real use, authenticate an own domain in Brevo. Follow-up idea (not planned): a "refund completed" email when Stripe confirms the refund.
  - **Changes after review** (agreed 28 Sep, after the Render run showed a `brevosend.com` sender and guest emails going to `admin_demo@example.com`):
    - **A) Admin accounts' mail → the owner's real inbox:** when a booking's guest is an admin account (role `admin`), its guest emails go to `BOOKING_ALERT_EMAILS` (the Gmail from the environment) instead of the login email; empty list → the account's own email. Normal guests unchanged. 2 tests (EMAIL-33), rule EM-21.
    - **B) Gmail API instead of Brevo** (Brevo removed completely): so the sender is the owner's real Gmail, not Brevo's rewritten `…@brevosend.com` address. OAuth refresh token (Desktop client, app published "In production" so the token doesn't expire after 7 days), a `gmail_authorize` command to get it; still HTTPS only (Render's free plan).
      - **Built:** `GmailApiEmailBackend` (stdlib: refresh token → access token cached per process, then `users.messages.send` with Django's own MIME message base64url; a 401 → fresh token + one retry; `EmailSendError` with `refused` for 4xx, e.g. `invalid_grant` with "run gmail_authorize again", never a secret). `EMAIL_PROVIDER` console / smtp / **gmail** (missing `GMAIL_*` → console + warning W002). `manage.py gmail_authorize` (sign-in link with PKCE + state, paste the redirected `127.0.0.1:8765/?code=…` address back → prints `GMAIL_REFRESH_TOKEN`) and `manage.py send_test_email`. `X-Booking-Email` header instead of Brevo's `Idempotency-Key`. `render.yaml`: `EMAIL_PROVIDER=gmail` + the three `GMAIL_*` secrets; Brevo backend, settings, tests and docs removed (README "Emails on Render (Gmail API)" with the Google Cloud steps; the Brevo Render run kept as history). 6 new tests (45 in `notifications`); **259 backend tests pass** on Postgres. Next: the owner's Google Cloud setup, then real sends locally and on Render.
      - **Tested end to end** (28 Sep): Google Cloud set up together (Gmail API enabled, `gmail.send` scope added, the app kept in **Testing** with the owner's Gmail as test user - publishing would need a home page + privacy policy; the refresh token therefore expires after 7 days, ~5 Oct: re-run `gmail_authorize`). `gmail_authorize` locally (its prompt made clearer after an email was pasted instead of the browser address; 1 test) → `send_test_email` arrived from the real Gmail. Render (`29e3e9d`, `GMAIL_*` set, `BREVO_API_KEY` deleted), as `admin_demo`: booking #45 → "Complete your payment", admin Confirm → "confirmed" + owner alert, admin Cancel → "cancelled" - all four **from lysikatosparaskevas@gmail.com, in the inbox (not spam), addressed to the owner's Gmail** instead of `admin_demo@example.com`. **260 backend tests pass.**
  - **Done (after review).** Emails now go out through the Gmail API as the owner's real Gmail, and an admin account's booking emails reach the owner's inbox. Reminder: until the Google app is published, renew the Gmail token weekly (`gmail_authorize`, then update `.env` and Render) - step by step in the README's "Gmail token: renew it, or make it permanent". Follow-up idea (not planned yet): a small public `/privacy` page on the site, so the Google app can be published and the token stops expiring.

- [x] **TICKET-031** — Responsive layout + PWA manifest
  - Priority: P1 · Depends on: Epic 3 complete
  - Covers the "mobile app" goal without a separate codebase.
  - Decisions (agreed before building):
    - **Manifest + icons only, no service worker**: installable, but nothing is cached, so the demo never shows an old build or stale booking/payment data.
    - Admin tables on phones/tablets: **stack into cards**.
    - App icon: a **simple original logo** (white house on the app's azure `#005cbb`), approved from a preview.
    - An **Install app** button in the account menu (an install icon next to Log in when logged out); on iPhone the Share → Add to Home Screen steps.
  - Audit first (headless Chrome, every route as visitor/guest/admin at 360/390/768/1280 px, local backend + seeded data): no page scrolled sideways, but the admin tables were cut off on phones and tablets (bookings table 1,567 px wide, scrolling even on a 1280 laptop), the dashboard's 6 period buttons overflowed on phones, the admin side nav squeezed tablets, and on phones the detail page's price / Book now only came after the whole calendar.
  - Done:
    - **Shared breakpoints** `src/styles/_responsive.scss` (phone ≤ 600, tablet ≤ 960; `@use 'responsive' as r;` via `stylePreprocessorOptions.includePaths`) replace the one-off 480/600/720/900/960 values; plus a `table-cards` mixin.
    - **Admin bookings / properties → cards** at ≤ 960 px, CSS only (`data-label` per cell): bookings = #ref + status, property, labelled rows, actions at the bottom; properties = photo, title with "€/night · Sleeps · rating", location, status, actions. Laptops (961-1440 px): bookings table drops "Booked", wraps text, shortens emails (full one on hover) → no sideways scroll at 1280.
    - **Admin shell**: side nav → top bar on tablets, four equal icon tabs (with the pending badge) on phones. **Dashboard**: period buttons scroll in their own strip, breakdown shows property/occupancy/revenue on phones.
    - **Property detail**: a bottom bar on tablets/phones (price + stay total, *Choose dates* → scrolls to and focuses the panel, *Book now* once dates are confirmed), hidden while the panel is on screen (IntersectionObserver).
    - **Toolbar**: links stay down to 600 px (only the email collapses on tablets). **Booking form**: shorter photo and less stepper indent on phones. `100dvh`, `viewport-fit=cover` + safe-area padding (toolbar, footer, bottom bar), no iOS text resize.
    - **PWA**: `public/manifest.webmanifest` (standalone, `start_url` `/listings`, theme colour = the toolbar, shortcuts Find a stay / My bookings), icons (192, 512, maskable 512, Apple touch 180, SVG, new `favicon.ico`), `index.html` tags. `core/pwa/InstallService` (created at start-up by `App`) keeps Chrome's `beforeinstallprompt` and replays it once from the button; iPhone/iPad → `InstallIosDialog` steps; hidden when running as the app / after `appinstalled`.
    - `scripts/hosted-check.sh` also checks the manifest + 512 px icon.
    - **Checks:** after-audit clean at all 4 widths; Chrome's installability check (`Page.getInstallabilityErrors`) on the build: no errors; iPhone emulation: button + steps dialog fit 390 px; production build 600 kB initial / 146 kB transferred, no budget warnings. **12 new frontend tests (225 total)** - InstallService (7), toolbar install (2), detail bottom bar (3).
    - **Pushed** `942518b` + `46f4517`; Render redeployed; live site serves the manifest (name "Booking System Demo") and icons; **Hosted demo check green** (incl. the new manifest check).
    - README: new "Mobile & PWA (TICKET-031)" section (design, per-page table, how it was checked, install matrix per browser); layout, status and next steps updated.
  - Fix after review (owner's check in Chrome device mode, iPhone 16): on phones a real 4:3 photo on a My bookings card spilled out of its 16:9 box and covered the title/dates (the audit's stock photos hadn't loaded). Image pinned to its box (`absolute` + `object-fit: cover`); same for the booking form's summary photo (was cropped off-centre). The audit now serves a real photo and flags images larger than their box: clean at all 4 widths.
  - Notes: Render serves `.webmanifest` as `binary/octet-stream`; browsers don't check the manifest's type, so no header change. Chrome only offers installing after some interaction with the site (its engagement rule), so the Install item can take a few seconds of use to appear; it never appears in the installed app.

---

## Epic 7 — Nice-to-have

- [x] **TICKET-032** — Reviews/ratings UI
  - Priority: P2 · Depends on: TICKET-009, TICKET-019
  - Decisions (agreed before building):
    - **who can review:** only a guest with a **confirmed** booking at that property whose check-out date has arrived
    - **where:** both a "Write a review" button on the property page and "Leave a review" on past stays in My bookings (one shared dialog)
    - **reviews are final:** one per guest per property, no edit or delete
    - **admin:** a new Reviews page in the admin area with **Hide/Unhide** (not delete); hidden reviews leave the public list and the rating
  - Plan: step 1 backend API · step 2 reviews on the property page · step 3 the review dialog (property page + My bookings) · step 4 admin Reviews page · step 5 seeder, README, browser check.
  - Step 1 done (backend API):
    - `Review.is_hidden` (migration `0002_review_is_hidden`), `Review.objects.visible()`, and `has_finished_stay()` (the rule, in one place).
    - `GET /api/properties/{id}/reviews/` - public, 5 per page, newest first, with a `summary` (average, count, per-star breakdown); names shown as "Maria K.", never emails.
    - `POST /api/reviews/` - rule checks, one per property (race → `400` via the DB constraint), comment optional up to 1,000 characters; no edit/delete routes.
    - `viewer_review` on the property detail and `can_review`/`my_review` on each booking, so the frontend never repeats the rule (one extra query per bookings response).
    - `GET /api/admin/reviews/` (filters: rating, property, hidden, search) and `PATCH {is_hidden}`.
    - `rating_avg`/`review_count` on cards and the detail now skip hidden reviews. The seeder only reviews *confirmed* past stays (same rule).
    - 37 new tests; all 297 backend tests pass on Postgres. Smoke-tested on seeded data with curl.
    - README: new "Reviews API (TICKET-032)" section; layout, data model, bookings/properties responses, seeding and next steps updated.
  - Step 2 done (reviews on the property page):
    - New `pages/property-detail/reviews/` section under Availability, loading its own data (`core/reviews/ReviewService`): the average + stars (half stars), "N reviews", one bar per star rating (share of reviews, count beside it, dashboard meter style, screen-reader label per row), then the reviews in two columns (one on phones) with initial, "Maria K.", month, stars and comment.
    - **Show more reviews** (5 at a time, "Showing 5 of 8", no duplicates if the pages shift, Try again on failure); skeleton, "No reviews yet", load error + Try again; `reload()` ready for step 3.
    - The header "★ 3.9 · 8 reviews" is now a link that scrolls to the section (URL unchanged). Shared `shared/star-rating.ts`.
    - 9 new tests (234 frontend tests pass); production build clean (no budget warnings). Checked in headless Chrome at 1280 and 390 px with a property that has 8 reviews: no sideways scroll.
    - README: new "Reviews section (TICKET-032)" under "Property detail page"; layout, tests and next steps updated.
  - Step 3 done (writing a review):
    - `shared/review-dialog.ts`: "How was your stay at …?", a star picker made of real radio buttons (keyboard/screen-reader friendly, 44 px targets, hover preview, Terrible…Excellent), optional comment with a 1,000 counter, the "Reviews are final" note; posts itself (spinner, can't close while posting), shows a refusal inside the still-open dialog, closes with the new review. `ReviewService.create()`.
    - Property page: **Write a review** only when the server's `viewer_review.can_review` is true; afterwards "✓ You rated this place ★★★★☆", the reviews reload and the header rating follows the section's summary.
    - My bookings (past, not cancelled): **Leave a review** when `can_review`, "✓ You rated this place" when `my_review`; snackbar + list reload after posting.
    - 13 new tests (247 frontend tests pass); production build clean. End-to-end in headless Chrome against the real API at 1280 and 390 px (post from both places, rating required, header 8 → 9 reviews, no sideways scroll).
    - README: "The review dialog", "Reviews on past stays", tests and next steps.
  - Step 4 done (admin Reviews page):
    - `/admin/reviews` + "Reviews" in the admin nav (phones: five equal tabs, fits 320 px). `core/admin/admin-reviews.service.ts` (list with filters, `setHidden`).
    - Filters in the URL: All / Visible / Hidden, search (guest, property, comment), property, rating; table with posted date, property (→ public page), guest name + email, stars, comment (2 lines, full on hover), Visible/Hidden chip, **Hide** (red) / **Show** - each asks first, then snackbar + refresh. Loading / empty / no-match + Clear filters / error states.
    - Laptops drop "Posted" so the table fits at 1280; cards on tablets/phones.
    - 10 new tests (257 frontend tests pass); production build clean. Checked as the demo admin against the real API: Hide took the property's public rating from 3.9 / 9 reviews to 4.1 / 8, Show put it back; no sideways scroll at 1280/768/390/320 px.
    - README: new "Admin reviews (Angular, TICKET-032)" section; admin routes, admin layout, project layout and next steps updated.
  - Step 5 done (final check):
    - On the final `master` (`cc63916`): **297 backend tests** (Postgres) and **257 frontend tests** pass, `makemigrations --check` clean, production build clean.
    - Fresh database: `migrate` from zero + `seed_demo_data` → every seeded review backed by an ended, confirmed stay.
    - Browser regression against the real API: **27/27 checks** (visitor, unpaid past stay, eligible guest posting with the keyboard, reload, duplicate/edit refused, My bookings, guest blocked from admin, admin hide → public rating/card/guest view, Hidden filter, show again, admin properties rating). Table in README "Reviews: final check".
    - Render: auto-deployed; **Hosted demo check green** on `cc63916`; live API reviews endpoints + summary, 401s for anonymous writes/admin list, live property page Reviews section + header link, `/admin/reviews` route guarded.
    - Render as admin (owner logged in, then tested in that tab): list of the 5 live reviews, Visible/Hidden toggle + Clear filters, search, rating and property filters (combined), browser Back; **Hide** on one review → live summary, listing card and public page dropped it ("New", "No reviews yet") → **Show** → restored (all 5 visible again, as before).
  - **Done.** Guests with an ended, confirmed stay rate a place 1-5 stars with an optional comment (final, one per place) from the property page or My bookings; everyone sees the reviews with a star summary and per-star bars; admins filter all reviews and Hide / Show them again, and hidden reviews leave the public list and every rating. Backend 297 tests, frontend 257 tests. Follow-up: more seeded reviews in TICKET-037.

- [x] **TICKET-033** — Favorites
  - Priority: P2 · Depends on: TICKET-017, TICKET-018
  - Decisions (agreed before building):
    - **stored on the server, per account** (a `Favorite` row per user + property); a logged-out tap on the heart goes to login, comes back, and the save completes
    - **where to see them:** a new `/favorites` page ("Saved" in the toolbar and the account menu), the same property cards
    - **deactivated places stay** on the Saved page, greyed out as "No longer available" with a Remove button (not bookable)
    - **admins:** a "Saved by N" column in admin Properties; no hearts for admin accounts; newest saved first; Undo snackbar (~5 s) when un-hearting on the Saved page
  - Plan: step 1 backend API · step 2 heart button (cards + property page) · step 3 `/favorites` page · step 4 admin "Saved by N" · step 5 seeder, README, final check.
  - Step 1 done (backend API):
    - New `favorites` app: `Favorite(user, property, created_at)`, one per user per property (DB constraint), CASCADE both ways (properties are only soft-deleted); migration `favorites/0001_initial`; Django Admin list.
    - `GET /api/favorites/` - my saved places, newest first, 12 per page, the **same card shape as the listings** + `saved_at`; deactivated places stay with `is_active: false`.
    - `PUT /api/favorites/{property_id}/` (`201` first time, `200` again, `404` inactive/unknown) and `DELETE` (always `204`) - both safe to repeat; a double-tap race is settled by the constraint.
    - `is_favorite` for the caller on the property list and detail; `favorite_count` for admins only. New `listings/queries.py:property_cards()` shared by both APIs - `EXISTS`/`COUNT` subqueries, so still one query per page and the rating isn't skewed.
    - 33 new tests (+1 existing listings test updated for the new field); all 330 backend tests pass on Postgres, `makemigrations --check` clean. Smoke-tested on seeded data with curl.
    - README: new "Favorites API (TICKET-033)" section; status, project layout, data model, properties responses, Django Admin table and next steps updated.
  - Step 2 done (the heart):
    - `core/favorites/FavoriteService`: the heart state per place (server's `is_favorite` + this session's taps, so cards and the property page agree), optimistic save/remove, switch back + snackbar on failure ("no longer available" for a `404`), second tap ignored while busy; forgotten on logout.
    - Logged out: the tap is parked in `sessionStorage`, the visitor goes to `/login?returnUrl=…&reason=favorite` ("Log in to save this place…"), and the save completes right after login with a "Saved …" snackbar (dropped after 30 min or for an admin).
    - `shared/favorite-button.ts`: a toggle button (`aria-pressed`, fixed label "Save {title}" - the pressed state says whether it's saved), round 44 px overlay on card photos (next to the card link, not inside it) and "Save / Saved" in the property page header. No hearts for admins.
    - 25 new tests (282 frontend tests pass); production build clean. Browser check against the real API at 1280 and 390 px: 27/27.
    - README: new "Favorites: the heart (Angular, TICKET-033)"; status, layout, cards, property page header and next steps updated.
    - Decision after review (shown with screenshots): keep the fixed label + `aria-pressed` ("Save Harbour Loft, toggle button, pressed") rather than switching to "Remove … from saved".
  - Step 3 done (the Saved page):
    - `/favorites` (authGuard, "Saved · Booking System Demo"): "N saved places", the listings' cards, newest saved first, 12 per page (`?page=`); **♡ Saved** in the toolbar for guests and in the account menu (phones); none for admins.
    - Un-hearting removes the card at once + "Removed "…" from saved." with **Undo** (5 s) → back in the same spot; a failed remove brings it back with the error.
    - Deactivated places: greyed out, "No longer available" badge, not a link, **Remove** instead of the heart (no Undo - they can't be saved again).
    - A page emptied here refills from the server (or steps back a page) once the Undo bar is gone; skeleton, error + Try again, empty state + Browse stays.
    - 15 new tests (297 frontend tests pass); production build clean. Browser check against the real API at 1280 and 390 px: 24/24.
    - README: new "Saved page (Angular, TICKET-033)"; status, layout, toolbar and next steps updated.
  - Step 4 done (admin "Saved by"):
    - Admin Properties table: a **Saved by** column (♥ N, grey ♡ 0 when nobody saved it; screen readers: "Saved by 3 guests") from the admin-only `favorite_count`; tablets/phones: "· Saved by N guests" in the card line.
    - 1 new test (298 frontend tests pass); production build clean. Browser check as the demo admin against the real API: every row matches the API at 1280/768/390/320 px, the table still fits at 1280 (no sideways scroll), no page scroll on phones: 14/14.
    - README: "Admin properties" columns, status and next steps updated.
  - Step 5 done (seeder + final check):
    - `seed_demo_data`: every demo guest saves 2-5 active places (~40 in total); the first guest also keeps one retired place saved (the greyed "No longer available" card, listed first) - if the random mix retired nothing, the last property is retired for that; the admin saves nothing; `--clear` removes favorites. 4 new tests.
    - On the final `master` (`d841349`): **334 backend tests** (Postgres) and **298 frontend tests** pass, `makemigrations --check` clean, production build clean.
    - Fresh database: `migrate` from zero + `seed_demo_data` → browser regression against the real API: **68/68** (steps 2-4 re-run + the seeded data). Table in README "Favorites: final check".
    - Render: **Hosted demo check green** on `d841349`; live API `/api/favorites/` → 401 anonymous, `is_favorite` on cards; as the demo admin: no hearts/Saved link, "Saved by" column fits; as a demo guest (owner logged in): save from the cards (kept after reload), "♥ Saved" on the property page, the Saved page (count, newest first, remove → gone after reload, Undo → back after reload), empty state; test saves removed afterwards.
  - **Done.** Guests save places with a heart on every card and the property page (logged out: login first, then it's saved), see them on a Saved page (`/favorites`) with Undo and deactivated places greyed out with Remove; admins see "Saved by N" per property. Backend 334 tests, frontend 298 tests. Follow-up: the live database gets seeded favorites with TICKET-041's one-off re-seed.

- [x] **TICKET-034** — Map view for listings
  - Priority: P2 · Depends on: TICKET-018
  - Decisions (agreed before building):
    - **latitude/longitude fields** on `Property` (optional, both or neither) + a **Find on map** button in the admin form that geocodes the location text with OpenStreetMap Nominatim, via the backend
    - **Leaflet + OpenStreetMap** tiles (no API key), lazy-loaded
    - **split view on desktop** (list left, sticky map right), a List / Map button on phones; the map shows **every matching stay**, not just the current page
    - **approximate location**: only admins see the exact point; everyone else (even after booking) gets a ~500 m circle
    - also: a **map on the property page** and **click/drag to place** the pin in the admin form
  - Plan: 1 coordinates (model, API, backfill, seeder) · 2 `/api/properties/map/` pins endpoint · 3 admin geocode endpoint · 4 shared Leaflet map component · 5 `/listings` split view · 6 property page map · 7 admin form map · 8 final check (tests, fresh DB, Chrome, Render)
  - Step 1 done (map positions):
    - `Property.latitude` / `longitude` (`DecimalField(9, 6)`, nullable): both or neither + ranges, checked in `clean()` and by 3 DB `CheckConstraint`s (`0003_property_coordinates`).
    - API (`listings/geo.py`, `CoordinatesMixin`): list, detail and the Saved list return `latitude`, `longitude`, `location_is_approximate`, `location_radius_m`. Admins get the exact point; everyone else a point moved 100-400 m (direction/distance fixed per property from an HMAC of `SECRET_KEY` + id), so the real place is always inside the 500 m circle but never at its centre, and never reaches a guest's browser.
    - Admin writes: numbers or numeric strings, rounded to 6 decimals; a `PATCH` with one coordinate is checked against the stored other one; `null`/`""` for both clears; out of range / `NaN` / `Infinity` / `true` → 400. Django Admin: a "Map position" section.
    - `0004_backfill_coordinates` (data migration, frozen city table) gives existing places in the 12 seeder cities a point near the city, repeatable per id; others stay without one. Render gets positions on the next deploy, no re-seed. `seed_demo_data` places new properties near their city (points a little inland, small radii on islands).
    - 25 new tests (24 in `listings`, 1 in `core`); **359 backend tests** pass on Postgres, `makemigrations --check` clean. Fresh DB: `migrate` + `seed_demo_data` → 14/14 places have a position; the API gives the admin the exact point and a logged-out visitor one 230-360 m off with `location_radius_m: 500`.
    - README: new "Map positions API (TICKET-034)"; data model, migrations, layout, seeding, status and next steps updated.
  - Step 2 done (map pins endpoint):
    - `GET /api/properties/map/` (`PropertyViewSet.map` + a lean `PropertyPinSerializer`): every stay matching the **same filters and 400s as the list** (shared `apply_property_filters`, incl. `is_active` for admins), not paginated, in the requested order. Response: `count` (pins), `missing_position` (matching stays without a position, for "N stays not shown on the map"), `truncated` (only past a 500-pin safety limit), `results` (id, title, location, coordinates + approximate flag/radius, price, capacity, is_active, cover, rating).
    - Same exact/approximate rule as the cards (pin = card = property page point). 4 queries however many pins; ~4 kB for the 14 seeded stays.
    - 13 new tests; **372 backend tests** pass on Postgres. Checked against seeded data (13 approximate pins logged out, 14/13 for the admin, filters, 400).
    - README: new "Map pins API (TICKET-034)"; Properties API table, layout, status and next steps updated.
  - Step 3 done (admin place search):
    - Decisions: **Greece only** (`countrycodes=gr`); up to **5 specific places** to pick from (address / street / area / city, from Nominatim's `place_rank`) - region/country-level matches dropped.
    - `GET /api/admin/geocode/?q=` (`listings/geocoding.py` + `GeocodeView`, admin only): `{query, results: [{label, name, latitude, longitude, precision, kind}], attribution}`; 400 for a missing/too short/too long `q`, 429 past 30 searches/min per admin, **503** (`geocoding_unavailable` / `geocoding_disabled`) when Nominatim can't be used - the admin can still place the pin by hand.
    - Nominatim usage policy kept on the server: identifying User-Agent, ≤ 1 request/s per process (lock + timestamp), results cached 24 h (1 h for nothing found; case/space-insensitive key), attribution returned. Settings `GEOCODING_URL` / `_USER_AGENT` / `_LANGUAGE` / `_TIMEOUT` (defaults work; empty URL = off), documented in `.env.example`. No new dependency (`urllib`).
    - 16 new tests (Nominatim mocked); **388 backend tests** pass on Postgres. Render (after `5e4ad97`, via Chrome): steps 1-2 live - the backfill gave all 13 active stays a position (`/map/` → 13 pins, `missing_position: 0`, approximate for a guest); `/api/admin/geocode/` → 401 logged out, 403 as a demo guest. The live Nominatim lookup needs an admin session (this sandbox can't reach Nominatim) - to do with the owner in step 8.
    - README: new "Admin place search API (TICKET-034)"; layout, environment variables, status and next steps updated.
  - Step 4 done (shared map component):
    - Decisions: **CARTO Voyager** tiles (light base map, no key; credits OpenStreetMap + CARTO); **clusters** with `leaflet.markercluster`.
    - New packages: `leaflet` ^1.9.4, `leaflet.markercluster` ^1.5.3 (+ `@types/*` dev); `allowedCommonJsDependencies` for both. Docker: `docker compose up -d --build -V frontend` after pulling (node_modules lives in its own volume).
    - `shared/map/` `<app-map>`: `markers` (price tag with `label`, round pin without, shaded circle with `areaRadiusM`; markers without a position skipped), `highlightedId` (marker or its bubble), `cluster`, `fitToMarkers` (all points / one at zoom 15 / Greece), `maxFitZoom`, `scrollWheelZoom`, `ariaLabel`; outputs `markerSelect`, `mapClick`; optional `<ng-template let-marker>` pop-up rendered as an Angular view. Spinner, "The map couldn't load." + Try again, ResizeObserver, focusable named markers/bubbles.
    - `MapLoader`: Leaflet + markercluster by dynamic `import()` and a `map-styles.css` bundle built non-injected - loaded once, on the first map; a failure can be retried. Production build: initial bundle byte-identical; with a map on a page Leaflet (37.6 kB gz) + clusters (8.0 kB gz) are lazy chunks; no warnings.
    - 20 new tests (real Leaflet in jsdom); **318 frontend tests** pass; production build clean. Browser check comes with step 5 (first page using it).
    - README: new "Shared map component (Angular, TICKET-034)"; layout, status and next steps updated.
  - Step 5 done (listings map):
    - Decisions: **60/40 split from 1100 px** (2 cards per row, sticky map below the toolbar), a floating **Show map / Show list** button below that with `?view=map` in the URL; pop-up card with photo, title, rating, location, price, **stay total** when dates are picked and the **♡ heart**.
    - **Base map changed:** CARTO now returns an "API KEY REQUIRED" placeholder for every Voyager (and light_all) tile, whatever the referrer (checked in Chrome) → owner chose **softened OpenStreetMap** (standard OSM tiles + a CSS filter on the tile layer only; credit "© OpenStreetMap contributors"; no key).
    - `/listings`: pins for **every** matching stay (`PropertyService.mapPins`, same filters, `is_active=true`); the list reloads only on search/page (`listKey`), pins only on filter changes and only while the map is shown (`pinsKey`); old pins kept while new ones load (progress bar); notes for stays without a position / the 500-pin limit / a failed load (Try again). Card hover/focus lifts the stay's tag (or its bubble). New search / Clear filters / paging keep the view.
    - `map-popup-card/`: links to the stay with dates/guests; heart via the shared `FavoriteService` (none for admins). Backend: map pins now include `is_favorite` (+1 test). `.app-map { isolation: isolate }` keeps Leaflet's z-indexes under the sticky toolbar / floating button.
    - 16 new frontend tests (**334** pass), **389** backend tests pass; production build clean (initial +0.6 kB, Leaflet still lazy).
    - Chrome, local app: split 946/630 px at 2560 px, tags + bubbles over Greece, pop-up (Rhodes €66), card hover → right bubble, bubble zoom-in split, Kalamata search → 2 tags; 390 px frame: Show map → `?view=map`, 343×520 map, Show list, no sideways scroll; no console errors.
    - README: new "Listings map (Angular, TICKET-034)"; "Shared map component" (base map decision), "Map pins API" (`is_favorite`), layout, status and next steps updated.
  - Step 6 done (property page map):
    - Decisions: "Where you'll be" between Availability and Reviews, note "Shown within about 500 m to protect the host's privacy"; compact map; an **Open in Google Maps** link. (Owner also asked to make sure CARTO is gone: no CARTO tile URL/config/package remains - the last code-comment mention was removed; the README keeps the history.)
    - `pages/property-detail/location/`: guests get a 500 m circle (no pin) and a Google Maps link to the *area* (`map_action=map`, zoom 15, no pin); admins get the exact pin and a Google Maps pin link; no position → location text + a Google Maps search. 320 px map, scroll-wheel zoom off, cluster off; link opens in a new tab with "(opens in a new tab)" for screen readers.
    - 4 new tests; **338 frontend tests** pass; production build clean (initial bundle unchanged).
    - Chrome, local app (logged out): section order Availability → Where you'll be → Reviews, 320 px map with one 500 m circle over Thessaloniki, area link (zoom 15, no pin). Admin view covered by tests.
    - README: new "Property detail page → Where you'll be"; layout, status and next steps updated.
  - Step 7 done (admin form map position):
    - Decisions: Find on map uses the **best match** straight away; a separate **Find address** box pre-filled from Location; the position is **required**.
    - Backend (`CoordinatesMixin.validate`): POST/PUT must send both (400 "Every property needs a map position…"), null/"" is refused ("A map position can't be removed - move the pin instead." - replaces step 1's clearing), a PATCH without them still works (Show/Hide on older rows). DB columns stay nullable for older rows; Django Admin (dev tool) not required. +4 tests (one replaces the old clear test).
    - Frontend: `GeocodeService`; `location-picker.ts` (form control, required): Find address + Find on map / Enter → best match placed at once with "Placed at … (exact address / street / neighbourhood / town centre). Drag the pin to fine-tune."; nothing found / 503 / 429 / offline messages; click the map or drag the pin (no re-zoom), 6-decimal coordinates shown; 340 px map, scroll-wheel zoom off. `<app-map>` gained `draggable` markers + `markerDragEnd`. The form sends `latitude`/`longitude`, loads them on edit, shows server position errors under the card, and an older place without a position must get one before saving.
    - Bug caught by the tests before shipping: the "nothing found" message cleared itself (the reset effect also tracked the search state) - fixed with `untracked`.
    - 15 new frontend tests (**353** pass), **392** backend tests pass; production build clean. Browser check of the form moves to step 8 (behind the admin login - with the owner signed in), with the live Find on map.
    - README: new "Admin properties → Map position"; "Map positions API → Setting a position" (required rules), status and next steps updated.
  - Step 8 done (final check, on `6b9fe45`):
    - **392 backend** + **353 frontend** tests pass, `makemigrations --check` clean, production build clean (Leaflet lazy).
    - Fresh DB (`migrate` from zero + seed): 14/14 places positioned; `/map/` 9 approximate pins logged out / 9 exact for the admin; detail offset 347 m with radius 500; create without / clear position → 400; PATCH `is_active` without → 200; geocode logged out → 401.
    - Local app as admin (Chrome): edit form exact draggable pin + address pre-filled; **live Find on map** "Tsimiski 45, Thessaloniki" → best match placed "(street)"; map click moves the pin without re-zoom; Cancel → "Discard unsaved changes?" → stored position unchanged; New form → position required, nothing sent; property page exact pin + Google Maps pin link; listings 13 exact pins, no hearts for admin, no console errors.
    - Render as admin: all steps deployed (split view; anonymous pins approximate with `is_favorite`; a PATCH both versions refuse returned step 7's message, no data change); 21/21 OSM tiles loaded; edit form **live Find on map from Render's server**: two English tourist names → "No place in Greece matched…" (Nominatim has no entry), "Mykonos" + Enter → placed "(neighbourhood / village)", API "Tsimiski 45, Thessaloniki" identical to local; Cancel → Discard, position unchanged; property page exact pin; no console errors.
    - Nothing was saved to either database during the checks.
    - README: new "Map view: final check"; status and next steps updated.
  - **Done.** Stays have a map position (exact for admins, a ~500 m area for everyone else); `/listings` shows every matching stay on a map (60/40 split on wide screens, Show map on phones, clusters, pop-up card with heart and stay total); the property page has "Where you'll be" + Open in Google Maps; the admin form requires a position (Find on map with Nominatim, click/drag). Base map: softened OpenStreetMap (CARTO now needs a key). Backend 392 tests, frontend 353 tests.
  - Follow-up: shorter Find on map labels → TICKET-042. (Not doing: hints for tourist names Nominatim doesn't know - owner's call: typing a real address is the admin's job, and the pin can always be clicked/dragged.)

- [ ] **TICKET-035** — Revenue chart over time (admin dashboard)
  - Priority: P2 · Depends on: TICKET-023

- [ ] **TICKET-036** — Real photo uploads
  - Priority: P2 · Depends on: TICKET-006
  - Replaces the fallback of fixed stock photo URLs. ( i want to add my S3 aws bucket)

- [ ] **TICKET-042** — Shorter "Placed at …" labels in the admin Find on map
  - Priority: P2 · Depends on: TICKET-034 · Small; can be folded into TICKET-037 (UI polish pass)
  - Requested after TICKET-034: the label is Nominatim's full address line, e.g. "Ιωάννη Τσιμισκή, Ladadika, 1st District of Thessaloniki, Thessaloniki Municipal Unit, Municipality of Thessaloniki, … , 546 23, Greece" - too long to read at a glance.
  - Show a short form, e.g. the first 2-3 parts + the town ("Ιωάννη Τσιμισκή, Ladadika, Thessaloniki"), with the full line available (title/tooltip). Decide when the ticket starts: shorten on the backend (`listings/geocoding.py`, e.g. a `short_label` built from Nominatim's `addressdetails`) or in the frontend (`location-picker.ts`).
  - Out of scope (owner's decision): matching English tourist names Nominatim doesn't know - typing a real address is the admin's job; click/drag the pin otherwise.
  - Tests for the shortening (street / house number / town-only / no town) + update the README's "Admin properties → Map position".

---

## Epic 8 — Final polish (last day before the meetup)

- [ ] **TICKET-037** — UI polish pass + refresh seed data
  - Priority: P0 · Depends on: Epic 3 & 4 complete
  - Seed data must include **enough reviews** to show the TICKET-032 Reviews section well (requested during TICKET-032: the current seeder only produced 3 reviews in total). E.g. more past *confirmed* stays so most properties get several reviews, with a mix of ratings and some without a comment - every review still backed by a real ended, confirmed booking (the rule the API enforces).

- [ ] **TICKET-041** — Simple demo logins in the seeder (admin + guests)
  - Priority: P0 · Depends on: TICKET-026 · Do before TICKET-039 (requested after TICKET-026)
  - Goal: logins that are easy to type at the meetup table, for both roles, e.g. `admin@demo.com` / `admin123` and `guest1@demo.com` … `guest10@demo.com` / `guest123` (exact values to agree when the ticket starts).
  - Seeder (`seed_demo_data`): fixed, numbered guest emails instead of Faker usernames (Faker still provides the first/last names); one shared guest password; simple admin email/password. Keep them as constants in one place so the README and the login page hint can't drift.
  - Simple passwords are fine here: the seeder uses `set_password()`, which skips Django's password validators. Registration still enforces them for real sign-ups.
  - `--clear` must also remove the old-style `guest_*@example.com` / `admin_demo` accounts, so re-seeding doesn't leave both sets behind.
  - **Hosted copy (Render):** `--if-empty` won't re-seed a database that already has data, so plan a one-off re-seed there. There's no shell on the free plan, so e.g. a temporary env var (`SEED_DEMO_DATA=reset`) that makes `build.sh` run `seed_demo_data --clear` once, removed right after that deploy.
  - Optional: a small "Demo logins" hint on the login page (or the README only), so visitors know which accounts exist.
  - Update the README (Seeding demo data, Deploying to Render → logins) and the tests for `--clear` / `--if-empty`.

- [ ] **TICKET-038** — Two-language support (English / Greek)
  - Priority: P2 · Depends on: Epic 3 & 4 complete, TICKET-029 (the payment screens are part of the text to translate)
  - Moved in from "Explicitly cut" (requested after TICKET-029). Suggested approach, following the build plan's advice ("two JSON label dictionaries rather than full Angular i18n tooling"):
    - **Runtime switching, one build:** two dictionaries `en.json` / `el.json` + a tiny signal-based `TranslationService` and a `t` pipe - not Angular's build-time i18n (that needs one build and one deployed site per language), and no new npm dependency unless we agree on `ngx-translate`.
    - **Language toggle** "EN / ΕΛ" in the toolbar; the choice remembered in localStorage (per browser), first visit defaults to the browser's language.
    - **All UI text** incl. page titles, dialogs, snackbars, empty/error states, the booking policy lines and the payment screens; **dates and money in the chosen locale** (`el-GR`: "Τετ 10 Μαρ 2027", "364,00 €"), and Material's own texts (paginator, date picker, stepper).
    - **Server messages:** translate by the API's error `code` (e.g. `dates_unavailable`, `payment_window_closed`) on the frontend, falling back to the server's English text; the backend stays English-only.
    - **Stripe's payment page** in the same language (`locale: "el"` / `"en"` on the Checkout Session).
    - Out of scope: translating property content (titles/descriptions are entered by the admin in one language) and Django Admin.
    - Tests: every key exists in both dictionaries (no missing Greek), switching updates the page without a reload, dates/prices formatted per locale.
  - Decisions to agree when the ticket starts: the approach above vs `ngx-translate`; default language (browser vs always English); whether the server's field-level validation messages need Greek too.

- [ ] **TICKET-039** — Final redeploy + smoke test (local + hosted) — **the last ticket**
  - Priority: P0 · Depends on: every ticket above (TICKET-026, TICKET-027 for hosting)
  - Redeploy both Render services from the final `master`, run the local and hosted smoke tests (the "Payments: business rules & test cases" E2E cases + the TICKET-028 hosted demo check), and tick off the README's "Demo day" checklist.
  - (The former TICKET-039 "Record a backup demo video" was dropped - decision after TICKET-029.)

---

## Explicitly cut unless way ahead of schedule

Not tickets to plan around — only pick these up if everything above is done
with time to spare:

- ~~Multi-language (Greek/English)~~ — now planned as TICKET-038.
- A true native mobile app — the responsive/PWA work in TICKET-031 already
  covers this need.

## If a day slips

Trim from the bottom up: Epic 7 first, then Epic 6, then TICKET-038 (two
languages), then reduce Epic 8 to just TICKET-039 (final redeploy + smoke
test). Do not cut anything in Epic 0–5 — the core booking flow,
admin visibility, and a stable public URL are what make the demo credible.
