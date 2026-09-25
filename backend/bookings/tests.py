import threading
import time
from datetime import date, datetime, time as dt_time, timedelta, timezone as dt_timezone
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from listings.models import Property, PropertyImage

from .models import Booking

User = get_user_model()
PASSWORD = "S3cure-Booking-Pass!"
LIST_URL = reverse("booking-list")


def detail_url(pk):
    return reverse("booking-detail", args=[pk])


def day(n):
    return timezone.localdate() + timedelta(days=n)


class BookingFixtures:
    def make_world(self):
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.other = User.objects.create_user("other", "other@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.prop = Property.objects.create(
            title="Loft", location="Thessaloniki", price_per_night=Decimal("80.00"), capacity=3
        )
        PropertyImage.objects.create(property=self.prop, image="https://img.test/c.jpg", is_cover=True)
        self.prop2 = Property.objects.create(
            title="Villa", location="Chania", price_per_night=Decimal("200.00"), capacity=6
        )

    def book(self, prop=None, start=10, end=13, guest=None, status_=Booking.Status.PENDING):
        prop = prop or self.prop
        return Booking.objects.create(
            property=prop, guest=guest or self.guest, check_in=day(start), check_out=day(end),
            total_price=prop.price_per_night * (end - start), status=status_,
        )

    def payload(self, start=10, end=13, **extra):
        return {"property": self.prop.id, "check_in": day(start).isoformat(),
                "check_out": day(end).isoformat(), "guests": 2, **extra}


# --------------------------------------------------------------------------
# DB-level guarantee (the exclusion constraint itself)
# --------------------------------------------------------------------------

class ExclusionConstraintTests(BookingFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_db_rejects_overlapping_active_bookings(self):
        self.book(start=10, end=15)
        with self.assertRaises(IntegrityError) as ctx, transaction.atomic():
            self.book(start=12, end=20, guest=self.other)
        self.assertEqual(ctx.exception.__cause__.pgcode, "23P01")
        self.assertEqual(ctx.exception.__cause__.diag.constraint_name, "booking_no_overlap_per_property")

    def test_db_allows_back_to_back_other_property_and_cancelled(self):
        self.book(start=10, end=15)
        self.book(start=15, end=18)                                    # arrive on check-out day
        self.book(start=5, end=10)                                     # leave on check-in day
        self.book(prop=self.prop2, start=10, end=15)                   # other property
        self.book(start=11, end=12, status_=Booking.Status.CANCELLED)  # cancelled never blocks
        self.assertEqual(Booking.objects.count(), 5)

    def test_db_rejects_reactivating_into_an_overlap(self):
        self.book(start=10, end=15)
        cancelled = self.book(start=11, end=12, status_=Booking.Status.CANCELLED)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Booking.objects.filter(pk=cancelled.pk).update(status=Booking.Status.PENDING)


# --------------------------------------------------------------------------
# POST /api/bookings/
# --------------------------------------------------------------------------

class CreateBookingTests(BookingFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.client.force_authenticate(self.guest)

    def test_anonymous_cannot_book(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(LIST_URL, self.payload(), format="json").status_code, 401)

    def test_create_computes_price_and_starts_pending(self):
        resp = self.client.post(
            LIST_URL, self.payload(total_price="1.00", status="confirmed", guest=self.other.id), format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["total_price"], "240.00")  # 3 nights x 80, client price ignored
        self.assertEqual(resp.data["status"], "pending")      # client status ignored
        self.assertEqual(resp.data["nights"], 3)
        self.assertEqual(resp.data["guests"], 2)
        self.assertTrue(resp.data["can_cancel"])
        self.assertIsNone(resp.data["guest_email"])
        self.assertEqual(resp.data["property"]["cover_image"], "https://img.test/c.jpg")
        self.assertEqual(Booking.objects.get().guest, self.guest)  # client guest ignored

    def test_overlap_precheck_returns_409(self):
        self.book(start=11, end=12, guest=self.other)
        resp = self.client.post(LIST_URL, self.payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data["code"], "dates_unavailable")

    def test_back_to_back_and_cancelled_are_bookable(self):
        self.book(start=5, end=10, guest=self.other)
        self.book(start=11, end=12, guest=self.other, status_=Booking.Status.CANCELLED)
        self.assertEqual(self.client.post(LIST_URL, self.payload(), format="json").status_code, 201)

    def test_db_constraint_alone_blocks_overlap_and_returns_409(self):
        """Simulates losing the race: the pre-check sees nothing (as it
        would if the other booking committed a moment later), so only the
        exclusion constraint stands in the way - must be a 409, not a 500."""
        self.book(start=11, end=12, guest=self.other)
        with mock.patch.object(Booking.objects, "overlapping", return_value=Booking.objects.none()):
            resp = self.client.post(LIST_URL, self.payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT, resp.data)
        self.assertIn("just booked", resp.data["detail"])
        self.assertEqual(Booking.objects.count(), 1)

    def _deadlock(self):
        from django.db import OperationalError

        class FakePgDeadlock(Exception):
            pgcode = "40P01"  # what psycopg2 puts on the driver error

        exc = OperationalError("deadlock detected")
        exc.__cause__ = FakePgDeadlock()
        return exc

    def test_deadlock_is_retried_once_then_succeeds(self):
        """Truly simultaneous overlapping inserts can deadlock in the
        exclusion check (Postgres aborts one with 40P01). The loser retries."""
        from bookings.serializers import BookingCreateSerializer

        original = BookingCreateSerializer.create
        calls = {"n": 0}

        def flaky(self_, data):
            calls["n"] += 1
            if calls["n"] == 1:
                raise self._deadlock()
            return original(self_, data)

        with mock.patch.object(BookingCreateSerializer, "create", flaky):
            resp = self.client.post(LIST_URL, self.payload(), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(calls["n"], 2)

    def test_repeated_deadlock_is_a_409_not_a_500(self):
        from bookings.serializers import BookingCreateSerializer

        with mock.patch.object(BookingCreateSerializer, "create", side_effect=lambda *a: (_ for _ in ()).throw(self._deadlock())):
            resp = self.client.post(LIST_URL, self.payload(), format="json")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(Booking.objects.count(), 0)

    def test_validation_errors(self):
        self.prop2.is_active = False
        self.prop2.save()
        cases = [
            (self.payload(start=-1, end=2), "check_in"),               # past
            (self.payload(start=366, end=368), "check_in"),            # > 1 year ahead
            (self.payload(start=5, end=5), "check_out"),               # 0 nights
            (self.payload(start=5, end=3), "check_out"),               # reversed
            (self.payload(start=5, end=36), "check_out"),              # 31 nights
            (self.payload(guests=4), "guests"),                        # > capacity 3
            (self.payload(guests=0), "guests"),
            ({**self.payload(), "property": self.prop2.id}, "property"),  # inactive
            ({**self.payload(), "property": 999999}, "property"),
            ({"check_in": day(3).isoformat()}, "property"),
        ]
        for body, field in cases:
            resp = self.client.post(LIST_URL, body, format="json")
            self.assertEqual(resp.status_code, 400, body)
            self.assertIn(field, resp.data, body)
        self.assertEqual(Booking.objects.count(), 0)

    def test_limits_are_inclusive(self):
        self.assertEqual(self.client.post(LIST_URL, self.payload(start=0, end=30), format="json").status_code, 201)
        self.assertEqual(self.client.post(LIST_URL, {**self.payload(start=365, end=366), "property": self.prop2.id},
                                          format="json").status_code, 201)


# --------------------------------------------------------------------------
# GET /api/bookings/
# --------------------------------------------------------------------------

class ListBookingTests(BookingFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.mine_future = self.book(start=10, end=12)
        self.mine_past = self.book(start=-10, end=-7, status_=Booking.Status.CONFIRMED)
        self.mine_now = self.book(start=-1, end=2, status_=Booking.Status.CONFIRMED)
        self.theirs = self.book(prop=self.prop2, start=20, end=22, guest=self.other)

    def ids(self, resp):
        self.assertEqual(resp.status_code, 200, getattr(resp, "data", None))
        return [b["id"] for b in resp.data["results"]]

    def test_anonymous_401(self):
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)

    def test_guest_sees_only_own(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(set(self.ids(self.client.get(LIST_URL))),
                         {self.mine_future.id, self.mine_past.id, self.mine_now.id})
        self.assertEqual(self.client.get(detail_url(self.theirs.id)).status_code, 404)
        self.assertEqual(self.client.get(detail_url(self.mine_past.id)).status_code, 200)

    def test_when_filter_and_order(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"when": "upcoming"})),
                         [self.mine_now.id, self.mine_future.id])  # in-progress counts, soonest first
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"when": "past"})), [self.mine_past.id])

    def test_status_filter_and_bad_params(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"status": "pending"})), [self.mine_future.id])
        self.assertEqual(self.client.get(LIST_URL, {"status": "nope"}).status_code, 400)
        self.assertEqual(self.client.get(LIST_URL, {"when": "later"}).status_code, 400)

    def test_status_comma_list(self):
        self.client.force_authenticate(self.guest)
        cancelled = self.book(start=30, end=31, status_=Booking.Status.CANCELLED)
        ids = set(self.ids(self.client.get(LIST_URL, {"status": "pending,confirmed"})))
        self.assertEqual(ids, {self.mine_future.id, self.mine_past.id, self.mine_now.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"status": "cancelled"})), [cancelled.id])
        # My Bookings' "Upcoming" tab: not checked out yet AND not cancelled
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"when": "upcoming", "status": "pending,confirmed"})),
                         [self.mine_now.id, self.mine_future.id])
        for bad in ["pending,nope", ",", "PENDING"]:
            self.assertEqual(self.client.get(LIST_URL, {"status": bad}).status_code, 400, bad)

    def test_mine_limits_an_admin_to_their_own_bookings(self):
        own = self.book(prop=self.prop2, start=40, end=42, guest=self.admin)
        self.client.force_authenticate(self.admin)
        self.assertEqual(len(self.ids(self.client.get(LIST_URL))), 5)  # everyone's by default
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"mine": "true"})), [own.id])
        self.assertEqual(len(self.ids(self.client.get(LIST_URL, {"mine": "false"}))), 5)
        # for a guest, mine=true changes nothing (they only ever see their own)
        self.client.force_authenticate(self.guest)
        self.assertEqual(len(self.ids(self.client.get(LIST_URL, {"mine": "true"}))), 3)

    def test_admin_sees_all_with_emails_and_property_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(LIST_URL)
        self.assertEqual(len(self.ids(resp)), 4)
        self.assertTrue(all(b["guest_email"] for b in resp.data["results"]))
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"property": self.prop2.id})), [self.theirs.id])

    def test_admin_search_by_guest_email_or_property_title(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "OTHER@"})), [self.theirs.id])   # guest email
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "villa"})), [self.theirs.id])    # property title
        self.assertEqual(len(self.ids(self.client.get(LIST_URL, {"search": "loft"}))), 3)
        self.assertEqual(len(self.ids(self.client.get(LIST_URL, {"search": " "}))), 4)                 # blank = no filter
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "loft", "when": "past"})), [self.mine_past.id])

    def test_guest_search_is_ignored_and_never_leaks(self):
        self.client.force_authenticate(self.guest)
        # searching for another guest's email/property returns only their own bookings, unfiltered
        self.assertEqual(set(self.ids(self.client.get(LIST_URL, {"search": "other@example.com"}))),
                         {self.mine_future.id, self.mine_past.id, self.mine_now.id})
        self.assertNotIn(self.theirs.id, self.ids(self.client.get(LIST_URL, {"search": "villa"})))

    def test_guest_property_filter_does_not_leak(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(set(self.ids(self.client.get(LIST_URL, {"property": self.prop2.id}))),
                         {self.mine_future.id, self.mine_past.id, self.mine_now.id})

    def test_can_cancel_flag(self):
        self.client.force_authenticate(self.guest)
        rows = {b["id"]: b["can_cancel"] for b in self.client.get(LIST_URL).data["results"]}
        self.assertEqual(rows, {self.mine_future.id: True, self.mine_past.id: False, self.mine_now.id: False})

    def test_put_and_delete_not_allowed(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(detail_url(self.mine_future.id)).status_code, 405)
        self.assertEqual(self.client.put(detail_url(self.mine_future.id), {"status": "cancelled"},
                                         format="json").status_code, 405)


# --------------------------------------------------------------------------
# PATCH /api/bookings/{id}/ - status transitions
# --------------------------------------------------------------------------

class StatusTransitionTests(BookingFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def patch(self, booking, new_status, user, **extra):
        self.client.force_authenticate(user)
        return self.client.patch(detail_url(booking.id), {"status": new_status, **extra}, format="json")

    def test_guest_can_cancel_own_before_check_in(self):
        for st in [Booking.Status.PENDING, Booking.Status.CONFIRMED]:
            b = self.book(start=10 + 5 * (st == "confirmed"), end=12 + 5 * (st == "confirmed"), status_=st)
            resp = self.patch(b, "cancelled", self.guest)
            self.assertEqual(resp.status_code, 200, resp.data)
            self.assertEqual(resp.data["status"], "cancelled")

    def test_cancelling_frees_the_dates(self):
        b = self.book(start=10, end=12)
        self.patch(b, "cancelled", self.guest)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(LIST_URL, self.payload(start=10, end=12), format="json").status_code, 201)

    def test_guest_rules(self):
        started = self.book(start=0, end=3, status_=Booking.Status.CONFIRMED)
        self.assertEqual(self.patch(started, "cancelled", self.guest).status_code, 400)   # check-in today
        tomorrow = self.book(prop=self.prop2, start=1, end=2, status_=Booking.Status.CONFIRMED)
        self.assertEqual(self.patch(tomorrow, "cancelled", self.guest).status_code, 400)  # < 48h away
        pending = self.book(start=10, end=12)
        self.assertEqual(self.patch(pending, "confirmed", self.guest).status_code, 400)   # can't self-confirm
        theirs = self.book(prop=self.prop2, start=10, end=12, guest=self.other)
        self.assertEqual(self.patch(theirs, "cancelled", self.guest).status_code, 404)    # not theirs
        cancelled = self.book(start=20, end=22, status_=Booking.Status.CANCELLED)
        self.assertEqual(self.patch(cancelled, "cancelled", self.guest).status_code, 400)

    def test_guest_cancellation_closes_48h_before_check_in(self):
        """Check-in day(3) at 15:00 local -> free cancellation ends day(1)
        at 15:00 local."""
        b = self.book(start=3, end=5, status_=Booking.Status.CONFIRMED)
        deadline = timezone.make_aware(datetime.combine(day(1), dt_time(15, 0)))
        self.assertEqual(b.cancel_deadline(), deadline)

        with mock.patch("django.utils.timezone.now", return_value=deadline - timedelta(minutes=1)):
            self.client.force_authenticate(self.guest)
            row = self.client.get(detail_url(b.id)).data
            self.assertTrue(row["can_cancel"])
            self.assertEqual(datetime.fromisoformat(row["cancel_deadline"]), deadline)

        with mock.patch("django.utils.timezone.now", return_value=deadline):
            self.assertFalse(self.client.get(detail_url(b.id)).data["can_cancel"])
            resp = self.patch(b, "cancelled", self.guest)
            self.assertEqual(resp.status_code, 400)
            self.assertIn("48 hours before check-in", resp.data["status"][0])
            # ...but an admin still can
            self.client.force_authenticate(self.admin)
            self.assertTrue(self.client.get(detail_url(b.id)).data["can_cancel"])
            self.assertEqual(self.patch(b, "cancelled", self.admin).status_code, 200)

        with mock.patch("django.utils.timezone.now", return_value=deadline - timedelta(minutes=1)):
            fresh = self.book(start=3, end=5)
            self.assertEqual(self.patch(fresh, "cancelled", self.guest).status_code, 200)

    def test_deadline_is_exactly_48_real_hours_across_dst(self):
        # EU clocks go forward on 2027-03-28: check-in 29 Mar 15:00 EEST
        # (12:00 UTC) -> deadline 27 Mar 12:00 UTC = 14:00 EET.
        b = Booking(property=self.prop, check_in=date(2027, 3, 29), check_out=date(2027, 3, 31))
        utc = dt_timezone.utc
        # Compare in UTC: subtracting two datetimes that share a tzinfo is
        # wall-clock arithmetic in Python, which would hide the DST hour.
        self.assertEqual(b.check_in_datetime().astimezone(utc) - b.cancel_deadline().astimezone(utc),
                         timedelta(hours=48))
        self.assertEqual(timezone.localtime(b.cancel_deadline()).hour, 14)

    @override_settings(BOOKING_CHECK_IN_TIME="14:00", BOOKING_GUEST_CANCELLATION_HOURS=24)
    def test_rule_is_configurable(self):
        b = Booking(property=self.prop, check_in=day(3), check_out=day(5))
        self.assertEqual(b.cancel_deadline(), timezone.make_aware(datetime.combine(day(2), dt_time(14, 0))))

    def test_admin_transitions(self):
        b = self.book(start=10, end=12)
        self.assertEqual(self.patch(b, "confirmed", self.admin).status_code, 200)
        self.assertEqual(self.patch(b, "confirmed", self.admin).status_code, 400)   # already confirmed
        self.assertEqual(self.patch(b, "pending", self.admin).status_code, 400)     # no going back
        self.assertEqual(self.patch(b, "cancelled", self.admin).status_code, 200)
        for st in ["pending", "confirmed", "cancelled"]:
            self.assertEqual(self.patch(b, st, self.admin).status_code, 400)        # cancelled is final
        started = self.book(start=-1, end=2, status_=Booking.Status.CONFIRMED)
        self.assertEqual(self.patch(started, "cancelled", self.admin).status_code, 200)  # admin may, after check-in

    def test_only_status_is_editable(self):
        b = self.book(start=10, end=12)
        resp = self.patch(b, "cancelled", self.guest, check_out=day(20).isoformat(), total_price="1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("check_out", resp.data)
        b.refresh_from_db()
        self.assertEqual(b.status, "pending")
        self.assertEqual(self.patch(b, "bogus", self.guest).status_code, 400)


# --------------------------------------------------------------------------
# Real concurrency (separate DB connections/threads, committed data)
# --------------------------------------------------------------------------

class ConcurrencyTests(BookingFixtures, TransactionTestCase):
    def setUp(self):
        self.make_world()

    def run_threads(self, targets):
        results, errors = [None] * len(targets), []

        def wrap(i, fn):
            try:
                results[i] = fn()
            except Exception as exc:  # noqa: BLE001 - surfaced below
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=wrap, args=(i, fn)) for i, fn in enumerate(targets)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertEqual(errors, [])
        return results

    def poster(self, user, **payload):
        def go():
            client = APIClient()
            client.force_authenticate(user)
            return client.post(LIST_URL, self.payload(**payload), format="json").status_code
        return go

    def test_both_pass_precheck_only_one_booking_wins(self):
        """Deterministic race: both requests pass the overlapping() pre-check
        before either inserts (a barrier holds them just before the insert),
        so only the exclusion constraint can stop the second one."""
        from bookings.serializers import BookingCreateSerializer

        barrier = threading.Barrier(2, timeout=10)
        original = BookingCreateSerializer.create
        seen = threading.local()

        def create_after_barrier(self_, validated_data):
            # Only the first attempt per request waits: if Postgres resolves
            # the collision with a deadlock abort, the view's single retry
            # must not wait for a partner that already finished.
            if not getattr(seen, "waited", False):
                seen.waited = True
                barrier.wait()
            return original(self_, validated_data)

        with mock.patch.object(BookingCreateSerializer, "create", create_after_barrier):
            codes = self.run_threads([self.poster(self.guest), self.poster(self.other, start=11, end=14)])
        self.assertEqual(sorted(codes), [201, 409])
        self.assertEqual(Booking.objects.exclude(status="cancelled").count(), 1)

    def test_burst_of_simultaneous_requests(self):
        users = [User.objects.create_user(f"u{i}", f"u{i}@example.com", PASSWORD) for i in range(6)]
        codes = self.run_threads([self.poster(u) for u in users])
        self.assertEqual(codes.count(201), 1, codes)
        self.assertEqual(codes.count(409), 5, codes)
        self.assertEqual(Booking.objects.count(), 1)

    def test_concurrent_status_changes_no_lost_update(self):
        """Guest cancel and admin cancel at the same moment: the row lock
        serialises them, so exactly one succeeds and the other is told it's
        already cancelled (without the lock, both would read 'pending' and
        both 'succeed')."""
        from bookings.views import BookingViewSet

        booking = self.book(start=10, end=12)
        original = BookingViewSet._check_transition

        def slow_check(self_, b, new_status):
            original(self_, b, new_status)
            time.sleep(0.5)  # hold the row lock while the other request arrives

        def patcher(user, delay):
            def go():
                time.sleep(delay)
                client = APIClient()
                client.force_authenticate(user)
                return client.patch(detail_url(booking.id), {"status": "cancelled"}, format="json").status_code
            return go

        with mock.patch.object(BookingViewSet, "_check_transition", slow_check):
            codes = self.run_threads([patcher(self.guest, 0), patcher(self.admin, 0.15)])
        self.assertEqual(codes, [200, 400])
        booking.refresh_from_db()
        self.assertEqual(booking.status, "cancelled")


# --------------------------------------------------------------------------
# GET /api/admin/stats/ (TICKET-016)
# --------------------------------------------------------------------------

STATS_URL = reverse("admin-stats")


class AdminStatsTests(APITestCase):
    """Hand-built data with numbers worked out by hand.
    Period 2030-01-01..2030-01-10 = 10 nights (the night of the 10th counts)."""

    PERIOD = {"from": "2030-01-01", "to": "2030-01-10"}

    def setUp(self):
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        mk = lambda title, price, active=True: Property.objects.create(
            title=title, location="X", price_per_night=Decimal(price), capacity=4, is_active=active)
        self.a, self.b = mk("Alpha", "100"), mk("Beta", "50")
        self.c = mk("Gamma (retired)", "80", active=False)
        self.d = mk("Delta (empty)", "70")

        def bk(prop, ci, co, total, st):
            return Booking.objects.create(property=prop, guest=self.guest, check_in=date.fromisoformat(ci),
                                          check_out=date.fromisoformat(co), total_price=Decimal(total), status=st)
        C, P, X = Booking.Status.CONFIRMED, Booking.Status.PENDING, Booking.Status.CANCELLED
        bk(self.a, "2029-12-30", "2030-01-03", "400", C)  # 2 of 4 nights inside -> 200
        bk(self.a, "2030-01-05", "2030-01-08", "300", P)  # pending, 3 nights -> expected 300
        bk(self.a, "2030-01-08", "2030-01-10", "200", X)  # cancelled -> ignored (but counted)
        bk(self.a, "2030-01-10", "2030-01-15", "500", C)  # 1 of 5 nights inside -> 100
        bk(self.b, "2030-01-02", "2030-01-05", "100", C)  # 3 nights, all inside -> 100
        bk(self.b, "2030-01-09", "2030-01-12", "100", C)  # 2 of 3 inside -> 66.666...
        bk(self.c, "2030-01-01", "2030-01-03", "160", C)  # inactive property: revenue yes, occupancy no
        bk(self.b, "2029-12-28", "2030-01-01", "999", C)  # ends as the period starts -> outside
        bk(self.b, "2030-01-12", "2030-01-13", "999", C)  # starts after the period -> outside

    def get(self, params=None, user="admin"):
        self.client.force_authenticate(getattr(self, user) if user else None)
        return self.client.get(STATS_URL, params or {})

    def test_permissions(self):
        self.assertEqual(self.get(user=None).status_code, 401)
        self.assertEqual(self.get(user="guest").status_code, 403)
        self.assertEqual(self.get(self.PERIOD).status_code, 200)

    def test_totals(self):
        data = self.get(self.PERIOD).data
        self.assertEqual(data["period"], {"from": date(2030, 1, 1), "to": date(2030, 1, 10), "nights": 10})
        self.assertEqual(data["bookings"], {"total": 7, "pending": 1, "confirmed": 5, "cancelled": 1,
                                            "created_in_period": 0})
        # Active properties A, B, D -> 30 available nights; confirmed nights
        # inside: A 2+1, B 3+2 = 8 (Gamma's 2 are excluded - retired).
        self.assertEqual(data["occupancy"], {"rate": 0.2667, "booked_nights": 8, "pending_nights": 3,
                                             "available_nights": 30, "active_properties": 3})
        # 200 + 100 + 100 + 66.666.. + 160 = 626.666.. -> rounded once, at the end
        self.assertEqual(data["revenue"], {"confirmed": "626.67", "pending": "300.00"})

    def test_per_property_breakdown(self):
        rows = self.get(self.PERIOD).data["properties"]
        self.assertEqual(
            [(r["title"], r["is_active"], r["booked_nights"], r["pending_nights"], r["occupancy_rate"],
              r["revenue"], r["pending_revenue"]) for r in rows],
            [
                ("Alpha", True, 3, 3, 0.3, "300.00", "300.00"),
                ("Beta", True, 5, 0, 0.5, "166.67", "0.00"),
                ("Gamma (retired)", False, 2, 0, 0.2, "160.00", "0.00"),
                ("Delta (empty)", True, 0, 0, 0.0, "0.00", "0.00"),
            ],
        )

    def test_inactive_property_without_revenue_is_left_out(self):
        self.c.bookings.all().delete()
        titles = [r["title"] for r in self.get(self.PERIOD).data["properties"]]
        self.assertNotIn("Gamma (retired)", titles)

    def test_single_night_period(self):
        data = self.get({"from": "2030-01-10", "to": "2030-01-10"}).data
        self.assertEqual(data["period"]["nights"], 1)
        # A (booking from the 10th) and B (booking 9th-12th) are both occupied that night
        self.assertEqual(data["occupancy"]["booked_nights"], 2)
        self.assertEqual(data["revenue"]["confirmed"], "133.33")  # 100 + 33.33

    def test_default_period_is_current_month(self):
        data = self.get().data
        today = timezone.localdate()
        self.assertEqual(data["period"]["from"], today.replace(day=1))
        self.assertEqual(data["period"]["to"].month, today.month)
        self.assertEqual((data["period"]["to"] + timedelta(days=1)).day, 1)
        self.assertEqual(data["bookings"]["created_in_period"], 9)  # all created today

    def test_no_active_properties_gives_null_rate(self):
        Property.objects.update(is_active=False)
        data = self.get(self.PERIOD).data
        self.assertIsNone(data["occupancy"]["rate"])
        self.assertEqual(data["occupancy"]["available_nights"], 0)

    def test_empty_period(self):
        data = self.get({"from": "2035-06-01", "to": "2035-06-30"}).data
        self.assertEqual(data["bookings"]["total"], 0)
        self.assertEqual(data["occupancy"]["rate"], 0.0)
        self.assertEqual(data["revenue"], {"confirmed": "0.00", "pending": "0.00"})

    def test_bad_params(self):
        for params in [{"from": "2030-01-01"}, {"to": "2030-01-01"},
                       {"from": "2030-01-10", "to": "2030-01-01"},
                       {"from": "2030-01-01", "to": "2031-01-02"},   # 367 days
                       {"from": "2030-02-30", "to": "2030-03-01"}]:
            self.assertEqual(self.get(params).status_code, 400, params)
        self.assertEqual(self.get({"from": "2030-01-01", "to": "2031-01-01"}).status_code, 200)  # 366 ok

    def test_query_count_is_constant(self):
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(STATS_URL, self.PERIOD)
        before = len(ctx.captured_queries)
        for i in range(5):
            p = Property.objects.create(title=f"P{i}", location="X", price_per_night=Decimal("10"), capacity=2)
            Booking.objects.create(property=p, guest=self.guest, check_in=date(2030, 1, 2),
                                   check_out=date(2030, 1, 4), total_price=Decimal("20"),
                                   status=Booking.Status.CONFIRMED)
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(STATS_URL, self.PERIOD)
        self.assertEqual(len(ctx.captured_queries), before)
