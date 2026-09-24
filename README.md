# Booking System Demo

Django + Angular booking/property-management demo, running side by side in
Docker with a Postgres database. See `Booking System Demo - Build Plan.md`
for the full project plan (models, API design, day-by-day schedule).

**Status:** scaffold verified end-to-end (Angular <-> Django <-> Postgres,
plus pgAdmin for DB inspection). The `Property` model now exists (first
piece of the data layer) - see "Next steps" at the bottom for what's still
missing.

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
  requirements.txt     Django, DRF, django-cors-headers, django-environ, psycopg2
  manage.py
  config/              Django project settings
    settings.py        Reads DB/secret/CORS config from env vars
    urls.py            / admin/ -> Django admin, /api/ -> core.urls
    wsgi.py / asgi.py
  core/                Small app - currently just the health-check endpoint
    views.py           GET /api/health/ - queries Postgres, returns status
    urls.py
  listings/            Data layer for bookable properties
    models.py          Property + PropertyImage models
    admin.py           Registers both in Django Admin, images inline on the Property page (dev-only DB inspection, see Epic 4 for the real admin UI)
    migrations/        0001_initial.py (Property), 0002_propertyimage.py (PropertyImage)
  accounts/            Adds a role/phone Profile on top of Django's built-in User
    models.py          Profile model (role: guest/admin, phone)
    signals.py         post_save on User auto-creates a Profile (any creation path)
    admin.py           Profile inline on the User admin page, plus its own list
    migrations/        0001_initial.py creates the profiles table

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

Domain models live in their own apps rather than in `core` (which stays
infrastructure-only): `listings` holds `Property`/`PropertyImage`,
`accounts` holds `Profile`. A `bookings` app is expected to follow the
same pattern for the `Booking` model.

Migrations: `listings/migrations/0001_initial.py` creates the `Property`
table, `0002_propertyimage.py` creates `PropertyImage`, and
`accounts/migrations/0001_initial.py` creates `Profile`. All apply
automatically the next time the `backend` container starts (the Dockerfile
runs `migrate` on boot - see "Quick start" above); outside Docker, run
`python manage.py migrate` from `backend/` with a reachable Postgres
connection.

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
- **Ports already in use**: something else on your machine is using 4200,
  8000, 5432, or 5050. Either stop it or change the left-hand side of the
  port mapping in `docker-compose.yml` (e.g. `"4300:4200"`).

## Next steps (per the build plan)

The scaffold, three-way connectivity check, and the `Property` /
`PropertyImage` / `Profile` models are done. Still pending from the data
layer: the `Booking` model and migration - then DRF serializers/viewsets,
JWT auth, and the Faker seed script.
