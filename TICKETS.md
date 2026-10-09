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

- [x] **TICKET-035** — Revenue chart over time (admin dashboard)
  - Priority: P2 · Depends on: TICKET-023
  - Decisions (agreed before building):
    - **what:** confirmed revenue as solid columns with the **expected (pending)** revenue stacked on top in a lighter shade - same per-night rules as the stat cards, so the bars add up to the Revenue card
    - **buckets chosen automatically** from the period: by day up to 62 nights, by week (Monday start) up to 190, by month beyond; first/last bucket cut to the period's edges
    - **hand-built SVG** chart (no new npm package): tooltip + keyboard focus per bar, a "Today" line, a hidden data table for screen readers
    - data from **`GET /api/admin/stats/`** (a new `series` block, same query), not a new endpoint
    - not now (easy later): click a bar to zoom in; the comparison period as a faint second series
  - Plan: step 1 backend `series` · step 2 `<app-revenue-chart>` on the dashboard · step 3 README, Chrome check (local + Render), done.
  - Step 1 done (backend `series`):
    - `bookings/stats.py`: `series_granularity()` (62 / 190-night thresholds), `series_buckets()` (gap-free, Monday weeks, calendar months, edges cut), `revenue_series()` from the **same booking rows** as the totals (the query result is now a list, read twice - still 3 queries), `_split_rounded()`: rounds the running total so the buckets add up **exactly** to the Revenue card (per-bucket rounding would drift, e.g. 626.65 vs 626.67).
    - Each bucket: `from`, `to` (inclusive), `nights`, `revenue`, `pending_revenue`, `booked_nights`, `pending_nights` (nights over all properties incl. retired - the ones that earned the revenue). An empty period still returns every bucket with zeros.
    - 8 new tests (`AdminStatsSeriesTests`, hand-worked numbers: thresholds, daily sums = card, Monday weeks with a partial first week and a stay split over two weeks, partial months over 366 nights, a stay crossing the period's start, a full year = 12 months, empty period, the rounding helper); **400 backend tests** pass on Postgres, `makemigrations --check` clean. Seeded-data smoke test: bucket sums = card totals for this month / next 30 days / 13 months / 6 months, 3 queries each.
    - README: new "Admin stats API → Revenue over time: `series` (TICKET-035)"; status and next steps updated.
  - Step 2 done (the chart on `/admin/dashboard`):
    - `core/admin/revenue-chart.ts` - pure helpers: `niceTicks` (~5 round € steps), `compactEuro` (€1.5k), `bucketTitle` ("16 – 22 Nov 2026", "(partial week)"), `axisLabel` + `thinLabels` (month/year starts always labelled), `columnPath` (rounded top, square base), `todayPosition`, `buildChart` (whole layout for a width). `AdminStats.series` typed.
    - `pages/admin/dashboard/revenue-chart.*` - `<app-revenue-chart>` between the cards and the per-property table: stacked columns (confirmed `#005cbb` = app primary, expected `#7cabff` = same azure two steps lighter, 2 px gap), legend with both totals (= the Revenue card), Today line, tooltip beside the column + grey band, one Tab stop with ← → Home End Esc, per-column screen-reader labels + chart summary, **Chart / Table** toggle (Table with a Total row - the light blue is below 3:1, so values never depend on colour), empty state, skeleton while loading, forced-colors fallback. Palette checked with the dataviz validator (CVD ΔE 25).
    - Changes after looking at it in a headless Chromium (seeded data, demo admin, 1280/768/390/320 px): no dimming of the other columns (a dimmed dark column looked like "expected"); tooltip beside the column, not over it; **fit instead of scroll** on phones (a month by day and 12 months fit a 320 px phone; only a 40-62-day daily range scrolls, with a note) - the planned "scroll, starting at today" hid all of a month's revenue; edge x labels anchored inward (was clipped to "ept").
    - 22 new frontend tests (13 helpers, 8 component, 1 dashboard); **375 frontend tests** pass; production build clean, initial bundle unchanged (601 kB / 147 kB), dashboard chunk ~39 kB.
    - README: new "Admin dashboard → Revenue chart (TICKET-035)"; layout, admin routes, status and next steps updated.
  - Step 3 done (final check, 29 Sep, on `26bbaa6`, Chrome as the demo admin; nothing saved):
    - **Local** (Docker stack, no rebuild): chart between cards and table; all five presets + a custom Jul-Nov range (23 weeks, partial first/last week); legend = the cards for confirmed and expected on every preset; Today line only when today is inside; stacked 12-18 Oct column (€144 + €462) tooltip; click + → keyboard with focus ring; Table view with Total row = the cards; no page overflow.
    - **Render** (auto-deployed): this month €2,111 + €1,008, next month €4,803 + €4,093, last 12 months €5,212 + €1,008 - card = legend = sum of the columns' amounts each time; stacked 10 Oct tooltip (€315 + €232); keyboard 10 → 12 Oct; no console errors.
    - Note for re-runs: in a background Chrome tab, rendering (animation frames) pauses and scripted `.focus()` doesn't fire, so checks must use real clicks/keys.
    - README: new "Revenue chart: final check"; status and next steps updated.
  - **Done.** The admin dashboard shows "Revenue over time": confirmed revenue with the expected (pending) revenue stacked on top, by day / week / month picked from the period, adding up exactly to the Revenue card, with a Today line, tooltips beside the column, full keyboard use, a Chart / Table toggle, and a layout that fits phones. Hand-built SVG (no new package, initial bundle unchanged). Backend 400 tests, frontend 375 tests. Not done (easy later if wanted): click a column to zoom into it; the comparison period as a faint second series.

- [x] **TICKET-036** — Real photo uploads
  - Priority: P2 · Depends on: TICKET-006
  - Replaces the fallback of fixed stock photo URLs. ( i want to add my S3 aws bucket)
  - Decisions (agreed before building):
    - **browser → S3 directly**: Django only hands out a short-lived **presigned POST** (admin only; type jpeg/png/webp, size ≤ 10 MB, one random key under `property-images/`), so photos never pass through Render's 512 MB, sleeping free instance. Needs a CORS rule on the bucket.
    - **public-read prefix**: a bucket policy allows public `GET` on `property-images/*` only; the rest of the bucket stays private. `PropertyImage.image` stays a URL field holding the photo's permanent public URL, so the gallery, cards, map pop-ups and seeder don't change.
    - **resize in the browser** before upload: longest side ≤ 1600 px, WebP (JPEG where the browser can't encode WebP) - a 5-10 MB phone photo becomes ~200-400 KB.
    - the owner's bucket already exists; the IAM user (least privilege: `s3:PutObject` + `s3:DeleteObject` on `property-images/*` only), bucket CORS and bucket policy are documented in the README and set up by the owner; keys go in `.env` / the Render dashboard, never in the repo.
    - without the `AWS_*` settings uploads are simply off (same pattern as Stripe/Gmail): the Photos editor falls back to pasting URLs; pasting a URL stays available either way.
  - Plan: step 1 backend presign endpoint (+ config, checks, tests) · step 2 upload in the Photos editor (drag & drop, resize, progress) · step 3 delete removed photos from S3 (own prefix only), `render.yaml`, README AWS setup, Chrome check (local + Render), done.
  - Step 1 done (`a736bee`): new `uploads` app (no models). `GET /api/admin/uploads/config/` (enabled, max bytes, types) and `POST /api/admin/uploads/presign/` {content_type, size} → a 5-minute presigned POST for one new random key `property-images/YYYY/MM/<32 hex>.<ext>`; the policy pins bucket, key, type (JPEG/PNG/WebP only - no SVG), `Cache-Control` and `content-length-range` 1 B-10 MB (`UPLOADS_MAX_BYTES`). Regional endpoint (`<bucket>.s3.<region>.amazonaws.com`) so a new bucket never redirects the browser's POST. `503 uploads_disabled` without all four `AWS_*` settings, `503 uploads_unavailable` if signing fails (details only in the log); 120/min per admin. Startup checks `uploads.W001` (half-configured), `E001` (non-https public base URL), `E002`. `boto3` added (Docker: rebuild the backend image once). Migration 0005 only updates the photo field's help text.
    - 24 new tests (real boto3 signing with fake keys - no network; the policy is decoded and checked); **424 backend tests** pass on Postgres.
    - README: new "Photo uploads API (TICKET-036)"; layout, data model, env vars, `.env.example`, status and next steps updated.
  - Step 2 done (`7b771a1`): the admin Photos card gets a drop zone - "Drag photos here, or **Upload photos**" - only when `GET /api/admin/uploads/config/` says enabled (otherwise it looks as before); "Or paste a photo URL" stays.
    - `ImageResizer` (`core/admin/image-resize.ts`): `createImageBitmap` with EXIF orientation → canvas ≤ 1600 px → WebP 0.82 (JPEG + white background where WebP can't be encoded); always re-encoded, so camera EXIF/GPS never reaches the public URL; > 40 MB originals refused.
    - `PhotoUploadService`: resize → presign (resized type/size) → multipart POST to S3 (signed fields, `file` last, `reportProgress`, no JWT - the interceptor only touches our API) → public URL joins the list (first = cover). S3's XML error codes mapped to readable messages (too large, expired, access denied, CORS/network).
    - Rows per photo: Waiting… / Preparing… / Uploading 40% with a progress bar; at most 2 in parallel; Cancel aborts; failed rows keep the message with Try again / Dismiss; non-images skipped with a message.
    - The editor is also a **validator** (`uploading`), so the form can't be saved mid-upload ("Wait for the photo uploads to finish, then save."); a failed photo doesn't block saving.
    - 28 new tests (4 resize maths, 11 service incl. form field order / no Authorization / abort, 13 editor incl. a real reactive form); **403 frontend tests** pass; production build clean, initial bundle unchanged (601 kB / 147 kB).
    - README: new "Admin properties → Photo uploads (TICKET-036 step 2)"; layout, status and next steps updated.
  - Step 3 code done (`c6d8358`):
    - `uploads/signals.py`: `post_delete` on `PropertyImage` (form replacing the photo set, Django Admin row or property delete) → after commit, delete the S3 object only if it's **our own upload** (`key_from_url`: exact `property-images/YYYY/MM/<32 hex>.<ext>` under the configured base; pasted/stock/other-bucket URLs never touched) and **no row still uses the URL** (kept photos are re-created in the same transaction; a URL shared with another property stays). Rolled-back saves delete nothing; retiring keeps photos; failures only logged (3 s/5 s timeouts, 2 attempts).
    - Not covered on purpose: photos uploaded in a form that's then discarded stay unused in the bucket (a clean-up would need `s3:ListBucket`).
    - `render.yaml`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_S3_REGION` (`sync: false` - add by hand on the existing service).
    - README: new "Photo uploads: setting up S3" (region, Block Public Access policy options, public-read bucket policy for `property-images/*`, CORS for localhost:4200 + the Render site, inline IAM policy `s3:PutObject` + `s3:DeleteObject` on `property-images/*` only, access key, `.env`, Render, troubleshooting table); "Removed photos are deleted from S3"; status and next steps.
    - 12 new tests (S3 client mocked); **436 backend tests** pass on Postgres.
  - AWS setup (29 Sep, guided in Chrome; the owner made every security change and handled the keys himself): new dedicated bucket **`booking-demo-photos-paraskevas`** (eu-central-1) - Block Public Access: ACL options on, policy options off; bucket policy public `GetObject` on `property-images/*` only; CORS `POST` from localhost:4200 + the Render site; IAM user `booking-demo-uploads` (no console) with inline policy `booking-demo-photos-upload-delete` (`PutObject` + `DeleteObject` on `property-images/*`); keys in `.env` and Render.
  - Final check (29 Sep, Chrome as the demo admin):
    - **Local:** config `enabled: true`; a 4000×3000 JPEG (961 KB) → **1600×1200 WebP, 74.5 KB** in `property-images/2026/09/`, thumbnail from the public URL; save → shown on the property page; remove + save → object deleted (bucket empty); anonymous bucket listing → `AccessDenied`.
    - **Render:** config `enabled: true`; a portrait 3024×4032 JPEG (858 KB) → 1200×1600 WebP, 65.7 KB (orientation kept); save → public property page shows it; remove + save → deleted from S3.
    - Both test photos removed again, so both properties have their original photos.
    - Changed after looking at it: the red "Wait for the photo uploads to finish, then save." showed as soon as an upload started - adding files no longer marks the control touched, so it only shows if Save is pressed mid-upload (+1 assertion; 403 frontend tests pass).
    - Note for re-runs: a background Chrome tab throttles the upload until it's in front again.
    - README: new "Photo uploads: final check"; status and next steps updated.
  - **Done.** Admins upload property photos straight to the owner's S3 bucket (drag & drop or Upload photos): resized in the browser to ≤ 1600 px WebP with EXIF/GPS stripped, presigned by the API (5 min, one key, type + size pinned), with progress, cancel/retry and no saving mid-upload; photos removed from a saved property are deleted from S3 (own uploads only, after commit, only when unused). Pasting URLs still works, and without the `AWS_*` settings the app behaves exactly as before. Backend 436 tests, frontend 403 tests. Not done (on purpose): cleaning up photos uploaded in a form that was then discarded (would need `s3:ListBucket`).

- [x] **TICKET-042** — Shorter "Placed at …" labels in the admin Find on map
  - Priority: P2 · Depends on: TICKET-034 · Small; can be folded into TICKET-037 (UI polish pass)
  - Requested after TICKET-034: the label is Nominatim's full address line, e.g. "Ιωάννη Τσιμισκή, Ladadika, 1st District of Thessaloniki, Thessaloniki Municipal Unit, Municipality of Thessaloniki, … , 546 23, Greece" - too long to read at a glance.
  - Show a short form, e.g. the first 2-3 parts + the town ("Ιωάννη Τσιμισκή, Ladadika, Thessaloniki"), with the full line available (title/tooltip). Decide when the ticket starts: shorten on the backend (`listings/geocoding.py`, e.g. a `short_label` built from Nominatim's `addressdetails`) or in the frontend (`location-picker.ts`).
  - Out of scope (owner's decision): matching English tourist names Nominatim doesn't know - typing a real address is the admin's job; click/drag the pin otherwise.
  - Tests for the shortening (street / house number / town-only / no town) + update the README's "Admin properties → Map position".
  - **Done inside TICKET-037 (step 5)** - see there.

---

## Epic 8 — Final polish (last day before the meetup)

- [x] **TICKET-037** — UI polish pass + refresh seed data
  - Priority: P0 · Depends on: Epic 3 & 4 complete
  - Seed data must include **enough reviews** to show the TICKET-032 Reviews section well (requested during TICKET-032: the current seeder only produced 3 reviews in total). E.g. more past *confirmed* stays so most properties get several reviews, with a mix of ratings and some without a comment - every review still backed by a real ended, confirmed booking (the rule the API enforces).
  - **Seed photos from the owner's S3 bucket** (requested after TICKET-036), instead of `picsum.photos` URLs:
    - a fixed set of free-licensed photos (Unsplash / Pexels licence) stored once under a **simple, fixed folder `property-images/seed/`** with readable names, e.g. `property-images/seed/villa-01.webp`, `…/studio-03.webp` - no `YYYY/MM/<random>` path. Inside `property-images/`, so the bucket policy already makes them public and the IAM user can already write there: no AWS change.
    - the seeder builds `https://<bucket>.s3.<region>.amazonaws.com/property-images/seed/<name>.webp` (via `uploads.s3.public_url()`), picking photos that match the property type; **falls back to picsum** when the `AWS_*` settings aren't set (fresh clones, tests).
    - safe with TICKET-036's clean-up: `key_from_url()` only matches uploaded keys (`YYYY/MM/<32 hex>`), so a seed photo shared by several properties is **never deleted** when an admin removes it from one (add a test for that).
    - getting them into the bucket, to decide when the ticket starts: a small `manage.py upload_seed_photos` (uploads a repo folder of pre-resized WebPs with the existing keys, skips ones already there) vs uploading them once by hand in the S3 console.
    - Render: the hosted database keeps its picsum URLs until the one-off re-seed planned in TICKET-041.
  - Decisions (agreed before building):
    - **photos:** picked by Claude on Unsplash in the owner's Chrome (Unsplash License, no Unsplash+), resized in the browser to 1280 px WebP (quality 75, no EXIF) and **kept in the repo** at `backend/core/seed_photos/` with a `CREDITS.md`.
    - **getting them into the bucket:** a new `manage.py upload_seed_photos` (existing keys, `property-images/seed/<name>.webp`, skips files already there via a public HEAD - no `s3:ListBucket` needed; `--force` re-uploads). Run once by the owner (Claude's shells can't reach S3).
    - **reviews:** 4-8 per property from extra ended, confirmed stays over the last 12 months (distinct guests, no overlaps); positive-skewed ratings with some 2-3★, ~25% without a comment, ~30 comment texts.
    - **UI polish:** TICKET-042 (shorter "Placed at …" labels) is folded in; shortened on the **backend** (`short_label` from Nominatim's `addressdetails`, fallback to the first parts of the full line), full line as a tooltip.
  - Plan: step 1 pick the photos · step 2 `upload_seed_photos` · step 3 seeder uses the S3 seed photos by property type (picsum fallback) · step 4 more reviews · step 5 TICKET-042 short labels · step 6 re-seed + Chrome check, README, done.
  - Step 1 done: 36 photos (3 MB) in `backend/core/seed_photos/` - villa ×4, house ×4, cottage ×3, penthouse ×3, view ×2 (exteriors/terraces, used as covers) and apartment ×4, studio ×3, loft ×3, bedroom ×4, kitchen ×3, bathroom ×3 (interiors). Greek-island look for the exteriors (white houses, blue doors, stone cottages, sea-view pools). Picked from Unsplash's own search in Chrome, reviewed on contact sheets, downloaded as one `.tar`; `CREDITS.md` lists photographer + link per file.
  - Step 2 code done: new `uploads/seed.py` (`seed_files()`, `seed_url()` → `property-images/seed/<name>.webp`, `remote_size()` via an anonymous public `HEAD` - 403/404 = missing, so no `s3:ListBucket`; `upload()` with `put_object`, `image/webp`, `Cache-Control: public, max-age=604800` since a seed name can be reused) and `manage.py upload_seed_photos` (`--dry-run`, `--force`, `--source`): new/changed photos uploaded, same-size ones skipped, a failed check uploads anyway, one failure doesn't stop the rest and ends in a `CommandError`, refuses when the `AWS_*` settings are off. 21 new tests in `uploads/tests_seed.py` incl. the ticket's "shared seed photo is never deleted" rule; **457 backend tests pass on Postgres**. README: new "Seed photos in S3 (TICKET-037)" section + layout. Owner ran it (29 Sep): **uploaded 36 of 36**; checked in Chrome that all 36 public URLs answer `200 image/webp` with `Cache-Control: public, max-age=604800`, and an anonymous bucket listing is still `403`.
  - Step 3 done: `seed_demo_data` uses the S3 seed photos when the `AWS_*` settings are set (picsum fallback otherwise, e.g. tests/fresh clones). `PHOTO_GROUPS` maps each title noun to a cover group (Villa → `villa-*`, Loft → `loft-*`, Room → bedroom/studio, …) and 2-4 extra groups (bedroom, view, kitchen, bathroom …); least-used picking spreads the photos (14 properties: 14 different covers, most-used photo 5×, never the same photo twice in one property). 3-5 photos per property (was 2-5). The output ends with `Photos: S3 seed photos (…)` / `Photos: picsum.photos (…)`. 3 new tests in `core/tests.py` (type-matched covers + valid names, covers spread, picsum fallback); **460 backend tests pass on Postgres**. README "Seeding demo data → Images" rewritten.
  - Step 4 done: `_create_past_stays` adds confirmed stays that ended in the last 12 months (distinct guests, free dates via `overlapping()`, 2-7 nights, "booked on" 1-8 weeks earlier) until 4-8 guests have an ended stay per property; `_create_reviews` reviews each (guest, property) once, dated 0-6 days after the stay, ratings as before, **~25% without a comment**, 30 comment texts (was 11). Addition (my call, easy to drop): every guest also keeps **one recent ended stay without a review** so "Leave a review" / "Write a review" can be shown live at the meetup; the retired place (Saved page) is now chosen right after the properties (`_ensure_one_retired`) so that stay is never on a retired place. The command now prints the review count. Default seed: **77 reviews, 4-8 per property**, every rating 1-5 present. 5 new tests in `core/tests.py` (4-10 per property, each backed by an ended confirmed stay and dated after it, rating/comment mix, one reviewable stay per guest, no overlaps), checked with 6 different `--seed` values; **465 backend tests pass on Postgres**. README "Seeding demo data" updated.
  - Step 5 done (TICKET-042 folded in): `listings/geocoding.py` asks Nominatim for `addressdetails=1` and every result gets a `short_label` - `[own name,] street [number,] [neighbourhood,] town` (+ region for a lone town or no town), most specific town first, Greek admin wrappers dropped ("Thessaloniki Municipal Unit" → Thessaloniki), unhelpful areas skipped ("1st District of …", the metropolitan-area suburb), fallback to the first 3 parts of the full line; cache key → `geocode:v2`. Rules built from real Nominatim answers (fetched in Chrome). Frontend: "Placed at **short label**", full line as the `title` tooltip, full line if no short label. Tests: 8 `ShortLabelTests`, 1 new API test + an `addressdetails` assertion (street / house number / named place / quarter / town-only / no town / broad area / fallback); 1 new + 1 updated frontend test. **474 backend + 404 frontend tests pass**, production build clean. Checked live in Chrome (admin New property, not saved): "Tsimiski, Thessaloniki" → "Placed at Ιωάννη Τσιμισκή, Ladadika, Thessaloniki (street)" with the full line on hover; "Kardamyli" → "Kardamyli, Messenia"; "Egnatia 100, Thessaloniki" → "Εγνατία 100, Thessaloniki (exact address)". README: "Admin place search API" (`short_label` table) and "Map position".
  - Step 6 done (final check, 29 Sep): owner ran `seed_demo_data --clear` locally → 14 properties, 10 guests, **82 reviews**, 38 favorites, "Photos: S3 seed photos". Checked in Chrome: listings cards with the seed photos and ratings; a property page (4-photo gallery, 4.7 from 6 reviews, stars-only reviews, Show more); admin Reviews (82) and Bookings Past ("booked" dates before the stays); as guest `guest_0_…` My bookings → Past shows "You rated this place" and **Leave a review** on the one unreviewed stay (dialog opened, not posted); 390 px phone width for listings, property page and My bookings - no sideways scroll; Find on map short labels. README: "Demo data: final check (TICKET-037)", status and next steps.
  - **Done.** Demo data now looks real: 36 free-licensed Unsplash photos (in the repo + the owner's bucket at `property-images/seed/`, uploaded with `manage.py upload_seed_photos`, never deleted by the app) matched to each property type, and 4-8 reviews per property backed by ended, confirmed stays (~25% stars only, dated after the stay), plus one unreviewed recent stay per guest for a live review demo. TICKET-042's short "Placed at …" labels folded in. Backend 474 tests, frontend 404 tests. The Render database keeps its picsum photos/old reviews until TICKET-041's one-off re-seed.

- [x] **TICKET-041** — Simple demo logins in the seeder (admin + guests)
  - Priority: P0 · Depends on: TICKET-026 · Do before TICKET-039 (requested after TICKET-026)
  - Goal: logins that are easy to type at the meetup table, for both roles, e.g. `admin@demo.com` / `admin123` and `guest1@demo.com` … `guest10@demo.com` / `guest123` (exact values to agree when the ticket starts).
  - Seeder (`seed_demo_data`): fixed, numbered guest emails instead of Faker usernames (Faker still provides the first/last names); one shared guest password; simple admin email/password. Keep them as constants in one place so the README and the login page hint can't drift.
  - Simple passwords are fine here: the seeder uses `set_password()`, which skips Django's password validators. Registration still enforces them for real sign-ups.
  - `--clear` must also remove the old-style `guest_*@example.com` / `admin_demo` accounts, so re-seeding doesn't leave both sets behind.
  - **Hosted copy (Render):** `--if-empty` won't re-seed a database that already has data, so plan a one-off re-seed there. There's no shell on the free plan, so e.g. a temporary env var (`SEED_DEMO_DATA=reset`) that makes `build.sh` run `seed_demo_data --clear` once, removed right after that deploy.
  - Optional: a small "Demo logins" hint on the login page (or the README only), so visitors know which accounts exist.
  - Update the README (Seeding demo data, Deploying to Render → logins) and the tests for `--clear` / `--if-empty`.
  - **Decisions (agreed 29 Sep):**
    - Logins: **`admin@demo.com` / `admin123`** (Django Admin username `admin`) and **`guest1@demo.com` … `guest10@demo.com` / `guest123`**, constants in `backend/core/demo_accounts.py`.
    - **Emails not special-cased** - production behaviour: a demo guest's booking emails go to its own address (demo.com is a real domain; accepted, one-line change in `DEMO_EMAIL_DOMAIN` if needed). Visitors who want to see the emails sign up with their own address. The admin's mail keeps going to `BOOKING_ALERT_EMAILS`.
    - Login page: a **"Demo logins" box with one-click fill** (Guest / Admin), values from a small public API endpoint that lists only the demo accounts that exist.
    - Render: a **self-limiting one-off re-seed** - `build.sh` re-seeds (`--clear`) only while old-style demo accounts exist, then acts like `--if-empty`; no env var to remember to remove. Accepted: it also deletes the bookings made by hand on Render.
  - Plan: (1) seeder + `--clear` + tests; (2) `--replace-old-demo` + `build.sh`; (3) `GET /api/auth/demo-logins/`; (4) login page box; (5) README/TICKETS, local re-seed, Chrome check, push, hosted check.
  - **Step 1 done.** `core/demo_accounts.py` holds the values and the helpers that find demo accounts: `demo_guest_users()` (username and email both `guest<N>@demo.com`), `demo_admin_users()` (username `admin` **and** email `admin@demo.com`, so an owner's own superuser called `admin` is never touched) and `legacy_demo_users()` (`admin_demo`, `guest_*@example.com`). The seeder creates the numbered guests (username = email, Faker names, `set_password()`), reuses existing ones on a re-run without `--clear`, creates the admin unless it exists (or warns if another account is called `admin`), and prints both logins at the end. `--clear` removes the current and the old-style demo accounts. 6 new tests (logins through the API and Django Admin, re-run, `--clear` with old-style + real accounts, owner's `admin` untouched); existing seeder tests switched to the helpers. **Backend 480 tests pass.** README: new "Demo logins" part in "Seeding demo data", auth/curl examples updated.
  - **Step 2 done.** New flag `seed_demo_data --replace-old-demo`: while old-style demo accounts exist it re-seeds as if `--clear` were given (even with `--if-empty`), otherwise it changes nothing. `build.sh` now runs `seed_demo_data --if-empty --replace-old-demo` (with `SEED_DEMO_DATA=true`, unchanged on Render), so the first deploy after this push replaces the hosted demo data once and every later deploy skips again - nothing to switch back. Simulated: a database seeded by the old seeder (`05f5cdf`) → build command twice → replaced, then skipped. Noted in the README: the re-seed also deletes the Render bookings/Stripe test payments and removes admin-uploaded photos from S3 (seed photos stay). 4 new tests; **backend 484 tests pass.** README "Deploying to Render" (new "One-off re-seed for the new demo logins", env table, hosted logins) and the seeder options table updated.
    - **Render, deploy of `a301bb9`:** the one-off re-seed ran - `/api/properties/` shows new ids 15-28 (14 seeded, 11 active), S3 seed photos instead of picsum, 4-5 reviews each; health OK. (Checked from Chrome - the session's shells can't reach onrender.com. Logging in on the hosted site with the new accounts is left to the owner.)
  - **Step 3 done.** `GET /api/auth/demo-logins/` (public, `authentication_classes = []` like login) → `{"logins": [{role: "guest", email: "guest1@demo.com", password, count, last_email}, {role: "admin", email, password}]}`, built by `core/demo_accounts.py:demo_logins()`. Lists only accounts that exist, are active and still have the seeded password (the admin must also still be an app admin), so a real deployment returns `[]` and changing the demo admin's password in Django Admin hides it. `check_password()` results are cached per account + stored hash (first call ~0.75 s, then ~5 ms; a changed password is a new key). 8 new tests; **backend 492 tests pass.** README: auth endpoint table + "Demo logins".
    - **Render, deploy of `e0f5ecc`:** `/api/auth/demo-logins/` returns guest1…guest10@demo.com / guest123 and admin@demo.com / admin123 - so on the hosted copy the new accounts exist, are active and the server itself confirmed both passwords (and the admin is an app admin). Property ids still 15-28 after two more deploys: the one-off re-seed didn't fire again.
  - **Step 4 done.** Login page "Demo logins" box under the form: a **Guest** / **Admin** button per listed login + email / password ("any up to guest10@demo.com" for guests); a click fills the form (no auto-submit), clears an old error. `AuthService.demoLogins()` maps any failure to `[]` (no box, never an error); `demo-logins/` added to the interceptor's public endpoints (no token, no refresh). `DemoLogin` model; `.demo-logins` styles in `auth-page.scss`. 10 new Vitest tests (7 login page, 3 service); the existing login tests now answer the page's demo-logins request. **Frontend 414 tests pass**, production build OK (no new warnings). Local backend already serves the endpoint (`{"logins": []}` until the local re-seed in step 5).
    - **Render, deploy of `3c6dcbe` (Chrome):** the hosted login page shows the box (Guest: guest1@demo.com / guest123, "any up to guest10@demo.com"; Admin: admin@demo.com / admin123); Guest and Admin each replace what Chrome had autofilled with the right values (checked in the DOM, not submitted). Card narrowed to phone widths (343 px and 288 px, i.e. 375/320 px screens): the logins wrap under their buttons, no overflow. Side effect seen: a browser still holding a session of a re-seeded-away account (`admin_demo`) is logged out by the app on its own ("Your session expired") once the API answers.
  - **Step 5 done - final check (29 Sep).** Local re-seed by the owner (`seed_demo_data --clear`: 14 properties, 10 guests, 83 reviews, 43 favorites, S3 seed photos, both logins printed). Chrome, local: the old `guest_*` session ended by itself; the box → **Guest** + Log in → guest1@demo.com with upcoming/pending bookings, 1 "Leave a review" + 6 rated stays (Past), Saved page with the retired place; **Admin** + Log in → admin dashboard with the new data; Django Admin accepted `admin` / `admin123`. Labels float correctly after a fill (a zoom right after the click caught the animation mid-way). README: "Demo day" checklist (TICKET-041 ticked, login hint), status paragraph, "Demo logins → Final check".
  - **Done.** Easy demo logins for the meetup table - `admin@demo.com` / `admin123` (Django Admin: `admin`) and `guest1@demo.com` … `guest10@demo.com` / `guest123` - in one constants module; `--clear` removes old and new demo accounts (never real ones, never an owner's own `admin`); the hosted copy re-seeded itself once (`--replace-old-demo`) with no Render setting to change; `GET /api/auth/demo-logins/` (only accounts that exist and still have the seeded password) feeds a login page box that fills the form in one click. Emails not special-cased. Backend 492 tests, frontend 414 tests.

- [x] **TICKET-038** — Two-language support (English / Greek)
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
  - Decisions (agreed before building):
    - **own service + `t` pipe** (the approach above), no `ngx-translate`
    - **first visit: always English** (not the browser's language); the switch's choice remembered per browser
    - **the whole Angular app**, admin pages included
    - **server messages through Django i18n on the backend**: the frontend sends `Accept-Language`, `LocaleMiddleware` picks it up, Django/DRF built-in messages come in Greek for free, ours are wrapped in `gettext` with an `el` `.po` (compiled `.mo` committed - Render's build has no gettext). This replaces "the backend stays English-only" above. Messages the frontend writes itself are still picked by the API's error `code`.
    - out of scope: property titles/descriptions, Django Admin, the booking emails (stay English)
  - Plan: step 1 foundation (dictionaries, `TranslationService`, `t` pipe, EN / ΕΛ switch, tab titles, Material texts, `Accept-Language`) · step 2 dates and money per locale · step 3 guest pages part 1 (toolbar, footer, wake notice, listings, cards, map pop-ups, property page, booking form, login, register, forbidden, install dialog) · step 4 guest pages part 2 (My bookings, dialogs, Saved, payment return/labels/countdown, booking summary, frontend error texts + messages by API `code`) · step 5 admin pages · step 6 backend in Greek (Django i18n) · step 7 Stripe Checkout `locale` from the request's language · step 8 final check in both languages, local + Render.
  - Step 1 done: `frontend/src/app/core/i18n/` - `en.json` / `el.json` (same nested keys; `{placeholders}`; plurals via `Intl.PluralRules`), `TranslationService` (`lang` signal, `locale()` en-GB / el-GR, `setLang` remembers in `localStorage` `bsd.lang` + sets `<html lang>`, `t()` falls back to English then the key), the impure cached `t` pipe, `PageTitle` (a `TitleStrategy`: route titles are keys, pages can `set()` their own, rebuilt on a switch), `languageInterceptor` (`Accept-Language` to our API only, before the auth interceptor). The toolbar has the **EN / ΕΛ** pill (always visible, phones too) and is translated. Material's paginator / date picker / stepper texts and a date adapter that follows the language (Greek month/day names, Monday first) are provided **per page** - at the root they pulled ~320 kB of Material into the initial bundle (601 → 933 kB); per page the initial bundle is 610 kB.
    - 29 new tests (**443 frontend tests** pass): dictionary parity (keys, placeholders, no empty texts, plural `other`), the service, the pipe (an OnPush page follows a switch without a reload), the interceptor, Material texts (a rendered paginator redraws in Greek), the date adapter, tab titles, the toolbar switch. Production build clean.
    - Checked in a browser (desktop + 390 px): ΕΛ switches the toolbar, tab title and `<html lang>` at once, and is remembered after reopening.
    - README: new "Two languages (English / Greek, TICKET-038)"; status, layout and next steps updated.
  - Step 2 done: dates and money follow the language. `core/i18n/locale.ts` holds the language as a module-level signal (`TranslationService` owns it; resets to English when a TestBed is torn down), so plain helpers can read it and any template / `computed()` using them follows a switch. `core/i18n/format.ts`: `formatDate(value, style)` (full "Τετ 10 Μαρ 2027", medium, dayMonth, weekdayDayMonth, monthYear, month (genitive in Greek), monthShort, day, time - 24-hour in Greek too), `formatTime`, `formatNumber`, `formatPercent`; cached formatters; `YYYY-MM-DD` read as local dates. `formatPrice`: en-IE "€1,234.50" (unchanged) / el-GR "1.234,50 €". Replaced every fixed `'en-GB'` / `toFixed` for display: booking form, summary, My bookings + cancel dialog, payment labels + countdown, booking policy deadline, property page ratings + calendar month titles + review months, cards + map pop-ups, admin bookings / reviews / properties, dashboard (ranges, "vs <month>", %, pts, breakdown) and the revenue chart (axis "1,5k €", bucket titles). Coordinates and the API price keep a dot. Words around the values are translated with the pages (steps 3-5).
    - 10 new tests (**453 frontend tests** pass; the 443 existing ones unchanged, so English output is identical); production build clean (initial 610 kB).
    - README: new "Two languages → Dates and money (step 2)"; status, layout and next steps updated.
  - Step 3 done: the guest pages in Greek - footer + wake notice; listings (search, sort, counts with Greek plural/adjective agreement, empty/error states, map notes, marker titles, cluster bubbles, Leaflet zoom titles re-set on a switch); cards + map pop-ups (sleeps, per night, stay total, New, heart, amenity names - custom amenities stay as typed); property page (headings, gallery + lightbox, calendar, booking panel, location, reviews section, mobile bar, tab title via `PageTitle`); booking form (both steps, cancellation + payment policies, confirmation, booking summary, tab titles); login, register, forbidden, iPhone install dialog. New `translate()` (the service's `t` as a plain function) for texts built outside templates (stay rules, amenities, snackbars, map). Sentences with bold parts keep `<strong>` in both dictionaries and use `[innerHTML]` (only with app-formatted params); a spec checks the tags match. `npm run check:i18n` finds every literal key use (287) in en.json. Server messages stay English until step 6.
    - 7 new tests (**460 frontend tests** pass): Greek listings, booking step 2 (bold deadline + amount), login + demo box, stay rules / amenities / clusters / plurals, tag parity; specs clear `localStorage` so a chosen language can't leak; the map pop-up spec no longer depends on a session left by another spec (one intermittent failure seen).
    - Checked in headless Chromium (production build, mocked API, Greek): listings, property page, booking step 2, login at 1280 and 390 px - no sideways scroll, no console errors, Greek tab titles. Initial bundle 636 kB (+26 kB for the dictionaries; lazy-loading `el.json` if steps 4-5 push it near 700 kB).
    - README: new "Two languages → Guest pages (step 3)"; status and next steps updated.
  - Step 4 done: My bookings (tabs, status chips, every payment line incl. the countdown and Pay now, refund lines, cancel rules, Leave a review, snackbars), the cancel dialog, the review dialog (star options "4 αστέρια - Καλή"), the Saved page (count, empty state, Removed … Undo), the payment return page (every state + tab titles via `PageTitle`), payment chips + refund texts (`payment-labels.ts`, shared with admin), the app's own error messages (`api-errors.ts`), the confirm dialog's default Cancel. Not built: a frontend table keyed by the API's error `code` - the agreed Django i18n (step 6) makes the server's own messages Greek.
    - Fixed along the way: spaces lost between two elements (`&ngsp;`: "Κωδικός #77 · Επιβεβαιωμένη", "182 € · #77"); the three My bookings tabs didn't fit a 390 px phone in Greek (narrower tabs on phones); a global test setup (`src/test-setup.ts` via `setupFiles`) clears the saved language before every test, so a failing Greek test can't leave other spec files in Greek (seen once: 3 unrelated failures).
    - 6 new tests (**466 frontend tests** pass); `check:i18n` 396 key uses. Checked in headless Chromium (production build, mocked API, Greek): My bookings (3 tabs + cancel dialog), Saved, payment return at 1280 and 390 px - no sideways scroll, no console errors. Initial bundle 651 kB.
    - README: new "Two languages → Guest pages, part 2 (step 4)"; status and next steps updated.
  - Step 5 done: the admin area in Greek - side nav/phone tabs + badge label; dashboard (presets, custom range, range line, "έναντι Αυγούστου" comparisons, cards incl. "μον." points, per-property table, the revenue chart with its legend/axis/Today/tooltip/partial buckets/Table view and all screen-reader labels); bookings (tabs, filters, columns + phone-card `data-label`s, chips, Confirm/Cancel/Refund dialogs, refund outcome snackbars); properties list (filters, columns, saved-by, menu, Retire dialog); the property form (labels, validation + save errors, tab titles, amenities picker, photos editor incl. every upload/S3 error, map position incl. precision words); reviews (filters, chips, Hide/Show, dialogs); the unsaved-changes guard. OpenStreetMap place names stay plain text (never `[innerHTML]`). Narrower tabs on phones for admin bookings too.
    - **Greek is now a lazy chunk:** the admin texts took the initial bundle to 683 kB (close to the 700 kB warning). English stays bundled (default + fallback); `el.json` is loaded on the first switch (prefetched on pointer/focus of ΕΛ) or, for a saved Greek choice, by the app initializer before the first render (no English flash); offline -> stays English; the latest click wins. Initial bundle **635 kB**, Greek chunk 49 kB (11 kB gz). `setLang()` returns a promise (instant when loaded); `src/test-setup.ts` preloads Greek for the specs.
    - 9 new tests (**475 frontend tests** pass; all existing admin tests unchanged in English): dashboard (`buildCards` + page), admin bookings (+ confirm dialog), properties list, property form messages, admin reviews, 3 lazy-loading tests. `check:i18n` 734 key uses. Checked in headless Chromium (production build, mocked API, Greek saved): dashboard, bookings, properties, new-property form, reviews at 1280 and 390 px - Greek on first render, no sideways scroll, no console errors; a fresh visit's ΕΛ click loaded the Greek chunk and switched.
    - README: new "Two languages → Admin pages (step 5)" and "Greek loads only when it's needed"; status and next steps updated.
  - Step 6 done: the API's own messages in Greek via Django i18n. `core/middleware.py` `ApiLanguageMiddleware` (after sessions): for `/api/` the `Accept-Language` header picks `el` / `en` (browser-style headers and q-order handled; anything else English), `Content-Language` + `Vary: Accept-Language` on API answers; everything else (Django Admin) always English - chosen over Django's `LocaleMiddleware`, which would translate the Admin, can redirect and reads a cookie. Settings: `LANGUAGE_CODE='en'`, `LANGUAGES` en/el, `LOCALE_PATHS`.
    - Every user-facing API message wrapped in `gettext` / `gettext_lazy` with the **English text unchanged** (existing tests untouched): accounts (duplicate email, admin-only permissions), bookings (create validation, clash 409s, status changes incl. the 48 h cancel rule, refund-by-admin, stats period), listings (search filters, map position, cover image, geocode 503s), reviews, uploads, payments (all `CheckoutError`s, "Refund now" refusals). f-strings -> `%(name)s`; "sleeps at most N guest(s)" via `ngettext` (English "1 guest" now, was "1 guests"); statuses inside sentences as words (`status_word()`, context "booking status").
    - Catalog `backend/locale/el/LC_MESSAGES/django.po` (67 texts) + compiled `django.mo`, **committed** (Render's build has no gettext); `gettext` added to the backend Dockerfile for editing. Django/DRF Greek used as shipped; gaps from our catalog, listed in `accounts/library_messages.py` so `makemessages` keeps them: simplejwt (no Greek at all: failed login, token messages) and Django 5.2's reworded "password too short".
    - Stay English: booking emails (`build_message()` under `translation.override("en")`), Django Admin, stored refund failure reasons, `Model.clean()` (Admin-only), commands/logs. Frontend unchanged (it shows whatever the server sends; its English-only `check_in` rewording never matches Greek).
    - 16 new tests (`core/test_i18n.py`, **508 backend tests** pass on Postgres): header parsing; headers on answers; the 409 in Greek and unchanged English; numbers and plurals; status words; Django password rules + DRF "required" in Greek; duplicate email; failed login (simplejwt); permission message; no leak into the next request; a Greek request's booking email is English; `build_message()` same under Greek; Admin login page English; the committed `.mo` matches the `.po` (fails if `compilemessages` was forgotten). `makemigrations --check`: no changes.
    - README: new "Two languages → Server messages in Greek (step 6)" (how it works, what stays English, how to add a text); backend layout, status and next steps updated.
  - Step 7 done: Stripe Checkout in the app's language. Owner's decisions: "Pay now" keeps the page's original language (no new session on a switch); the line item is Greek too (title/location as typed; Dashboard "Booking #N" stays English).
    - `payments/services.py`: `checkout_language()` (request language -> `el` / `en`), `locale` on the session (was unset = browser's language), `line_item_text()` with `ngettext` ("Loft - 3 νύχτες", "Τετ 10 Μαρ 2027 έως Σάβ 13 Μαρ 2027, 2 άτομα, Thessaloniki"; Greek dates via `stay_date()` with the app's Intl el-GR names, not Django's "Μάρ"); English text unchanged. Language in the idempotency key (`booking-<id>-checkout-<n>` for English as before, `...-el` for Greek) so the request stays fully fixed by its key. 2 new plurals in the `.po`. Stripe docs checked: `el` and `en` are valid Checkout locales.
    - 8 new tests (`CheckoutLanguageTests`, **516 backend tests** pass on Postgres) + the exact-request test now checks `locale: "en"` and the full English description. README: new "Two languages → Stripe's payment page (step 7)", CHK-09 in the payments test table, phase 1 note on the key, status and next steps. A real Stripe page is checked in step 8.
  - Step 8 done - final check (29 Sep), Chrome. **Local:** ΕΛ + wrong password -> Greek server message; guest booking flow in Greek; Stripe page in Greek ("Modern Retreat in Athens - 3 νύχτες", "192,00 €", Greek dates, "2 άτομα", Κάρτα/Πληρωμή); back -> Greek "payment not completed"; switch to EN + Pay now -> the same Greek page (agreed); a new English booking -> English Stripe page with "1 guest"; "already cancelled" in Greek. **Render** (auto-deployed `bf3aa42`): first visit English; ΕΛ loads the Greek chunk; wrong login / taken email in Greek with `Content-Language: el`; Django Admin English with `Accept-Language: el`; admin dashboard in Greek; an admin booking (emails to the owner's inbox) -> Stripe page in Greek ("Quiet Villa in Heraklion - 3 νύχτες", "531,00 €"); no console errors. All test bookings cancelled; the browser's saved language and sessions cleared afterwards. README: "Two languages → Final check", status, Demo day checklist (TICKET-038 ticked). **TICKET-038 done.**

- [x] **TICKET-044** — Test-card hint for the demo (Stripe test mode only)
  - Priority: P1 · Depends on: TICKET-029, TICKET-038 · Before the meetup, before TICKET-039 (requested 29 Sep)
  - Goal: a visitor who tries the hosted demo knows which card to type on Stripe's page, without the README.
  - Backend: `GET /api/payments/config/` also returns `test_mode` - true only when the Stripe key is a test key (`sk_test_…` / `rk_test_…`), false for a live key or when payments are off. Worked out on the server from the key's prefix; the key itself never leaves the server.
  - Frontend: a short note, shown **only when `test_mode` is true**, in both languages: "Demo payment - use card 4242 4242 4242 4242, any future expiry date, any CVC." with a copy button. Places: booking step 2 (next to "You'll pay … on Stripe's payment page") and the payment page shown after "not completed" (next to Pay now).
  - With a live key the note disappears by itself, so it can never reach a real guest.
  - Decisions when the ticket starts:
    - Only the success card, or also a decline card (4000 0000 0000 0002) and a 3-D Secure card (4000 0027 6000 3184) behind a "More test cards" toggle?
    - Also show the hint **on Stripe's own page** (Checkout `custom_text.submit.message`, in the page's language, test mode only), or only in our app? (Stripe's page is where the card is typed, so it's the most useful place; it becomes part of the fixed request, like the language.)
  - Tests: `test_mode` for test / restricted-test / live / missing keys; the note shown / hidden, both languages, the copy button. README: "Payments" + "Demo day".
  - Decisions (29 Sep): **only the success card** (no "More test cards" toggle); **also on Stripe's own page** (`custom_text.submit.message`, in the page's language).
  - Done (first pass `83e5217`, then fixed after review):
    - Backend: `is_test_mode()` in `payments/stripe_client.py` - true only with payments on **and** an `sk_test_` / `rk_test_` key; `test_mode` in `GET /api/payments/config/` (the key never leaves the server). `session_params` adds the hint to Stripe's page in test mode only (`TEST_CARD_HINTS` en/el); it depends only on the key, so the request is still fixed by its idempotency key.
    - Frontend: one shared `shared/test-card-hint.ts` (`<app-test-card-hint />`) - "Demo payment - use card **4242 4242 4242 4242**, any future expiry date, any CVC." + a copy button (CDK `Clipboard`, ✓ for 2 s, "Card number copied" live region, icon `aria-hidden`); reads the cached payments config itself, a failed load → no hint. Placed in booking step 2 under "You'll pay … on Stripe's payment page", and on the "not completed" page right above **Pay now** only while the booking can be paid.
    - Review of the first pass found and fixed: the frontend specs didn't compile (tests pasted outside their `describe`, `.set()` on a read-only signal - 48 TS errors, so `ng test` couldn't run); `PaymentsConfigTests.test_on` failing; the hint shown with payments switched off; the hint shown on paid / cancelled / timed-out pages; no copy button; "Test payment" in the app vs "Demo payment" on Stripe's page; duplicated CSS; missing trailing newlines in `en.json` / `el.json`.
    - Tests: backend `TestModeTests`, `PaymentsConfigTests` (+ live key), `CheckoutTestCardHintTests` (en/el on Stripe's page, no `custom_text` with a live key, identical retry) - all 526 backend tests pass on Postgres. Frontend `test-card-hint.spec.ts` (6) + placement tests in `booking.spec.ts` (3) and `payment-return.spec.ts` (4) - all 488 frontend tests pass; `check:i18n` clean; production build clean, initial bundle unchanged (635 kB).
    - Checked in headless Chrome against the real API with a test key at 1280 and 390 px: step 2 and the "not completed" page, English and Greek, copy → "Card number copied", no sideways scroll.
    - README: new "Payments → Test-card hint (TICKET-044)", config endpoint, CFG-06 case, project layout, status and "Demo day".

- [x] **TICKET-045** — Admin closes dates of a property (blocked periods)
  - Priority: P1 · Depends on: TICKET-015, TICKET-024, TICKET-038 · Before the meetup, before TICKET-039 (requested 29 Sep)
  - Goal: the admin can close some days of a property (maintenance, own use, booked elsewhere), so guests can't book them; reopening is one click.
  - **Suggested design** (to agree when the ticket starts). After looking at every place bookings are used, a **separate model is safer than storing a block as a special booking**. A booking without a guest would have to be kept out of the revenue/occupancy stats, emails, payments, refunds, the admin bookings list and reviews - many places to miss a day before the meetup.
    - New model `BlockedPeriod` (listings app): `property`, `start`, `end` (end exclusive, like check-out), optional `note`, `created_by`, `created_at`. `end > start` (DB constraint), and an exclusion constraint so two blocks of one property never overlap.
    - **No race between a booking and a block:** creating a booking and creating a block both lock the property's row first (`select_for_update`), then check the other table. Bookings keep their own exclusion constraint for booking-vs-booking.
    - **Everything guests see respects blocks:** the property page calendar (blocked days look like booked ones - guests never see the note), the search by dates, the booking page's "available" check, and `POST /api/bookings/` (409, the same `dates_unavailable` code and message, so the frontend needs no new case).
    - **Rules:** a block can't overlap a pending or confirmed booking (409 with a clear message in both languages - cancel or move the booking first); past days can't be blocked; at most 365 days ahead, like bookings.
    - **Admin API:** `GET/POST /api/admin/properties/{id}/blocks/`, `DELETE …/blocks/{block_id}/` (admin only).
    - **Admin UI:** a "Closed dates" section on the property edit page: the list of upcoming blocks (dates, nights, note, Remove), and "Close dates" with a date-range picker (booked and already-closed days disabled) and an optional note. Both languages.
    - Stats: blocked nights are left out of occupancy's available nights? (decision - simplest is to leave occupancy unchanged).
  - Tests: overlaps both ways, the race (lock), availability / search / booking create respect blocks, removing a block reopens the dates, admin-only, both languages; frontend section + calendar. README: data model, API, admin pages, test cases.
  - Also the foundation for TICKET-046 (an imported Airbnb / Booking.com calendar would become blocks).
  - **Decisions (agreed 30 Sep, before building):**
    - the suggested design above: a separate `BlockedPeriod` model, not a special booking
    - **occupancy excludes closed nights:** occupancy = confirmed nights / (active properties x nights in period - closed nights in the period), so closing a week for own use doesn't make a property look less popular; "available nights" shrinks accordingly. Revenue and the revenue chart are unchanged.
    - **no editing** a block: Remove (one click) + close the new dates
    - **extras:** the demo seed adds one closed period (a note like "Maintenance"); in the **admin's** date picker closed days get their own colour, different from booked days (guests still see closed days exactly like booked ones); a **"Closed dates" tab on the admin Bookings page** (upcoming blocks of all properties, property filter, Remove) from a new `GET /api/admin/blocks/` - a separate tab, not rows mixed into the paginated bookings table
    - Chrome check locally **and on Render**
  - Plan: step 1 backend model + admin API · step 2 guests respect blocks (availability, search, booking create) + occupancy + seed · step 3 "Closed dates" on the property edit page · step 4 "Closed dates" tab on the admin Bookings page · step 5 README, Chrome check (local + Render), done.
  - **Step 1 done** (backend model + admin API): `BlockedPeriod` (`listings/models.py`, migration 0006: `end > start` + no-overlap exclusion constraint per property; read-only in Django Admin) and `lock_property()` (`FOR NO KEY UPDATE`). `listings/blocks.py`: `GET/POST /api/admin/properties/{id}/blocks/` (upcoming blocks soonest first / close dates) and `DELETE …/blocks/{block_id}/`, admins only. Rules: start today..365 days ahead, at most 365 nights, `end > start`; overlapping a pending/confirmed booking → 409 `booking_overlap` (lists the bookings), overlapping a block → 409 `dates_closed`; stale payment holds settled first; checks run with the property locked. Messages in Greek. 18 tests in `listings/test_blocks.py`. README: data model + "Closed dates API (TICKET-045)".
  - **Step 2 done** (guests respect blocks + occupancy + seed): closed dates are in `availability.booked_ranges` (same shape as bookings, no note) and make `is_available` false; the date search and map pins leave the property out; `POST /api/bookings/` takes `lock_property()` and checks the blocks before inserting → 409 with the same `dates_unavailable` body. Stats: `closed_nights` overall and per property, left out of available nights; dashboard Occupancy card "N closed nights not counted". Seed: one 3-night "Maintenance" block on the first active property, ≥ 2 weeks ahead, on free dates. 13 more backend tests (31 in `test_blocks.py`, incl. the race both ways - they fail without the lock) + 3 frontend. README: properties/bookings/stats/seed sections + "What guests see and can book".
  - **Step 3 done** ("Closed dates" on the property edit page): a card below the form (saved straight away, not by Save; edit only): upcoming periods ("14 Oct → 17 Oct 2026 · 3 nights · closed now · note") with one-click **Remove**, and **Close dates** with a date-range picker (booked days struck through, closed days hatched in the tertiary colour + legend; neither pickable; up to 365 days ahead, no 30-night cap) and an optional note; checks before sending, the server's 409 shown as is, list reloaded after changes. `ClosedDatesService`, `closed-dates.rules.ts`, both languages, own date adapter. 14 frontend tests (505 total); headless Chromium check at 1280/390 px. Initial bundle 635 → 637 kB.
  - **Step 4 done** ("Closed dates" tab on the admin Bookings page): `GET /api/admin/blocks/` (admins only; every property's upcoming blocks soonest first with `property_title` / `property_is_active`; `?property=`); a fourth tab `?tab=closed` ("Κλειστές" in Greek) with only the Property filter and no bookings request: property (linked to its edit page, Retired badge), dates, nights, "closed now", note, "by …", one-click Remove; empty state points to the property edit page. 3 backend tests (560 total) + 6 frontend (511 total); headless check 1280 / 390 px (Greek).
  - **Step 5 - final check (30 Sep):** 560 backend + 511 frontend tests, build clean. **Render** (auto-deployed) as admin: closed 20→23 Oct on Quiet Villa in Heraklion from the picker → guests see the days as booked (API `is_available` false, left out of the date search, no note; property page "Some of these nights are already booked", Book now off); dashboard October "9 of 338 nights · 3 closed nights not counted"; Bookings → Closed dates → Remove → available again. **Local** (after `migrate`) in Greek: 409 over pending booking #224 in both languages, past day refused, overlapping closed dates refused; a guest booking over closed dates → 409 `dates_unavailable`; Greek picker with hatched closed / struck-through booked days and the end capped at the next closed night; close + remove from the Κλειστές tab. Everything created during the checks was removed. Small fix: the dates field no longer stretches to the note hint's height. (Local Chrome stopped delivering automation mouse clicks mid-check; finished with DOM clicks - worth one manual click-through.)
  - **Done.** Admins close dates per property (edit page) and see / reopen every property's closed dates (Bookings → Closed dates); guests see closed days exactly like booked ones and can't book them; booking and closing can't race (property lock); occupancy leaves closed nights out; the seed closes one "Maintenance" period. Backend 560 tests, frontend 511.

- [x] **TICKET-047** — Brevo as a backup email provider when the Gmail token has expired
  - Priority: P1 · Depends on: TICKET-030 · **Before the meetup, before TICKET-039** (moved out of TICKET-043 on 30 Sep; TICKET-039's smoke test then checks it on Render)
  - Why now: the Google app is in *Testing*, so the Gmail refresh token expires 7 days after it was made (made 28 Sep → about **5 Oct**). At the meetup (1 Oct) emails still work, but recruiters get the hosted link to try afterwards - once the token expires every booking email would fail quietly until `gmail_authorize` is re-run. The fallback keeps them going out.
  - Goal: when a Gmail API send fails because the Google login is dead (`invalid_grant` - expired or revoked refresh token), send the same email through Brevo, record which provider sent it, and tell the owner once that the Gmail token needs `gmail_authorize` again.
  - Background: TICKET-030 first used Brevo (HTTP API, worked on Render) and then replaced it with the Gmail API because Brevo rewrites a Gmail sender to its own `…@brevosend.com` address (Reply-To keeps replies with the owner - fine for a fallback). The old `BrevoEmailBackend` is in git history (`3b57bb0`) and can be brought back.
  - Sketch: `EMAIL_PROVIDER=gmail` + optional `EMAIL_FALLBACK_PROVIDER=brevo` and `BREVO_API_KEY`; a small wrapper backend tries Gmail, and on `invalid_grant` / an auth failure (not on an ordinary refusal of one message) sends the same message through Brevo; the outbox (`BookingEmail`) records which provider sent it; no Brevo key → today's behaviour.
  - **Decisions to agree when the ticket starts** (ask first, then a step plan for approval):
    1. When to fall back: only when Gmail's login is dead (`invalid_grant` / 401 after the refresh), or on any Gmail failure - incl. network errors and Google outages (5xx)?
    2. How the owner is told the token needs renewing: log error, a line in the owner alert email, a Django Admin banner / outbox column - or a mix; and "once" per what (per process, per day, until a Gmail send works again)?
    3. Where it's on: Render only (`render.yaml`, `BREVO_API_KEY` as `sync: false`) or also local Docker (`.env`)?
    4. Anything else for the outbox: a `provider` field on `BookingEmail` (migration) vs only a log line.
  - Owner to do: a (new) **Brevo API key** - the old `BREVO_API_KEY` was deleted from Render when Gmail replaced Brevo; the Brevo sender (the owner's Gmail) must still be verified there.
  - Tests: Gmail `invalid_grant` → Brevo used and recorded; ordinary 4xx refusal of one message → no fallback (per decision 1: 5xx / network); no Brevo key → current behaviour; the owner is told once; nothing secret in errors or logs. README "Emails" (+ the "Gmail token: renew it" section) and `render.yaml`.
  - **Smoke test (add to TICKET-039):** on Render, temporarily set a broken `GMAIL_REFRESH_TOKEN`, make a booking → "we've got your booking" arrives through Brevo (sender `…@brevosend.com`, Reply-To the owner), the outbox shows Brevo, the owner is told the token needs renewing; put the real token back → the next email goes through Gmail again.
  - **Decisions agreed (30 Sep):**
    1. Fall back only when Gmail's **login** fails - `invalid_grant` / another 4xx from the token service, a 401 even with a fresh access token, or a network error / 5xx / 429 while getting the token (nothing sent yet). A failure of the send itself (Gmail refusing the message, 5xx / timeout on the send) does **not** fall back - it may have gone out; the outbox retry handles it.
    2. Owner told by an error log line + an email through Brevo to `BOOKING_ALERT_EMAILS`, **at most once per 24 h** while Gmail is broken, tracked in the DB (survives Render restarts, row lock against two processes); reset by the next Gmail send. Only for a *dead* login - a token-service outage is only logged.
    3. On at Render (`render.yaml`: `EMAIL_FALLBACK_PROVIDER=brevo`, `BREVO_API_KEY` `sync: false`); locally optional (`.env.example`, off without a key).
    4. `BookingEmail.provider` field (migration), a column + filter in Django Admin.
    - Not changed (owner's call): `EMAIL_PROVIDER=gmail` without the `GMAIL_*` values still prints to the console, not Brevo.
  - Plan: step 1 Brevo backend back + `provider` · step 2 the fallback wrapper · step 3 the once-a-day owner alert · step 4 config, README, full test run, done.
  - **Step 1 done** (`23ed03c`): `notifications/brevo.py` - `BrevoEmailBackend` restored from `3b57bb0` (one POST per email, Reply-To = the owner, `X-Booking-Email` header, never the key in an error); `EmailSendError` moved to `notifications/errors.py` (shared); `BREVO_API_KEY` / `BREVO_API_URL`; `BookingEmail.provider` (migration 0003: gmail / brevo / smtp / console, set when sent) with a Provider column + filter in Django Admin; `send_test_email` says who really sent it. 10 tests (`notifications/test_providers.py`).
  - **Step 2 done** (`f7e2cdf`): `GmailWithBrevoFallbackBackend` (picked only with gmail + `EMAIL_FALLBACK_PROVIDER=brevo` + a key); the Gmail backend raises `GmailLoginError(dead=…)` for every pre-send failure; error log line per fallback (which email, why, no secrets); both failing → one error with both reasons. Warnings W005 (unknown fallback), W006 (no key), W007 (fallback without gmail). +10 tests, incl. which backend the settings pick (fresh process).
  - **Step 3 done** (`26e1fc6`): `GmailHealth` (one row, migration 0004; read-only "Gmail status" in Django Admin) + `notifications/gmail_health.py`: a dead login → recorded + "Action needed: renew the Gmail token for booking emails" through Brevo to `BOOKING_ALERT_EMAILS`, at most once per 24 h (claimed under a row lock, claim undone if the alert fails); an outage only logged; the next Gmail send clears it; never raises. +9 tests incl. the smoke test with Google/Brevo mocked.
  - **Step 4 done:** `render.yaml` (`EMAIL_FALLBACK_PROVIDER=brevo`, `BREVO_API_KEY` `sync: false`), `.env.example`; README: new "Brevo fallback when the Gmail token expires" (decisions, the three steps, "Switch it on" for the owner, the smoke test, rules BF-01…09 ↔ tests PROV-01…20), "Emails" provider table, "Gmail token → How you notice", startup checks W005-W007, project tree, status, Demo day, next steps. **589 backend tests pass** on Postgres (+29); frontend unchanged.
  - **Done.** When Gmail's login is dead, booking emails go out through Brevo (`…@brevosend.com`, Reply-To the owner), the outbox records the provider, and the owner is told once a day to run `gmail_authorize`; a working Gmail switches everything back by itself. Not yet live: **owner to do** - a new Brevo API key in Render's `BREVO_API_KEY` (+ `EMAIL_FALLBACK_PROVIDER=brevo`) and a redeploy (README "Brevo fallback → Switch it on"); TICKET-039 then runs the smoke test on Render. Backend 589 tests, frontend 511.

- [x] **TICKET-039** — Final redeploy + smoke test (local + hosted) — **the last ticket before the meetup**
  - Priority: P0 · Depends on: every ticket above (TICKET-026, TICKET-027 for hosting)
  - Redeploy both Render services from the final `master`, run the local and hosted smoke tests (the "Payments: business rules & test cases" E2E cases + the TICKET-028 hosted demo check), and tick off the README's "Demo day" checklist.
  - (The former TICKET-039 "Record a backup demo video" was dropped - decision after TICKET-029.)
  - TICKET-044 checks (only tested locally with Stripe mocked, so check them for real here):
    - **Stripe's own page:** the "Demo payment - use card 4242 4242 4242 4242, any future expiry date, any CVC." line shows above Stripe's Pay button, in English and in Greek (the page's language). It has never been seen on Stripe's real page yet - the tests only checked the request sent to Stripe.
    - **Render:** after the redeploy, `https://booking-demo-api.onrender.com/api/payments/config/` returns `"test_mode": true`; the hint shows in booking step 2 (under "You'll pay … on Stripe's payment page") and on the "Payment not completed" page above **Pay now** - and not on paid / cancelled / timed-out pages.
    - **Copy button on a real phone:** tap it, see the ✓, paste into Stripe's card field (clipboards on phones can behave differently from headless Chrome).
  - TICKET-045 checks: one manual click-through of Closed dates on the local app (Close dates → picker → save → guest page shows the days booked → Remove from Bookings → Closed dates) - the automated local check had to finish with DOM clicks.
  - TICKET-047 checks: the Brevo fallback on Render - see TICKET-047's "Smoke test" and README "Brevo fallback → Switch it on / Check it" (needs `BREVO_API_KEY` set on Render first).
  - Progress (30 Sep):
    - **Automated suites:** 589 backend tests pass on Postgres 16, 511 frontend tests (78 files) pass, production build OK (checked with font inlining off in a scratch copy only - the test machine can't reach Google Fonts; nothing changed in the repo).
    - **Hosted, automatic:** "Hosted demo check" (GitHub Actions) green on `ed7cb40`; Render API live on `ed7cb40`; `/api/payments/config/` → `enabled: true, test_mode: true`; health → database `connected`.
    - **Hosted E2E (Chrome, guest1@demo.com):** test-card hint in booking step 2 (Copy button → ✓) and on "Payment not completed" above Pay now; **Stripe's real page shows the hint in English and in Greek** (first time seen live; the Greek page also has "2 νύχτες" and a Greek locale). Pay now after switching EN→ΕΛ reopens the same English page, as designed (CHK-09). #173 paid with 4242 → "Payment received" (Greek), no hint on the paid page → guest cancel → **Refunded €98 in ~3 s**. Emails via Gmail: "Complete your payment", "confirmed", owner alert (inbox), "cancelled" with the refund line.
    - **Local E2E (Chrome):** footer dot green, Demo logins box; #338 paid with 4242 → Confirmed, no hint on the paid page → guest cancel → **Refunded €128 in ~2 s**; #339 paid with the 3-D Secure card 4000 0025 0000 3155 → Confirmed. Local Docker now sends through Gmail (+ Brevo fallback) instead of Mailpit (owner's `.env`: `EMAIL_PROVIDER=gmail`), so the emails were checked in the Gmail Sent folder / inbox: same four emails as on Render.
    - **TICKET-045 manual click-through (local, real clicks):** Modern Retreat in Athens → Close dates 5→8 Oct with a note → the guest page says "Booked" for 6 Oct → Admin → Bookings → Closed dates lists it (by admin@demo.com) → Remove → "Dates open again", list empty. The tab switch needs a real click (an accessibility/DOM click doesn't switch Material tabs), which explains the earlier DOM-click note.
    - **No bugs found.** "Continue" in step 1 sometimes looked stuck during the run: Chrome's window was reported *hidden*, so the stepper's animation was throttled - the stepper had already moved to step 2 (`selectedIndex = 1`). Not an app bug.
    - **Admin cancel of paid #339 (local, 3-D Secure payment):** Cancelled → **Refunded €128** (Admin → Bookings → Cancelled shows "Refunded €128 on 30 Sept 2026").
    - **Brevo fallback on Render - inconclusive:** the owner added an `X` to `GMAIL_REFRESH_TOKEN` on Render and booked; Gmail kept sending. Most likely the running process never used the broken token: `GmailApiEmailBackend` caches Google's access token per process for ~59 minutes, and an env change only reaches the app after a redeploy (no deploy after the change showed in Render's events). The fallback itself was seen working on 30 Sep 11:31 (test email from `…@brevosend.com` + the "Action needed: renew the Gmail token" alert in the owner's inbox). Re-run later: Save, rebuild and deploy → wait for **Live** → book (README "Brevo fallback → Check it" now says so). Carried over to TICKET-043.
    - **Owner-only, not done by the assistant:** Copy button on a real phone.
    - Final: TICKETS/README pushed (docs only, no code) → both Render services redeploy → Hosted demo check.
  - **Hosted re-seed before the meetup (1 Oct, owner's request):** Render's free plan has no shell, so `7b01011` added a one-off `seed_demo_data --clear` to `backend/build.sh` → that deploy re-seeded (new property ids 29-42, Demo logins guest1-10 / admin) → `612fefa` removed the line again (build.sh identical to before; that deploy kept the data). Hosted demo check green afterwards.
  - **Done** (1 Oct). Automated suites green (589 backend, 511 frontend, build OK); hosted demo check green; payments end to end on Render and locally (4242, 3-D Secure, guest and admin cancel → refunds in 2-3 s); the test-card hint seen on Stripe's real page in English and Greek; booking emails via Gmail; TICKET-045 click-through with real clicks; no bugs found. Open: the Brevo fallback re-run on Render (TICKET-043) and the phone Copy-button check (owner).

---

## Epic 9 — After the meetup: refactor & hardening

- [ ] **TICKET-043** — Refactor & hardening (the last ticket)
  - Priority: P2 · Depends on: TICKET-039 · After the meetup, when the demo becomes a real personal project. Collects refactors and robustness work; items are added here as they come up.
  - (The Brevo backup email provider, first collected here, moved to **TICKET-047** on 30 Sep, to be built before the meetup.)
  - From TICKET-039: re-run the Brevo fallback smoke test on Render (broken `GMAIL_REFRESH_TOKEN` → **Save, rebuild and deploy** → wait for Live → book → email from `…@brevosend.com` + the renew-token alert; then restore). The first try was inconclusive because of the cached Google access token / no redeploy.
  - **Suggested plan (added 9 Oct, after TICKET-048)** - all doable in test mode; agree the item list and order when the ticket starts:
    1. **Brevo fallback on Render, the easy way (do first, ~10 min).** The Gmail token (made 28 Sep, app in *Testing*) has expired by itself, so nothing needs breaking or restoring: book on the live site as `guest1@demo.com` (thanks to TICKET-048 its emails go to the owner's inbox) and cancel → expect "Complete your payment" + "cancelled" from `…@brevosend.com` and at most one "Action needed: renew the Gmail token" alert; check Django Admin → Booking emails (Provider = Brevo). Already seen working **locally** on 9 Oct (booking #370). Precondition: `BREVO_API_KEY` + `EMAIL_FALLBACK_PROVIDER=brevo` set on Render - if not, the emails fail (recorded as Failed), which is worth knowing too. Afterwards: renew the token (`manage.py gmail_authorize` → `.env` + Render `GMAIL_REFRESH_TOKEN` → redeploy) and confirm the next email goes via Gmail again.
    2. **Stop the weekly Gmail token renewal (optional).** Publish the Google app (needs a public home page + `/privacy` page on the site - the follow-up idea from TICKET-030), so the refresh token stops expiring every 7 days.
    3. **Unique email at the DB level** (from TICKET-012): a partial unique index on `LOWER(email) WHERE email <> ''` (`RunSQL` migration in `accounts`), after checking the data has no duplicates; a test for the concurrent double sign-up.
    4. **Unused uploaded photos in S3** (from TICKET-036): photos uploaded in a property form that was then discarded stay in the bucket. Options: a `manage.py cleanup_unused_uploads` that lists `property-images/YYYY/MM/` and deletes keys no `PropertyImage` uses and older than a day (needs `s3:ListBucket` on that prefix only - owner's AWS change), or an S3 lifecycle rule on an "unclaimed" prefix.
    5. **Render free Postgres expires ~25 Oct** - decide before then: move to a new free database (export/import or a fresh `seed_demo_data`) or a paid plan; document the steps in the README.
    6. **Repo housekeeping:** the `.git/stale-*` lock files and `.git/objects/*/tmp_obj_*` leftovers in the local folder (from commits made while deleting was refused) - safe to delete by hand; nothing in the repo itself.
    7. **Owner-only leftover from TICKET-039:** the Copy button of the test-card hint on a real phone.

- [ ] **TICKET-046** — Calendar sync with Airbnb / Booking.com (future suggestion, production only)
  - Priority: P3 · Depends on: TICKET-045 · **Not planned to be built** - a recommendation for if the app ever runs a real property listed on several platforms (this app + Airbnb + Booking.com), where a night sold on one must close on the others.
  - **Option 1 - iCal calendar sync (free, what individual hosts use):**
    - Export: a secret per-property link `GET /api/properties/{id}/calendar/<token>.ics` listing booked and blocked nights; pasted into Airbnb and Booking.com as an imported calendar.
    - Import: each platform's own `.ics` link stored per property; a scheduled job (every 15-30 min) reads them and turns their events into `BlockedPeriod`s (TICKET-045) marked with their source, updating / removing them when the feed changes.
    - Limits: the platforms refresh the calendars they import only every few hours, so a double booking can slip through in that window; only "busy" dates travel (no prices, guests or cancellations).
  - **Option 2 - a channel manager (what professional hosts use):** Guesty, Hostaway, Smoobu, Rentals United, Beds24 and similar connect to Airbnb and Booking.com through their official APIs (near real time; also prices and availability rules). Those APIs are open to approved partners, so this app would connect to the channel manager's API, not to Airbnb / Booking.com directly.
  - Recommendation: iCal first (small, builds on TICKET-045); a channel manager once double-booking risk or the number of properties makes the hours-long delay unacceptable.
  - **Test-mode version (added 9 Oct)** - if it's ever wanted as a portfolio feature, Option 1 can be built and tested without a real Airbnb / Booking.com listing:
    - **Export:** `GET /api/properties/{id}/calendar/<token>.ics` (secret per-property token, regenerate button in the admin form) listing pending/confirmed bookings and closed dates as all-day busy events (no guest data); checked by subscribing to it in Google Calendar and by a validator test.
    - **Import:** an "Imported calendars" list per property in the admin form (name + `.ics` URL); a `manage.py sync_calendars` command (+ an admin "Sync now" button, since Render's free plan has no cron/shell) turns their events into `BlockedPeriod`s with a `source` field (new migration), updating / removing them when the feed changes and never touching blocks the admin made by hand; overlaps with our own bookings are reported, not dropped.
    - **Testing without the platforms:** a Google Calendar's "secret address in iCal format", or `.ics` files served by the test suite / a local static file; tests for parsing (all-day and timed events, time zones, recurring events ignored or expanded), sync updates and removals, and the overlap report.
    - Size: several days (model + migration, export, import, sync, admin UI in both languages, docs). Not needed for the demo - only start it if wanted.

---

- [x] **TICKET-048** — Smaller demo seed + demo guests' emails to the owner
  - Priority: P1 · Depends on: TICKET-041 · Requested 9 Oct, after the meetup.
  - Why: the owner's inbox filled with "Complete your payment" emails and, worse, Gmail bounce notices: 7 of 12 booking emails since 28 Sep went to `guest1@demo.com`, which can't receive mail, and each one produced 2 "delivery delayed" + 1 "delivery failed" notice. The seeder itself never sends emails - the emails came from real test bookings.
  - Decisions (agreed 9 Oct): demo guests' emails go to the owner's inbox (`BOOKING_ALERT_EMAILS`), like the demo admin's; seed defaults **3 properties** (1 of them retired, so 2 bookable) and **9 guests** - defaults only, `--properties` / `--guests` can still ask for more; re-seed **locally and on Render** (one-off, wipes Render's bookings and test payments).
  - Plan: step 1 demo-guest emails → owner · step 2 smaller seed (defaults, exactly one retired property, tests) · step 3 README/TICKETS, local re-seed, one-off Render re-seed, Chrome check, push.
  - **Step 1 done:** `core/demo_accounts.py:is_demo_guest(user)` (username **and** email `guest<N>@demo.com`, no query); `notifications/outbox.py:recipients_for()` sends a demo guest's guest emails to `BOOKING_ALERT_EMAILS` (own email when the list is empty); real sign-ups unchanged. 3 new tests (EMAIL-34, EMAIL-35 incl. look-alike addresses, fallback); **592 backend tests pass** on Postgres 16. README rule EM-22.
  - **Step 2 done:** `seed_demo_data` defaults `--properties 3` (was 14) and `--guests 9` (was 10) - more by hand still works. Every property is created active and `_ensure_one_retired()` retires **exactly one, the last** (the old random 10% could retire 2 of 3); a single property is never retired. Favorites: 1-2 per guest when only 2 places are active. Found by the new tests: the "one unreviewed stay per guest" stays could pile onto one of the 2 active places and leave it with 3 reviews - now spread evenly (`Counter` per place), so every place gets 4-8 (checked over 12 random seeds: 4-5 on the active ones, 4-8 on the retired one). 3 new tests (`SeedDefaultSizeTests`: defaults over 5 seeds incl. reviews / favorites / reviewable stay / closed dates; more by hand = still exactly one retired; a single property stays active); **595 backend tests pass** on Postgres 16. README "Seeding demo data" (properties, guests, reviews, favorites, options table) and the guest1…guest9 logins updated.
  - **Step 3 done (9 Oct):** owner re-seeded locally (`seed_demo_data --clear` → "Seeded 3 properties, 9 guests, 14 reviews and 17 saved places", S3 seed photos). Chrome, local: the login page's Demo logins box says "any up to guest9@demo.com", the API lists 2 bookable places (4-5 reviews each); booking #370 as `guest1@demo.com` → "Complete your payment - booking #370" **arrived in the owner's Gmail inbox** (not `guest1@demo.com`, no bounce), then cancelled by the guest → "cancelled" email, also to the owner. The emails came from `…@brevosend.com` plus "Action needed: renew the Gmail token" - the Gmail token had expired (made 28 Sep) and TICKET-047's Brevo fallback took over as designed. Render: one-off re-seed via a temporary `seed_demo_data --clear` line in `build.sh` (`da0596b`), removed again right after (`4f054b5`); the hosted API now lists 2 bookable places (ids 43-44, S3 photos, 4-5 reviews) and `/api/auth/demo-logins/` guest1…guest9 + the admin. All Render bookings / test payments from before were wiped (agreed).
  - **Done.** Demo guests' booking emails reach the owner's inbox instead of bouncing; the default seed is 3 properties (2 bookable + 1 retired) and 9 guests, still with 4-8 reviews per place, saved places, a reviewable stay per guest and a closed period; local and Render re-seeded. Backend 595 tests. Owner to do: renew the Gmail token (`manage.py gmail_authorize`, then `.env` + Render) - until then emails go out through Brevo.

---

## Explicitly cut unless way ahead of schedule

Not tickets to plan around — only pick these up if everything above is done
with time to spare:

- ~~Multi-language (Greek/English)~~ — now planned as TICKET-038.
- A true native mobile app — the responsive/PWA work in TICKET-031 already
  covers this need.

## If a day slips

Trim from the bottom up: Epic 7 first, then Epic 6, then TICKET-047
(Brevo fallback - then re-run `gmail_authorize` by ~4 Oct instead), then TICKET-045
(admin closed dates), then TICKET-044 (test-card hint), then reduce Epic 8
to just TICKET-039 (final redeploy + smoke
test). Do not cut anything in Epic 0–5 — the core booking flow,
admin visibility, and a stable public URL are what make the demo credible.
