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

- [ ] **TICKET-015** — Booking serializer + viewset
  - Priority: P0
  - Depends on: TICKET-008, TICKET-014
  - `GET /api/bookings/` (own bookings for a guest, all bookings for admin), `POST /api/bookings/` (create, with overlap validation against existing non-cancelled bookings), `PATCH /api/bookings/{id}/` (guest can cancel their own; admin can change status).
  - Concurrency requirements (delegated from TICKET-008 — closes the double-booking race):
    - `POST /api/bookings/`: `Booking.objects.overlapping()` alone is not race-proof (check-then-act). Add a Postgres `ExclusionConstraint` on `Booking` (needs the `btree_gist` extension — `django.contrib.postgres.operations.BtreeGistExtension` in a new `bookings` migration): `(property WITH =, daterange(check_in, check_out) WITH &&) WHERE status <> 'cancelled'`. This makes two overlapping non-cancelled bookings for the same property impossible at the DB level regardless of request timing — the real backstop, not just the pre-check.
    - Wrap booking creation in `transaction.atomic()`; catch the `IntegrityError` the constraint raises on a genuine race and return a clean 409/400 ("these dates were just booked by someone else") instead of a 500. Keep calling `overlapping()` first as a fast, friendly pre-check for the non-race case — just don't rely on it alone.
    - `PATCH /api/bookings/{id}/` (cancel/status-change): treat as a single atomic read-modify-write — `select_for_update()` the specific `Booking` row inside `transaction.atomic()` — so a guest's cancel and an admin's status change landing at nearly the same time can't produce a lost update. Validate the status transition explicitly (e.g. reject cancelling an already-cancelled booking, or confirming one that's cancelled) instead of blindly overwriting `status`.

- [ ] **TICKET-016** — Admin stats endpoint
  - Priority: P1
  - Depends on: TICKET-015
  - `GET /api/admin/stats/` → booking counts, occupancy rate, revenue, for the admin dashboard (TICKET-023).

---

## Epic 3 — Frontend: Customer Experience

- [ ] **TICKET-017** — `AuthService` + JWT interceptor + login/register pages
  - Priority: P0
  - Depends on: TICKET-012
  - Attaches the access token to outgoing requests, handles refresh on expiry, `/login` and `/register` routes.

- [ ] **TICKET-018** — `PropertyService` + `PropertyListComponent` (`/listings`)
  - Priority: P0
  - Depends on: TICKET-013
  - Grid of properties + filters (dates, location, guests, price).

- [ ] **TICKET-019** — `PropertyDetailComponent` (`/listings/:id`)
  - Priority: P0
  - Depends on: TICKET-018
  - Gallery, amenities, availability calendar, "Book Now" → routes to the booking form.

- [ ] **TICKET-020** — `BookingService` + `BookingFormComponent` (`/booking/:propertyId`)
  - Priority: P0
  - Depends on: TICKET-015, TICKET-019
  - Date picker, live price calculation, confirm → `POST /api/bookings/`.

- [ ] **TICKET-021** — `MyBookingsComponent` (`/my-bookings`) + `AuthGuard`
  - Priority: P0
  - Depends on: TICKET-017, TICKET-020
  - Upcoming/past bookings, cancel action; route guarded so only logged-in guests can reach it.

---

## Epic 4 — Frontend: Admin Experience

- [ ] **TICKET-022** — `AdminGuard` + admin route group + role-aware `NavbarComponent`
  - Priority: P0
  - Depends on: TICKET-017
  - Admin routes only reachable by admin accounts; navbar shows the Admin link only when logged in as admin.

- [ ] **TICKET-023** — `AdminDashboardComponent` (`/admin/dashboard`)
  - Priority: P1
  - Depends on: TICKET-016, TICKET-022
  - Stat cards: bookings, occupancy, revenue.

- [ ] **TICKET-024** — `AdminPropertyListComponent` + `PropertyFormComponent` (`/admin/properties`, `/admin/properties/:id/edit`)
  - Priority: P0
  - Depends on: TICKET-013, TICKET-022
  - CRUD table for properties — this is the real demo-facing admin UI, not Django Admin.

- [ ] **TICKET-025** — `AdminBookingsComponent` (`/admin/bookings`)
  - Priority: P0
  - Depends on: TICKET-015, TICKET-022
  - Table of all bookings with status-change actions.

---

## Epic 5 — Hosting & Deployment

- [ ] **TICKET-026** — Deploy backend skeleton to Render
  - Priority: P0
  - Depends on: TICKET-004
  - Managed Postgres (free tier) + Web Service for the Django/DRF API, auto-deploy from GitHub. Do this early, not the night before.

- [ ] **TICKET-027** — Deploy Angular build to Render Static Site
  - Priority: P0
  - Depends on: TICKET-026, TICKET-018
  - Confirm the hosted frontend can reach the hosted API (CORS/env config for the production API URL).

- [ ] **TICKET-028** — Pre-demo hosted-URL check
  - Priority: P0
  - Depends on: TICKET-027
  - Free services spin down after ~15 min idle (30–60s cold start). Ping the hosted URL a few minutes before demoing; plan to run **locally** as the primary during the pitch and hand out the hosted URL as a leave-behind link.

---

## Epic 6 — Attempt-next (build if the schedule allows)

- [ ] **TICKET-029** — Stripe test-mode checkout on booking confirm
  - Priority: P1 · Depends on: TICKET-020
  - Payment-safety requirements (delegated from TICKET-008 — avoids double charges):
    - Use a Stripe idempotency key per checkout attempt, derived from the booking id, so a double-click or a network retry never creates two PaymentIntents/charges for the same booking.
    - Only start payment after the booking row has been committed (i.e. it already survived TICKET-015's exclusion-constraint check) — never take payment for a booking that lost the race and was rejected.
    - Drive `Booking.status -> confirmed` from a Stripe webhook confirming payment actually succeeded, not optimistically the moment the client calls confirm — a booking should never read as confirmed before money has actually moved.

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
