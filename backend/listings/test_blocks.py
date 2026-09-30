"""TICKET-045: closed dates (BlockedPeriod) - model rules, the admin API,
and everything guests see / book respecting them."""

import threading
import time
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from django.test import TransactionTestCase
from rest_framework.test import APIClient, APITestCase

from accounts.models import Profile
from bookings.models import Booking

from .blocks import BlockConflict, create_block
from .models import BlockedPeriod, Property, lock_property

User = get_user_model()
PASSWORD = "S3cure-Booking-Pass!"


class BlockFixtures:
    def setUp(self):
        self.today = timezone.localdate()
        self.admin = User.objects.create_user("admin", "admin@example.com", PASSWORD)
        Profile.objects.filter(user=self.admin).update(role=Profile.Role.ADMIN)
        self.admin.refresh_from_db()
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.prop = Property.objects.create(title="Sea view", location="Thessaloniki",
                                            price_per_night=Decimal("80"), capacity=2)
        self.other = Property.objects.create(title="Old town", location="Thessaloniki",
                                             price_per_night=Decimal("60"), capacity=2)

    def day(self, n):
        return self.today + timedelta(days=n)

    def block(self, start, end, prop=None, note=""):
        return BlockedPeriod.objects.create(property=prop or self.prop, start=self.day(start),
                                            end=self.day(end), note=note)

    def booking(self, check_in, check_out, st=Booking.Status.CONFIRMED, prop=None):
        return Booking.objects.create(property=prop or self.prop, guest=self.guest, check_in=self.day(check_in),
                                      check_out=self.day(check_out), total_price=Decimal("100"), status=st)


class BlockedPeriodModelTests(BlockFixtures, APITestCase):
    def test_end_must_be_after_start(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.block(5, 5)

    def test_two_blocks_of_one_property_never_overlap(self):
        self.block(5, 10)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.block(9, 12)

    def test_back_to_back_blocks_and_other_properties_are_fine(self):
        self.block(5, 10)
        self.block(10, 12)              # end is exclusive, like check-out
        self.block(5, 10, prop=self.other)
        self.assertEqual(BlockedPeriod.objects.count(), 3)

    def test_overlapping_query_is_half_open(self):
        self.block(5, 10)
        q = lambda a, b: BlockedPeriod.objects.overlapping(self.prop, self.day(a), self.day(b)).exists()
        self.assertTrue(q(9, 11))
        self.assertTrue(q(1, 6))
        self.assertTrue(q(6, 7))
        self.assertFalse(q(10, 12))
        self.assertFalse(q(1, 5))

    def test_deleting_the_property_deletes_its_blocks(self):
        self.block(5, 10, prop=self.other)
        self.other.delete()
        self.assertFalse(BlockedPeriod.objects.exists())


@mock.patch("payments.services.release_stale_holds")
class AdminBlocksApiTests(BlockFixtures, APITestCase):
    def url(self, prop=None):
        return reverse("admin-property-blocks", args=[(prop or self.prop).pk])

    def detail_url(self, block, prop=None):
        return reverse("admin-property-block-detail", args=[(prop or self.prop).pk, block.pk])

    def post(self, start, end, note=None, user="admin", **headers):
        self.client.force_authenticate(getattr(self, user) if user else None)
        body = {"start": self.day(start).isoformat(), "end": self.day(end).isoformat()}
        if note is not None:
            body["note"] = note
        return self.client.post(self.url(), body, format="json", **headers)

    # --- who --------------------------------------------------------------

    def test_admins_only(self, _stale):
        self.assertEqual(self.post(1, 3, user=None).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.post(1, 3, user="guest").status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.url()).status_code, status.HTTP_403_FORBIDDEN)
        b = self.block(5, 6)
        self.assertEqual(self.client.delete(self.detail_url(b)).status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(BlockedPeriod.objects.filter(pk=b.pk).exists())
        self.assertFalse(BlockedPeriod.objects.exclude(pk=b.pk).exists())

    def test_unknown_property_is_404(self, _stale):
        self.client.force_authenticate(self.admin)
        url = reverse("admin-property-blocks", args=[999999])
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.post(url, {"start": self.day(1), "end": self.day(2)}).status_code,
                         status.HTTP_404_NOT_FOUND)

    # --- create -----------------------------------------------------------

    def test_close_dates(self, stale):
        res = self.post(3, 6, note="  Painting the kitchen  ")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["start"], self.day(3).isoformat())
        self.assertEqual(res.data["end"], self.day(6).isoformat())
        self.assertEqual(res.data["nights"], 3)
        self.assertEqual(res.data["note"], "Painting the kitchen")
        self.assertEqual(res.data["created_by"], "admin@example.com")
        self.assertEqual(res.data["property"], self.prop.pk)
        block = BlockedPeriod.objects.get()
        self.assertEqual(block.created_by, self.admin)
        stale.assert_called_once_with(self.prop, self.day(3), self.day(6))

    def test_note_is_optional_and_today_can_be_closed(self, _stale):
        res = self.post(0, 1)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["note"], "")

    def test_date_rules(self, _stale):
        cases = [
            ((-1, 2), "start"),        # past
            ((366, 368), "start"),     # more than 365 days ahead
            ((5, 5), "end"),           # empty
            ((5, 4), "end"),           # backwards
            ((1, 367), "end"),         # 366 nights
        ]
        for (start, end), field in cases:
            with self.subTest(start=start, end=end):
                res = self.post(start, end)
                self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn(field, res.data)
        self.assertEqual(self.post(365, 366).status_code, status.HTTP_201_CREATED)   # the edges are fine
        self.assertEqual(self.post(0, 365).status_code, status.HTTP_201_CREATED)     # 365 nights
        self.assertEqual(self.post(1, 3, note="x" * 201).status_code, status.HTTP_400_BAD_REQUEST)

    def test_cant_close_over_a_pending_or_confirmed_booking(self, _stale):
        pending = self.booking(4, 6, Booking.Status.PENDING)
        confirmed = self.booking(8, 9)
        res = self.post(5, 9)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["code"], "booking_overlap")
        self.assertEqual([b["id"] for b in res.data["bookings"]], [pending.pk, confirmed.pk])
        self.assertIn(f"#{pending.pk}", res.data["detail"])
        self.assertIn("Cancel or move those bookings first", res.data["detail"])
        one = self.post(5, 6)
        self.assertIn("Cancel or move the booking first", one.data["detail"])
        self.assertFalse(BlockedPeriod.objects.exists())

    def test_cancelled_and_touching_bookings_dont_stop_it(self, _stale):
        self.booking(4, 7, Booking.Status.CANCELLED)
        self.booking(1, 4)       # checks out the day the block starts
        self.booking(7, 9)       # checks in the day the block ends
        self.booking(4, 7, prop=self.other)
        self.assertEqual(self.post(4, 7).status_code, status.HTTP_201_CREATED)

    def test_cant_overlap_closed_dates(self, _stale):
        self.block(5, 8)
        res = self.post(7, 10)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data["code"], "dates_closed")
        self.assertIn(self.day(5).isoformat(), res.data["detail"])
        self.assertEqual(self.post(8, 10).status_code, status.HTTP_201_CREATED)

    def test_the_check_runs_with_the_property_locked(self, _stale):
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as ctx:
            self.post(3, 5)
        sql = [q["sql"] for q in ctx.captured_queries]
        lock = next(i for i, s in enumerate(sql) if "FOR NO KEY UPDATE" in s)
        check = next(i for i, s in enumerate(sql) if 'FROM "bookings_booking"' in s)
        self.assertLess(lock, check)

    def test_greek_messages(self, _stale):
        self.booking(4, 6)
        res = self.post(5, 7, HTTP_ACCEPT_LANGUAGE="el")
        self.assertEqual(res.data["code"], "booking_overlap")
        self.assertIn("Ακυρώστε ή μετακινήστε την κράτηση", res.data["detail"])
        self.block(10, 12)
        self.assertIn("ήδη κλειστές", self.post(11, 13, HTTP_ACCEPT_LANGUAGE="el").data["detail"])
        self.assertIn("παρελθόν", str(self.post(-1, 1, HTTP_ACCEPT_LANGUAGE="el").data["start"]))

    # --- list / delete ------------------------------------------------------

    def test_list_shows_upcoming_blocks_soonest_first(self, _stale):
        later = self.block(20, 25, note="Own use")
        now = self.block(-2, 1, note="Maintenance")   # in progress: still listed
        self.block(-5, -2)                               # over: not listed
        self.block(3, 4, prop=self.other)                # another property
        self.client.force_authenticate(self.admin)
        res = self.client.get(self.url())
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual([b["id"] for b in res.data], [now.pk, later.pk])
        self.assertEqual(res.data[1]["nights"], 5)
        self.assertEqual(res.data[1]["note"], "Own use")

    def test_remove_reopens_the_dates(self, _stale):
        block = self.block(5, 8)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(self.detail_url(block)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(BlockedPeriod.objects.exists())
        self.assertEqual(self.client.delete(self.detail_url(block)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.post(5, 8).status_code, status.HTTP_201_CREATED)

    def test_remove_checks_the_property_in_the_url(self, _stale):
        block = self.block(5, 8)
        self.client.force_authenticate(self.admin)
        res = self.client.delete(self.detail_url(block, prop=self.other))
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(BlockedPeriod.objects.filter(pk=block.pk).exists())


# --------------------------------------------------------------------------
# Step 2: everything guests see respects closed dates
# --------------------------------------------------------------------------

class GuestsSeeClosedDatesTests(BlockFixtures, APITestCase):
    def detail(self, **params):
        return self.client.get(reverse("property-detail", args=[self.prop.pk]), params)

    def test_closed_dates_look_like_booked_ones_on_the_property_page(self):
        self.booking(10, 12)
        self.block(3, 6, note="Painting the kitchen")
        self.block(-6, -3)                             # over: not shown
        res = self.detail()
        self.assertEqual(res.data["availability"]["booked_ranges"], [
            {"check_in": self.day(3), "check_out": self.day(6)},
            {"check_in": self.day(10), "check_out": self.day(12)},
        ])
        self.assertNotIn("Painting", res.content.decode())   # the note never reaches guests

    def test_is_available_says_no_for_closed_dates(self):
        self.block(3, 6)
        check = lambda a, b: self.detail(check_in=self.day(a), check_out=self.day(b)).data["availability"]["is_available"]
        self.assertFalse(check(5, 8))
        self.assertFalse(check(1, 4))
        self.assertTrue(check(6, 8))       # checking in the day the block ends
        self.assertTrue(check(1, 3))       # checking out the day it starts

    def test_search_by_dates_skips_properties_closed_then(self):
        self.block(3, 6)
        search = lambda a, b: [p["id"] for p in self.client.get(
            reverse("property-list"), {"check_in": self.day(a), "check_out": self.day(b)}).data["results"]]
        self.assertEqual(search(4, 5), [self.other.pk])
        self.assertCountEqual(search(6, 8), [self.prop.pk, self.other.pk])
        pins = self.client.get(reverse("property-map"), {"check_in": self.day(4), "check_out": self.day(5)}).data
        self.assertNotIn(self.prop.pk, [p["id"] for p in pins["results"]])

    def test_removing_the_block_reopens_the_dates_for_guests(self):
        block = self.block(3, 6)
        block.delete()
        res = self.detail(check_in=self.day(3), check_out=self.day(6))
        self.assertTrue(res.data["availability"]["is_available"])
        self.assertEqual(res.data["availability"]["booked_ranges"], [])


class BookingOverClosedDatesTests(BlockFixtures, APITestCase):
    def book(self, a, b, **headers):
        self.client.force_authenticate(self.guest)
        body = {"property": self.prop.pk, "check_in": self.day(a).isoformat(),
                "check_out": self.day(b).isoformat(), "guests": 1}
        return self.client.post(reverse("booking-list"), body, format="json", **headers)

    def test_closed_dates_cant_be_booked_same_answer_as_taken_dates(self):
        from bookings.views import DATES_TAKEN

        self.block(3, 6)
        res = self.book(5, 8)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.json(), {"detail": str(DATES_TAKEN), "code": "dates_unavailable"})
        self.assertFalse(Booking.objects.exists())
        greek = self.book(5, 8, HTTP_ACCEPT_LANGUAGE="el").json()   # .json(): the rendered text
        self.assertEqual(greek["code"], "dates_unavailable")
        self.assertNotEqual(greek["detail"], str(DATES_TAKEN))

    def test_touching_dates_and_reopened_dates_can_be_booked(self):
        block = self.block(3, 6)
        self.assertEqual(self.book(1, 3).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.book(6, 8).status_code, status.HTTP_201_CREATED)
        block.delete()
        self.assertEqual(self.book(3, 6).status_code, status.HTTP_201_CREATED)

    def test_the_closed_dates_check_runs_with_the_property_locked(self):
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(self.book(3, 5).status_code, status.HTTP_201_CREATED)
        sql = [q["sql"] for q in ctx.captured_queries]
        lock = next(i for i, s in enumerate(sql) if "FOR NO KEY UPDATE" in s)
        check = [i for i, s in enumerate(sql) if 'FROM "listings_blockedperiod"' in s]
        insert = next(i for i, s in enumerate(sql) if s.startswith('INSERT INTO "bookings_booking"'))
        self.assertTrue(any(lock < i < insert for i in check), "blocks checked after the lock, before the insert")


class ClosedDatesRaceTests(BlockFixtures, TransactionTestCase):
    """A booking and a block for the same days, at the same moment: the
    property lock makes the second one wait for the first and then see it.
    Each test holds the first one inside its lock for a moment and fires the
    second one meanwhile - without the lock, both would get in."""

    def run_both(self, first, second, started):
        results, errors = {}, []

        def wrap(name, fn):
            try:
                results[name] = fn()
            except Exception as exc:  # noqa: BLE001 - surfaced below
                errors.append(exc)
            finally:
                connection.close()

        def second_after_first_locked():
            self.assertTrue(started.wait(10))
            return second()

        threads = [threading.Thread(target=wrap, args=("first", first)),
                   threading.Thread(target=wrap, args=("second", second_after_first_locked))]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertEqual(errors, [])
        return results

    @staticmethod
    def hold_lock(original, started):
        def locked_then_wait(property_id):
            prop = original(property_id)
            started.set()
            time.sleep(0.5)   # the other request arrives while we hold the lock
            return prop
        return locked_then_wait

    def post_booking(self):
        client = APIClient()
        client.force_authenticate(self.guest)
        return client.post(reverse("booking-list"), {
            "property": self.prop.pk, "check_in": self.day(4).isoformat(),
            "check_out": self.day(6).isoformat(), "guests": 1}, format="json").status_code

    def close_dates(self):
        try:
            create_block(self.prop, self.day(3), self.day(6), "Own use", self.admin)
            return "closed"
        except BlockConflict as conflict:
            return conflict.body["code"]

    def test_block_first_then_booking(self):
        started = threading.Event()
        with mock.patch("listings.blocks.lock_property", self.hold_lock(lock_property, started)):
            results = self.run_both(self.close_dates, self.post_booking, started)
        self.assertEqual(results, {"first": "closed", "second": 409})
        self.assertFalse(Booking.objects.exists())

    def test_booking_first_then_block(self):
        started = threading.Event()
        with mock.patch("bookings.views.lock_property", self.hold_lock(lock_property, started)):
            results = self.run_both(self.post_booking, self.close_dates, started)
        self.assertEqual(results, {"first": 201, "second": "booking_overlap"})
        self.assertFalse(BlockedPeriod.objects.exists())


# --------------------------------------------------------------------------
# Step 2: occupancy leaves closed nights out
# --------------------------------------------------------------------------

class OccupancyWithClosedDatesTests(BlockFixtures, APITestCase):
    """Period 2030-01-01..2030-01-10 = 10 nights, two active properties."""

    def setUp(self):
        super().setUp()
        d = lambda s: timezone.datetime.fromisoformat(s).date()
        mk = lambda prop, a, b: BlockedPeriod.objects.create(property=prop, start=d(a), end=d(b))
        Booking.objects.create(property=self.prop, guest=self.guest, check_in=d("2030-01-01"),
                               check_out=d("2030-01-04"), total_price=Decimal("240"),
                               status=Booking.Status.CONFIRMED)                    # 3 nights
        mk(self.prop, "2030-01-08", "2030-01-15")      # 3 of 7 nights inside the period
        mk(self.prop, "2029-12-20", "2029-12-25")      # outside
        retired = Property.objects.create(title="Retired", location="X", price_per_night=Decimal("10"),
                                          capacity=1, is_active=False)
        mk(retired, "2030-01-02", "2030-01-05")         # inactive property: not in occupancy
        self.client.force_authenticate(self.admin)
        self.data = self.client.get(reverse("admin-stats"), {"from": "2030-01-01", "to": "2030-01-10"}).data

    def test_totals(self):
        occ = self.data["occupancy"]
        self.assertEqual(occ["closed_nights"], 3)
        self.assertEqual(occ["available_nights"], 2 * 10 - 3)
        self.assertEqual(occ["booked_nights"], 3)
        self.assertEqual(occ["rate"], round(3 / 17, 4))

    def test_per_property(self):
        rows = {r["id"]: r for r in self.data["properties"]}
        self.assertEqual(rows[self.prop.pk]["closed_nights"], 3)
        self.assertEqual(rows[self.prop.pk]["occupancy_rate"], round(3 / 7, 4))
        self.assertEqual(rows[self.other.pk]["closed_nights"], 0)
        self.assertEqual(rows[self.other.pk]["occupancy_rate"], 0)

    def test_revenue_is_unchanged(self):
        self.assertEqual(self.data["revenue"]["confirmed"], "240.00")


# --------------------------------------------------------------------------
# Step 2: the demo seed closes one period
# --------------------------------------------------------------------------

class SeedClosedDatesTests(APITestCase):
    def test_the_seed_closes_three_free_nights_of_an_active_property(self):
        from io import StringIO

        from django.core.management import call_command

        call_command("seed_demo_data", "--properties", "6", "--guests", "2", "--seed", "3", stdout=StringIO())
        block = BlockedPeriod.objects.get()
        self.assertTrue(block.property.is_active)
        self.assertEqual((block.end - block.start).days, 3)
        self.assertGreaterEqual(block.start, timezone.localdate() + timedelta(days=14))
        self.assertEqual(block.note, "Maintenance")
        self.assertIsNotNone(block.created_by)
        self.assertFalse(Booking.objects.overlapping(block.property, block.start, block.end).exists())
