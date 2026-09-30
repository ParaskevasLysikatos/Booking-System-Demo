"""TICKET-045: closed dates (BlockedPeriod) - model rules and the admin API."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Profile
from bookings.models import Booking

from .models import BlockedPeriod, Property

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
