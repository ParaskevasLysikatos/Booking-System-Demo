"""Reviews API (TICKET-032).

Rule under test: a guest may review a property once a *confirmed* booking
there has checked out; one review per guest per property; reviews are
final (no edit/delete); admins can hide a review and show it again, and a
hidden review disappears from the public list and from the rating.
"""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test.utils import CaptureQueriesContext
from django.db import connection
from django.urls import reverse
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.test import APIRequestFactory, APITestCase

from bookings.models import Booking
from listings.models import Property

from .models import Review, has_finished_stay
from .serializers import MAX_COMMENT_LENGTH, ReviewCreateSerializer, author_name

User = get_user_model()
PASSWORD = "S3cure-Review-Pass!"
CREATE_URL = reverse("review-list")
ADMIN_URL = reverse("admin-review-list")


def day(n):
    return timezone.localdate() + timedelta(days=n)


def property_reviews_url(pk):
    return reverse("property-reviews", args=[pk])


def admin_detail_url(pk):
    return reverse("admin-review-detail", args=[pk])


class ReviewFixtures:
    def make_world(self):
        self.guest = User.objects.create_user(
            "guest", "guest@example.com", PASSWORD, first_name="Maria", last_name="konstantinou"
        )
        self.other = User.objects.create_user("other", "other@example.com", PASSWORD, first_name="Nikos")
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.prop = Property.objects.create(
            title="Loft", location="Thessaloniki", price_per_night=Decimal("80.00"), capacity=3
        )
        self.prop2 = Property.objects.create(
            title="Villa", location="Chania", price_per_night=Decimal("200.00"), capacity=6
        )

    def stay(self, guest=None, prop=None, start=-5, end=-2, status_=Booking.Status.CONFIRMED):
        prop = prop or self.prop
        return Booking.objects.create(
            property=prop, guest=guest or self.guest, check_in=day(start), check_out=day(end),
            total_price=prop.price_per_night * (end - start), status=status_,
        )

    def review(self, guest=None, prop=None, rating=5, comment="Great", hidden=False):
        return Review.objects.create(
            property=prop or self.prop, guest=guest or self.guest, rating=rating, comment=comment, is_hidden=hidden
        )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


class AuthorNameTests(APITestCase):
    def test_first_name_and_last_initial(self):
        self.assertEqual(author_name(User(first_name="Maria", last_name="konstantinou")), "Maria K.")

    def test_first_name_only(self):
        self.assertEqual(author_name(User(first_name="Nikos", last_name="")), "Nikos")

    def test_no_name_falls_back_to_guest(self):
        self.assertEqual(author_name(User(first_name=" ", last_name="Papas", email="x@y.z")), "Guest")


class EligibilityTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_confirmed_ended_stay_counts(self):
        self.stay()
        self.assertTrue(has_finished_stay(self.guest, self.prop.id))

    def test_check_out_today_counts(self):
        self.stay(start=-3, end=0)
        self.assertTrue(has_finished_stay(self.guest, self.prop.id))

    def test_pending_cancelled_and_future_stays_dont(self):
        self.stay(status_=Booking.Status.PENDING)
        self.stay(start=-12, end=-9, status_=Booking.Status.CANCELLED)
        self.stay(start=5, end=8)
        self.stay(start=-1, end=2)  # in progress
        self.assertFalse(has_finished_stay(self.guest, self.prop.id))

    def test_other_property_or_guest_doesnt(self):
        self.stay(prop=self.prop2)
        self.stay(guest=self.other)
        self.assertFalse(has_finished_stay(self.guest, self.prop.id))


# --------------------------------------------------------------------------
# GET /api/properties/{id}/reviews/
# --------------------------------------------------------------------------


class PropertyReviewsListTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_public_list_with_summary(self):
        self.review(rating=5)
        self.review(guest=self.other, rating=3, comment="OK")
        self.review(guest=self.admin, rating=1, hidden=True)
        self.review(prop=self.prop2, rating=2)

        res = self.client.get(property_reviews_url(self.prop.id))

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["count"], 2)
        self.assertEqual([r["rating"] for r in res.data["results"]], [3, 5])  # newest first
        self.assertEqual(
            set(res.data["results"][0]), {"id", "rating", "comment", "author_name", "created_at"}
        )
        self.assertEqual(res.data["results"][1]["author_name"], "Maria K.")
        self.assertNotIn("guest@example.com", str(res.data))
        summary = res.data["summary"]
        self.assertEqual(summary["rating_avg"], 4.0)
        self.assertEqual(summary["review_count"], 2)
        self.assertEqual(
            summary["breakdown"],
            [{"rating": 5, "count": 1}, {"rating": 4, "count": 0}, {"rating": 3, "count": 1},
             {"rating": 2, "count": 0}, {"rating": 1, "count": 0}],
        )

    def test_no_reviews(self):
        res = self.client.get(property_reviews_url(self.prop.id))
        self.assertEqual(res.data["count"], 0)
        self.assertIsNone(res.data["summary"]["rating_avg"])
        self.assertEqual(res.data["summary"]["review_count"], 0)

    def test_paginated_five_per_page_summary_covers_all(self):
        for i in range(7):
            u = User.objects.create_user(f"u{i}", f"u{i}@example.com", PASSWORD)
            self.review(guest=u, rating=4)
        res = self.client.get(property_reviews_url(self.prop.id))
        self.assertEqual(len(res.data["results"]), 5)
        self.assertIsNotNone(res.data["next"])
        self.assertEqual(res.data["summary"]["review_count"], 7)
        page2 = self.client.get(property_reviews_url(self.prop.id), {"page": 2})
        self.assertEqual(len(page2.data["results"]), 2)

    def test_inactive_property_404_except_admin(self):
        self.prop.is_active = False
        self.prop.save()
        self.assertEqual(self.client.get(property_reviews_url(self.prop.id)).status_code, 404)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(property_reviews_url(self.prop.id)).status_code, 200)

    def test_unknown_property_404(self):
        self.assertEqual(self.client.get(property_reviews_url(99999)).status_code, 404)

    def test_constant_query_count(self):
        for i in range(5):
            u = User.objects.create_user(f"q{i}", f"q{i}@example.com", PASSWORD, first_name="Q")
            self.review(guest=u)
        with CaptureQueriesContext(connection) as ctx:
            self.client.get(property_reviews_url(self.prop.id))
        # property + count + page (guest joined) + summary
        self.assertLessEqual(len(ctx.captured_queries), 4)


class HiddenReviewsInPropertyRatingTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.review(rating=5)
        self.review(guest=self.other, rating=1, hidden=True)

    def test_list_and_detail_rating_ignore_hidden(self):
        listing = self.client.get(reverse("property-list"))
        row = next(p for p in listing.data["results"] if p["id"] == self.prop.id)
        self.assertEqual((row["rating_avg"], row["review_count"]), (5.0, 1))
        detail = self.client.get(reverse("property-detail", args=[self.prop.id]))
        self.assertEqual((detail.data["rating_avg"], detail.data["review_count"]), (5.0, 1))


# --------------------------------------------------------------------------
# POST /api/reviews/
# --------------------------------------------------------------------------


class CreateReviewTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.client.force_authenticate(self.guest)

    def post(self, **extra):
        return self.client.post(
            CREATE_URL, {"property": self.prop.id, "rating": 4, "comment": "  Lovely view  ", **extra}, format="json"
        )

    def test_anonymous_401(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.post().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_after_confirmed_stay_201(self):
        self.stay()
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["rating"], 4)
        self.assertEqual(res.data["comment"], "Lovely view")
        self.assertEqual(res.data["author_name"], "Maria K.")
        review = Review.objects.get()
        self.assertEqual((review.guest, review.property, review.is_hidden), (self.guest, self.prop, False))

    def test_comment_optional(self):
        self.stay()
        res = self.client.post(CREATE_URL, {"property": self.prop.id, "rating": 5}, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["comment"], "")

    def test_guest_field_ignored(self):
        self.stay()
        self.post(guest=self.other.id)
        self.assertEqual(Review.objects.get().guest, self.guest)

    def test_without_ended_confirmed_stay_400(self):
        cases = [
            dict(status_=Booking.Status.PENDING),
            dict(status_=Booking.Status.CANCELLED),
            dict(start=3, end=6),
            dict(start=-1, end=2),
            dict(prop=self.prop2),
            dict(guest=self.other),
        ]
        for kwargs in cases:
            with self.subTest(**{k: str(v) for k, v in kwargs.items()}):
                Booking.objects.all().delete()
                self.stay(**kwargs)
                res = self.post()
                self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn("confirmed stay", str(res.data["non_field_errors"]))
        self.assertFalse(Review.objects.exists())

    def test_second_review_rejected_even_if_first_hidden(self):
        self.stay()
        self.review(rating=2, hidden=True)
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already reviewed", str(res.data["non_field_errors"]))
        self.assertEqual(Review.objects.count(), 1)

    def test_invalid_values_400(self):
        self.stay()
        for bad in [{"rating": 0}, {"rating": 6}, {"rating": "x"}, {"comment": "a" * (MAX_COMMENT_LENGTH + 1)},
                    {"property": 99999}]:
            with self.subTest(bad=str(bad)[:40]):
                self.assertEqual(self.post(**bad).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Review.objects.exists())

    def test_inactive_property_400(self):
        self.stay()
        self.prop.is_active = False
        self.prop.save()
        res = self.post()
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("property", res.data)

    def test_race_integrity_error_becomes_400(self):
        # Both requests passed validate(); the second create() hits the DB
        # unique constraint and must answer 400, not 500.
        self.stay()
        request = APIRequestFactory().post(CREATE_URL)
        request.user = self.guest
        s = ReviewCreateSerializer(data={"property": self.prop.id, "rating": 5}, context={"request": request})
        self.assertTrue(s.is_valid(), s.errors)
        self.review()
        with self.assertRaises(serializers.ValidationError) as ctx:
            s.save()
        self.assertIn("already reviewed", str(ctx.exception.detail))

    def test_reviews_are_final(self):
        self.stay()
        review = self.review()
        detail = f"{CREATE_URL}{review.id}/"
        self.assertEqual(self.client.get(CREATE_URL).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        for method in ("put", "patch", "delete"):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.client, method)(detail, {"rating": 1}, format="json").status_code, 404)
        review.refresh_from_db()
        self.assertEqual(review.rating, 5)


# --------------------------------------------------------------------------
# viewer_review on the property detail, can_review/my_review on bookings
# --------------------------------------------------------------------------


class ViewerReviewTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.url = reverse("property-detail", args=[self.prop.id])

    def test_anonymous(self):
        self.assertEqual(self.client.get(self.url).data["viewer_review"], {"can_review": False, "my_review": None})

    def test_no_stay(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(self.url).data["viewer_review"], {"can_review": False, "my_review": None})

    def test_eligible_then_reviewed(self):
        self.stay()
        self.client.force_authenticate(self.guest)
        self.assertTrue(self.client.get(self.url).data["viewer_review"]["can_review"])
        self.client.post(CREATE_URL, {"property": self.prop.id, "rating": 4, "comment": "Nice"}, format="json")
        viewer = self.client.get(self.url).data["viewer_review"]
        self.assertFalse(viewer["can_review"])
        self.assertEqual((viewer["my_review"]["rating"], viewer["my_review"]["comment"]), (4, "Nice"))


class BookingReviewFieldsTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def rows(self, **params):
        res = self.client.get(reverse("booking-list"), params)
        return {b["id"]: b for b in res.data["results"]}

    def test_own_bookings(self):
        past = self.stay()
        pending_past = self.stay(start=-20, end=-18, status_=Booking.Status.PENDING)
        future = self.stay(start=10, end=12)
        other_prop = self.stay(prop=self.prop2, start=-9, end=-7)
        self.review(prop=self.prop2, rating=3)
        self.client.force_authenticate(self.guest)

        rows = self.rows()

        self.assertTrue(rows[past.id]["can_review"])
        self.assertIsNone(rows[past.id]["my_review"])
        self.assertFalse(rows[pending_past.id]["can_review"])
        self.assertFalse(rows[future.id]["can_review"])
        self.assertFalse(rows[other_prop.id]["can_review"])
        self.assertEqual(rows[other_prop.id]["my_review"]["rating"], 3)

    def test_admin_sees_nothing_for_other_guests(self):
        booking = self.stay()
        self.review(rating=4)
        self.client.force_authenticate(self.admin)
        row = self.rows()[booking.id]
        self.assertEqual((row["can_review"], row["my_review"]), (False, None))

    def test_one_review_query_per_list(self):
        for i in range(4):
            self.stay(start=-40 + i * 5, end=-38 + i * 5)
        self.client.force_authenticate(self.guest)
        with CaptureQueriesContext(connection) as few:
            self.rows()
        for i in range(4):
            self.stay(prop=self.prop2, start=-40 + i * 5, end=-38 + i * 5)
        with CaptureQueriesContext(connection) as more:
            self.rows()
        self.assertEqual(len(few.captured_queries), len(more.captured_queries))


# --------------------------------------------------------------------------
# /api/admin/reviews/
# --------------------------------------------------------------------------


class AdminReviewsTests(ReviewFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.r1 = self.review(rating=5, comment="Spotless")
        self.r2 = self.review(guest=self.other, rating=1, comment="Noisy street", hidden=True)
        self.r3 = self.review(guest=self.other, prop=self.prop2, rating=3, comment="Fine")
        self.client.force_authenticate(self.admin)

    def ids(self, **params):
        res = self.client.get(ADMIN_URL, params)
        self.assertEqual(res.status_code, 200, res.data)
        return [r["id"] for r in res.data["results"]]

    def test_permissions(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(ADMIN_URL).status_code, 401)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(ADMIN_URL).status_code, 403)
        self.assertEqual(
            self.client.patch(admin_detail_url(self.r1.id), {"is_hidden": True}, format="json").status_code, 403
        )

    def test_list_includes_hidden_newest_first(self):
        res = self.client.get(ADMIN_URL)
        self.assertEqual([r["id"] for r in res.data["results"]], [self.r3.id, self.r2.id, self.r1.id])
        row = res.data["results"][1]
        self.assertEqual(row["guest_email"], "other@example.com")
        self.assertEqual(row["property"], {"id": self.prop.id, "title": "Loft"})
        self.assertTrue(row["is_hidden"])

    def test_filters(self):
        self.assertEqual(self.ids(rating=1), [self.r2.id])
        self.assertEqual(self.ids(property=self.prop2.id), [self.r3.id])
        self.assertEqual(self.ids(hidden="true"), [self.r2.id])
        self.assertEqual(self.ids(hidden="false"), [self.r3.id, self.r1.id])
        self.assertEqual(self.ids(search="noisy"), [self.r2.id])
        self.assertEqual(self.ids(search="maria"), [self.r1.id])
        self.assertEqual(self.ids(search="villa"), [self.r3.id])

    def test_bad_filters_400(self):
        for params in ({"rating": 9}, {"hidden": "maybe"}, {"property": "x"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get(ADMIN_URL, params).status_code, 400)

    def test_hide_and_unhide(self):
        res = self.client.patch(admin_detail_url(self.r1.id), {"is_hidden": True}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_hidden"])
        public = self.client.get(property_reviews_url(self.prop.id))
        self.assertEqual(public.data["count"], 0)

        self.client.patch(admin_detail_url(self.r1.id), {"is_hidden": False}, format="json")
        public = self.client.get(property_reviews_url(self.prop.id))
        self.assertEqual([r["id"] for r in public.data["results"]], [self.r1.id])

    def test_only_is_hidden_is_writable(self):
        self.client.patch(admin_detail_url(self.r1.id), {"rating": 1, "comment": "edited"}, format="json")
        self.r1.refresh_from_db()
        self.assertEqual((self.r1.rating, self.r1.comment), (5, "Spotless"))

    def test_no_put_or_delete(self):
        self.assertEqual(self.client.put(admin_detail_url(self.r1.id), {"is_hidden": True}, format="json").status_code, 405)
        self.assertEqual(self.client.delete(admin_detail_url(self.r1.id)).status_code, 405)
        self.assertTrue(Review.objects.filter(pk=self.r1.id).exists())
