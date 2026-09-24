# Booking System Demo — Build Plan

Sep 24, 2026 · @Paraskevas Lysikatos

## Overview

A booking/property-management demo — a personal "Airbnb" where guests browse and book apartments or rooms, and an admin manages listings and bookings. Built to bring as a working sample to the TechPro Academy Tech Meetup on October 1, and later extended into a real personal project.

Two roles drive the whole design:

- **Customer** — sees available apartments/rooms explicitly, browses, filters, and books.
- **Admin** — sees and manages all bookings and listings.

Stack choice is deliberate: Django (Python) + Angular is the exact combination several of the companies at the meetup are hiring for (DRAXIS, Dataviva, Onelity, EY), so the demo doubles as a portfolio piece.

## Tech Stack & Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Django + Django REST Framework | Built-in Admin, ORM and auth cut the admin-side work down to almost nothing |
| Database | PostgreSQL | Matches the real version from day one — same engine locally (via Docker) and in the hosted deploy |
| Frontend | Angular (latest stable) + Angular Material | Component-per-page structure, fast to make look polished |
| Auth | JWT (djangorestframework-simplejwt) | Stateless, closer to a real production API — short-lived access token + refresh token |
| Seed data | `Faker` (Python) | Realistic-looking listings and bookings without manual data entry |

Repo layout: one repo, two folders — `backend/` (Django project + DRF API) and `frontend/` (Angular app), run side by side on `localhost` during development.

**Admin interface:** build a real custom Angular admin view — dashboard, bookings table, property CRUD — as the actual admin interface, rather than relying on Django's default Admin as the demo-facing UI. Still worth registering the models in Django Admin during development for quick database inspection; it's just not what you show at the meetup.

## Hosting

Deploy early so the public link is solid well before Oct 1, not assembled the night before.

**Render.com** (recommended) — one platform, free tier easily covers a few days:

- Managed PostgreSQL (free tier)
- Web Service for the Django/DRF API, auto-deploys from GitHub
- Static Site for the built Angular app

Alternative: Railway.app — similar all-in-one setup with a small free usage credit.

**Live-demo risk:** free web services spin down after \~15 minutes idle and take 30–60s to wake on the first request. Run the app **locally** as the primary during the actual pitch at the meetup table, and hand out the hosted public URL as a leave-behind link for company reps to try afterward. Ping the hosted URL a few minutes before demoing either way, just in case.

## Data Models

| Model | Key fields |
| --- | --- |
| `Property` | title, description, location, price\_per\_night, capacity, amenities, is\_active |
| `PropertyImage` | property (FK), image, is\_cover |
| `Booking` | property (FK), guest (FK → User), check\_in, check\_out, total\_price, status (pending / confirmed / cancelled), created\_at |
| `Profile` | user (OneToOne → User), role (guest / admin), phone |
| `Review` *(nice-to-have)* | property (FK), guest (FK), rating, comment, created\_at |

Notes:

- Use Django's built-in `User` model directly for auth; `Profile.role` distinguishes guest vs admin (or just reuse `is_staff` for admin — fewer moving parts).
- No separate `Availability` model — a property's free dates are computed by checking for `Booking` rows that overlap the requested `check_in`–`check_out` range and excluding `cancelled` ones. Simpler and one less thing to keep in sync.

## API Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/auth/register/` | POST | Create a guest account |
| `/api/auth/login/` | POST | Get a JWT access/refresh token pair |
| `/api/auth/refresh/` | POST | Exchange a refresh token for a new access token |
| `/api/properties/` | GET | List properties, filterable by location, guests, price range, check-in/check-out |
| `/api/properties/{id}/` | GET | Property detail + availability |
| `/api/properties/` | POST | Create a property (admin only) |
| `/api/properties/{id}/` | PATCH / DELETE | Edit or deactivate a property (admin only) |
| `/api/bookings/` | GET | List bookings — own bookings for a guest, all bookings for admin |
| `/api/bookings/` | POST | Create a booking |
| `/api/bookings/{id}/` | PATCH | Cancel (guest) or change status (admin) |
| `/api/admin/stats/` | GET | Booking counts, occupancy rate, revenue for the admin dashboard |

All admin-only endpoints are protected by a DRF permission class checking `Profile.role == 'admin'` (or `is_staff`).

## Angular Structure

**Customer-facing routes**

- `/listings` — `PropertyListComponent`: grid + filters (dates, location, guests, price)
- `/listings/:id` — `PropertyDetailComponent`: gallery, amenities, availability calendar, "Book Now"
- `/booking/:propertyId` — `BookingFormComponent`: date picker, live price calc, confirm
- `/my-bookings` — `MyBookingsComponent`: upcoming/past bookings, cancel (auth-guarded)
- `/login`, `/register`

**Admin routes** (behind an `AdminGuard`)

- `/admin/dashboard` — `AdminDashboardComponent`: stat cards (bookings, occupancy, revenue)
- `/admin/properties` — `AdminPropertyListComponent`: CRUD table
- `/admin/properties/:id/edit` — `PropertyFormComponent`
- `/admin/bookings` — `AdminBookingsComponent`: table with status actions

**Shared**

- `NavbarComponent` — role-aware (shows Admin link only for admins)
- `AuthService`, `PropertyService`, `BookingService` — wrap `HttpClient` calls to the DRF API
- `AuthGuard` / `AdminGuard` — route protection

## Day-by-Day Schedule

| Date | Day | Focus |
| --- | --- | --- |
| Sep 24 | Thu | Django project + PostgreSQL (via Docker Compose locally), core models, migrations, Django Admin registration, Faker seed script |
| Sep 25 | Fri | DRF serializers/viewsets, token auth; push to GitHub and deploy the skeleton to Render (Postgres + web service) so hosting is proven early |
| Sep 26 | Sat | Angular setup, routing skeleton, PropertyService/BookingService, Listings page; deploy the Angular build to Render Static Site, confirm it talks to the hosted API |
| Sep 27 | Sun | Property detail page + availability calendar, booking form wired to the API (local + hosted) |
| Sep 28 | Mon | My Bookings page, login/register, AuthGuard; Stripe test-mode payment step on booking confirm |
| Sep 29 | Tue | Admin dashboard stats, admin properties CRUD, admin bookings table; booking-confirmation email via a free SMTP provider |
| Sep 30 | Wed | Responsive/PWA pass (covers the "mobile app" goal), UI polish, realistic seed data, final redeploy, backup demo recording |
| Oct 1 | Thu | **Tech Meetup** — demo locally as primary, hosted URL as the leave-behind link |

## Scope & Cut Order

**Must-have (protect these no matter what):**

- Property listing, detail page, and full booking flow (customer)
- Booking visibility and management for admin — the real custom Angular admin view, not a Django Admin shortcut
- Basic login/register

**Attempt next (build if the schedule allows):**

- Payment: Stripe test-mode checkout on booking confirm — you already know Stripe, so this is a fast win
- Email notifications: booking-confirmation email via a free SMTP provider (e.g. Brevo or Resend)
- Mobile-friendly: responsive layout + PWA manifest — covers the "mobile app" goal without a separate codebase
- Custom Angular admin dashboard with stat cards (bookings, occupancy, revenue)
- Reviews/ratings, favorites, map view
- Revenue chart over time
- Real photo uploads (fallback: fixed stock photo URLs)

**Cut first if behind schedule:**

- Multi-language (Greek/English) — if you get to it at all, fake it fast with two JSON label dictionaries rather than full Angular i18n tooling
- A true native mobile app — the responsive/PWA web app above already covers this need

Hosting is handled above, so the real risk now is time. If a day slips, trim from the bottom of this list first — the core booking flow, admin visibility, and a stable public URL are what make the demo credible to the companies at the meetup.
