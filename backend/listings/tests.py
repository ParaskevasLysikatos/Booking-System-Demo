from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Profile
from bookings.models import Booking
from reviews.models import Review

from .models import Property, PropertyImage

User = get_user_model()
PASSWORD = "S3cure-Booking-Pass!"
LIST_URL = reverse("property-list")


def detail_url(pk):
    return reverse("property-detail", args=[pk])


def make_property(**overrides):
    data = {
        "title": "Seaside Studio",
        "location": "Thessaloniki, Greece",
        "price_per_night": Decimal("80.00"),
        "capacity": 2,
        "amenities": ["wifi"],
    }
    data.update(overrides)
    return Property.objects.create(**data)


class PropertyAPITestBase(APITestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)

        self.thess = make_property(title="Thess Loft", location="Thessaloniki, Greece",
                                   price_per_night=Decimal("60.00"), capacity=2)
        self.athens = make_property(title="Athens Flat", location="Athens, Greece",
                                    price_per_night=Decimal("120.00"), capacity=4)
        self.villa = make_property(title="Chania Villa", location="Chania, Crete",
                                   price_per_night=Decimal("300.00"), capacity=8)
        self.hidden = make_property(title="Retired Room", location="Thessaloniki, Greece",
                                    is_active=False)

        PropertyImage.objects.create(property=self.thess, image="https://img.test/a.jpg")
        PropertyImage.objects.create(property=self.thess, image="https://img.test/b.jpg", is_cover=True)

    def ids(self, resp):
        self.assertEqual(resp.status_code, status.HTTP_200_OK, getattr(resp, "data", None))
        return {p["id"] for p in resp.data["results"]}

    def days(self, n):
        return (self.today + timedelta(days=n)).isoformat()

    def book(self, prop, start, end, status_=Booking.Status.CONFIRMED):
        return Booking.objects.create(
            property=prop, guest=self.guest,
            check_in=self.today + timedelta(days=start),
            check_out=self.today + timedelta(days=end),
            total_price=Decimal("100.00"), status=status_,
        )


class PropertyListTests(PropertyAPITestBase):
    def test_anonymous_list_is_paginated_and_hides_inactive(self):
        resp = self.client.get(LIST_URL)
        self.assertEqual(set(resp.data), {"count", "next", "previous", "results"})
        self.assertEqual(self.ids(resp), {self.thess.id, self.athens.id, self.villa.id})
        self.assertEqual(resp.data["count"], 3)

    def test_list_item_shape_and_cover(self):
        resp = self.client.get(LIST_URL, {"location": "thess"})
        item = resp.data["results"][0]
        self.assertEqual(
            set(item),
            {"id", "title", "location", "price_per_night", "capacity", "amenities",
             "is_active", "cover_image", "rating_avg", "review_count"},
        )
        self.assertEqual(item["cover_image"], "https://img.test/b.jpg")

    def test_page_size(self):
        for i in range(15):
            make_property(title=f"Extra {i}")
        resp = self.client.get(LIST_URL)
        self.assertEqual(len(resp.data["results"]), 12)
        self.assertIsNotNone(resp.data["next"])
        resp = self.client.get(LIST_URL, {"page_size": 5, "page": 2})
        self.assertEqual(len(resp.data["results"]), 5)
        self.assertEqual(len(self.client.get(LIST_URL, {"page_size": 500}).data["results"]), 18)

    def test_filter_location_case_insensitive_partial(self):
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"location": "THESSAL"})), {self.thess.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"location": "greece"})),
                         {self.thess.id, self.athens.id})

    def test_search_matches_title_or_location_case_insensitively(self):
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "loft"})), {self.thess.id})       # title
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "CRETE"})), {self.villa.id})     # location
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "greece"})), {self.thess.id, self.athens.id})
        self.assertEqual(len(self.ids(self.client.get(LIST_URL, {"search": "  "}))), 3)                 # blank = no filter
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "atlantis"})), set())

    def test_admin_search_includes_retired_when_asked(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "retired"})), {self.hidden.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"search": "retired", "is_active": "true"})), set())

    def test_filter_guests(self):
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"guests": 4})), {self.athens.id, self.villa.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"guests": 9})), set())

    def test_filter_price_range_inclusive(self):
        resp = self.client.get(LIST_URL, {"min_price": "60", "max_price": "120"})
        self.assertEqual(self.ids(resp), {self.thess.id, self.athens.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"min_price": "121"})), {self.villa.id})

    def test_filter_dates_excludes_overlapping_bookings(self):
        self.book(self.thess, 10, 15)
        # Overlaps -> thess excluded
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"check_in": self.days(12), "check_out": self.days(20)})),
                         {self.athens.id, self.villa.id})
        # Contained entirely within the booking -> excluded
        self.assertNotIn(self.thess.id, self.ids(self.client.get(
            LIST_URL, {"check_in": self.days(11), "check_out": self.days(13)})))
        # Back-to-back: arriving on the other guest's check-out day is fine
        self.assertIn(self.thess.id, self.ids(self.client.get(
            LIST_URL, {"check_in": self.days(15), "check_out": self.days(18)})))
        # Leaving on the other guest's check-in day is fine too
        self.assertIn(self.thess.id, self.ids(self.client.get(
            LIST_URL, {"check_in": self.days(5), "check_out": self.days(10)})))

    def test_cancelled_bookings_do_not_block(self):
        self.book(self.thess, 10, 15, Booking.Status.CANCELLED)
        self.assertIn(self.thess.id, self.ids(self.client.get(
            LIST_URL, {"check_in": self.days(11), "check_out": self.days(13)})))

    def test_pending_bookings_block(self):
        self.book(self.thess, 10, 15, Booking.Status.PENDING)
        self.assertNotIn(self.thess.id, self.ids(self.client.get(
            LIST_URL, {"check_in": self.days(11), "check_out": self.days(13)})))

    def test_combined_filters(self):
        self.book(self.athens, 3, 6)
        resp = self.client.get(LIST_URL, {"location": "greece", "guests": 2, "max_price": "150",
                                          "check_in": self.days(4), "check_out": self.days(5)})
        self.assertEqual(self.ids(resp), {self.thess.id})

    def test_ordering(self):
        prices = lambda o: [p["price_per_night"] for p in self.client.get(LIST_URL, {"ordering": o}).data["results"]]
        self.assertEqual(prices("price"), ["60.00", "120.00", "300.00"])
        self.assertEqual(prices("-price"), ["300.00", "120.00", "60.00"])

    def test_invalid_params_return_400(self):
        bad = [
            {"guests": "0"},
            {"guests": "lots"},
            {"min_price": "abc"},
            {"min_price": "200", "max_price": "100"},
            {"check_in": self.days(3)},                                   # missing check_out
            {"check_in": self.days(5), "check_out": self.days(5)},        # zero nights
            {"check_in": self.days(5), "check_out": self.days(2)},        # reversed
            {"check_in": self.days(-2), "check_out": self.days(2)},       # in the past
            {"check_in": "2026-13-45", "check_out": self.days(2)},        # not a date
            {"ordering": "title"},
        ]
        for params in bad:
            resp = self.client.get(LIST_URL, params)
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, params)

    def test_rating_annotations(self):
        other = User.objects.create_user("g2", "g2@example.com", PASSWORD)
        Review.objects.create(property=self.thess, guest=self.guest, rating=5, comment="")
        Review.objects.create(property=self.thess, guest=other, rating=4, comment="")
        item = next(p for p in self.client.get(LIST_URL).data["results"] if p["id"] == self.thess.id)
        self.assertEqual(item["rating_avg"], 4.5)
        self.assertEqual(item["review_count"], 2)
        villa = next(p for p in self.client.get(LIST_URL).data["results"] if p["id"] == self.villa.id)
        self.assertIsNone(villa["rating_avg"])
        self.assertEqual(villa["review_count"], 0)

    def test_list_query_count_does_not_grow_with_properties(self):
        for i in range(10):
            p = make_property(title=f"Extra {i}")
            PropertyImage.objects.create(property=p, image=f"https://img.test/{i}.jpg")
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(LIST_URL, {"page_size": 50})
        # count + page + images prefetch; no per-property queries
        self.assertLessEqual(len(ctx.captured_queries), 3)

    def test_guest_is_active_param_ignored_admin_honoured(self):
        self.client.force_authenticate(self.guest)
        self.assertNotIn(self.hidden.id, self.ids(self.client.get(LIST_URL, {"is_active": "false"})))
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.ids(self.client.get(LIST_URL)),
                         {self.thess.id, self.athens.id, self.villa.id, self.hidden.id})
        self.assertEqual(self.ids(self.client.get(LIST_URL, {"is_active": "false"})), {self.hidden.id})
        self.assertNotIn(self.hidden.id, self.ids(self.client.get(LIST_URL, {"is_active": "true"})))


class PropertyDetailTests(PropertyAPITestBase):
    def test_detail_shape_images_and_booked_ranges(self):
        self.book(self.thess, 10, 15)
        self.book(self.thess, 20, 22, Booking.Status.CANCELLED)   # hidden
        self.book(self.thess, -10, -5)                             # past, hidden
        resp = self.client.get(detail_url(self.thess.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([i["image"] for i in resp.data["images"]],
                         ["https://img.test/b.jpg", "https://img.test/a.jpg"])
        self.assertEqual(resp.data["cover_image"], "https://img.test/b.jpg")
        ranges = resp.data["availability"]["booked_ranges"]
        self.assertEqual(len(ranges), 1)
        self.assertEqual(set(ranges[0]), {"check_in", "check_out"})
        self.assertNotIn("is_available", resp.data["availability"])

    def test_detail_is_available_for_requested_dates(self):
        self.book(self.thess, 10, 15)
        busy = self.client.get(detail_url(self.thess.id), {"check_in": self.days(14), "check_out": self.days(16)})
        self.assertFalse(busy.data["availability"]["is_available"])
        free = self.client.get(detail_url(self.thess.id), {"check_in": self.days(15), "check_out": self.days(16)})
        self.assertTrue(free.data["availability"]["is_available"])
        bad = self.client.get(detail_url(self.thess.id), {"check_in": self.days(16), "check_out": self.days(15)})
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_detail_404_for_guest_visible_to_admin(self):
        self.assertEqual(self.client.get(detail_url(self.hidden.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(detail_url(self.hidden.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(detail_url(self.hidden.id)).status_code, status.HTTP_200_OK)


class PropertyWriteTests(PropertyAPITestBase):
    payload = {
        "title": "New Place",
        "description": "Nice",
        "location": "Kavala, Greece",
        "price_per_night": "95.50",
        "capacity": 3,
        "amenities": ["wifi", " WiFi ", "parking", ""],
        "images": [
            {"image": "https://img.test/1.jpg"},
            {"image": "https://img.test/2.jpg", "is_cover": True},
        ],
    }

    def test_anonymous_writes_401(self):
        self.assertEqual(self.client.post(LIST_URL, self.payload, format="json").status_code, 401)
        self.assertEqual(self.client.patch(detail_url(self.thess.id), {"title": "x"}, format="json").status_code, 401)
        self.assertEqual(self.client.delete(detail_url(self.thess.id)).status_code, 401)

    def test_guest_writes_403(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.post(LIST_URL, self.payload, format="json").status_code, 403)
        self.assertEqual(self.client.put(detail_url(self.thess.id), self.payload, format="json").status_code, 403)
        self.assertEqual(self.client.patch(detail_url(self.thess.id), {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(detail_url(self.thess.id)).status_code, 403)
        self.thess.refresh_from_db()
        self.assertEqual(self.thess.title, "Thess Loft")
        self.assertTrue(self.thess.is_active)

    def test_staff_without_admin_role_gets_403(self):
        self.guest.is_staff = True
        self.guest.save()
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.post(LIST_URL, self.payload, format="json").status_code, 403)

    def test_admin_create_with_images(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(LIST_URL, self.payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["amenities"], ["wifi", "parking"])
        self.assertEqual(resp.data["cover_image"], "https://img.test/2.jpg")
        self.assertEqual(resp.data["review_count"], 0)
        prop = Property.objects.get(pk=resp.data["id"])
        self.assertEqual(prop.images.count(), 2)
        self.assertEqual(prop.images.filter(is_cover=True).count(), 1)

    def test_admin_create_validation(self):
        self.client.force_authenticate(self.admin)
        for override in [{"price_per_night": "0"}, {"capacity": 0}, {"title": ""},
                         {"images": [{"image": "not-a-url"}]},
                         {"images": [{"image": "https://a.test/1.jpg", "is_cover": True},
                                     {"image": "https://a.test/2.jpg", "is_cover": True}]}]:
            resp = self.client.post(LIST_URL, {**self.payload, **override}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, override)
        self.assertFalse(Property.objects.filter(title="New Place").exists())

    def test_admin_patch_fields_keeps_images_when_omitted(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(detail_url(self.thess.id), {"price_per_night": "65.00"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["price_per_night"], "65.00")
        self.assertEqual(self.thess.images.count(), 2)

    def test_admin_patch_images_replaces_set(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(detail_url(self.thess.id),
                                 {"images": [{"image": "https://img.test/new.jpg"}]}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual([i["image"] for i in resp.data["images"]], ["https://img.test/new.jpg"])
        self.assertEqual(resp.data["cover_image"], "https://img.test/new.jpg")  # fallback to only image

    def test_admin_delete_is_soft_and_reversible(self):
        self.book(self.thess, 10, 12)  # PROTECT would block a hard delete
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(detail_url(self.thess.id)).status_code, status.HTTP_204_NO_CONTENT)
        self.thess.refresh_from_db()
        self.assertFalse(self.thess.is_active)
        self.assertEqual(self.thess.bookings.count(), 1)
        # Gone for the public...
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail_url(self.thess.id)).status_code, 404)
        # ...and back after reactivation
        self.client.force_authenticate(self.admin)
        self.client.patch(detail_url(self.thess.id), {"is_active": True}, format="json")
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail_url(self.thess.id)).status_code, 200)

    def test_role_checked_from_db_not_token_claim(self):
        # Real JWT flow: log in as guest (token claim role=guest), then get
        # promoted -> writes allowed immediately; demote -> refused again.
        login = self.client.post(reverse("auth-login"), {"email": "guest@example.com", "password": PASSWORD},
                                 format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        url = detail_url(self.thess.id)
        self.assertEqual(self.client.patch(url, {"title": "A"}, format="json").status_code, 403)
        Profile.objects.filter(user=self.guest).update(role=Profile.Role.ADMIN)
        self.assertEqual(self.client.patch(url, {"title": "A"}, format="json").status_code, 200)
        Profile.objects.filter(user=self.guest).update(role=Profile.Role.GUEST)
        self.assertEqual(self.client.patch(url, {"title": "B"}, format="json").status_code, 403)
