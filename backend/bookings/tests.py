import threading
import time
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase
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

    def test_admin_sees_all_with_emails_and_property_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(LIST_URL)
        self.assertEqual(len(self.ids(resp)), 4)
        self.assertTrue(all(b["guest_email"] for b in resp.data["results"]))
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"property": self.prop2.id})), [self.theirs.id])

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
        pending = self.book(start=10, end=12)
        self.assertEqual(self.patch(pending, "confirmed", self.guest).status_code, 400)   # can't self-confirm
        theirs = self.book(prop=self.prop2, start=10, end=12, guest=self.other)
        self.assertEqual(self.patch(theirs, "cancelled", self.guest).status_code, 404)    # not theirs
        cancelled = self.book(start=20, end=22, status_=Booking.Status.CANCELLED)
        self.assertEqual(self.patch(cancelled, "cancelled", self.guest).status_code, 400)

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

        def create_after_barrier(self_, validated_data):
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
