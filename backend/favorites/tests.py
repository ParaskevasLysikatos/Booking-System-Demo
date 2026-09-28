"""Favorites API (TICKET-033).

Rules under test: only logged-in users save; one favorite per user per
property; PUT/DELETE are safe to repeat; only active properties can be
saved, but a saved one that gets deactivated stays on the Saved page
(is_active: false) and can still be removed; `is_favorite` is per caller
on the listings/detail responses; `favorite_count` is admin-only.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from listings.models import Property, PropertyImage
from reviews.models import Review

from .models import Favorite

User = get_user_model()
PASSWORD = "S3cure-Favorite-Pass!"
LIST_URL = reverse("favorite-list")
PROPERTIES_URL = reverse("property-list")


def fav_url(property_id):
    return reverse("favorite-detail", args=[property_id])


def property_url(property_id):
    return reverse("property-detail", args=[property_id])


class FavoriteFixtures:
    def make_world(self):
        self.guest = User.objects.create_user("guest", "guest@example.com", PASSWORD)
        self.other = User.objects.create_user("other", "other@example.com", PASSWORD)
        self.admin = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.loft = self.make_property("Loft", "80.00")
        self.villa = self.make_property("Villa", "200.00")
        self.studio = self.make_property("Studio", "50.00")

    @staticmethod
    def make_property(title, price, active=True):
        prop = Property.objects.create(
            title=title, location="Thessaloniki", price_per_night=Decimal(price), capacity=2, is_active=active
        )
        PropertyImage.objects.create(property=prop, image=f"https://example.com/{title}.jpg", is_cover=True)
        return prop

    def save(self, prop, user=None):
        return Favorite.objects.create(user=user or self.guest, property=prop)


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------


class FavoriteModelTests(FavoriteFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_one_favorite_per_user_per_property(self):
        self.save(self.loft)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.save(self.loft)

    def test_other_users_can_save_the_same_property(self):
        self.save(self.loft)
        self.save(self.loft, user=self.other)
        self.assertEqual(Favorite.objects.filter(property=self.loft).count(), 2)

    def test_deleting_the_user_removes_their_favorites(self):
        self.save(self.loft)
        self.guest.delete()
        self.assertFalse(Favorite.objects.exists())

    def test_deactivating_a_property_keeps_the_favorite(self):
        self.save(self.loft)
        self.loft.is_active = False
        self.loft.save()
        self.assertTrue(Favorite.objects.filter(user=self.guest, property=self.loft).exists())


# --------------------------------------------------------------------------
# PUT / DELETE /api/favorites/{property_id}/
# --------------------------------------------------------------------------


class SaveAndRemoveTests(FavoriteFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_anonymous_cannot_save_or_remove(self):
        self.assertEqual(self.client.put(fav_url(self.loft.id)).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.delete(fav_url(self.loft.id)).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Favorite.objects.exists())

    def test_save_returns_201_the_first_time(self):
        self.client.force_authenticate(self.guest)
        res = self.client.put(fav_url(self.loft.id))
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["property"], self.loft.id)
        self.assertTrue(res.data["is_favorite"])
        self.assertIsNotNone(res.data["saved_at"])
        self.assertTrue(Favorite.objects.filter(user=self.guest, property=self.loft).exists())

    def test_saving_again_is_200_and_keeps_one_row_and_the_first_date(self):
        self.client.force_authenticate(self.guest)
        first = self.client.put(fav_url(self.loft.id))
        again = self.client.put(fav_url(self.loft.id))
        self.assertEqual(again.status_code, status.HTTP_200_OK)
        self.assertEqual(again.data["saved_at"], first.data["saved_at"])
        self.assertEqual(Favorite.objects.filter(user=self.guest, property=self.loft).count(), 1)

    def test_saved_at_matches_the_saved_list_format(self):
        self.client.force_authenticate(self.guest)
        saved = self.client.put(fav_url(self.loft.id)).data["saved_at"]
        self.assertEqual(saved, self.client.get(LIST_URL).data["results"][0]["saved_at"])

    def test_cannot_save_an_inactive_property(self):
        hidden = self.make_property("Hidden", "90.00", active=False)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.put(fav_url(hidden.id)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Favorite.objects.exists())

    def test_cannot_save_an_unknown_property(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.put(fav_url(999999)).status_code, status.HTTP_404_NOT_FOUND)

    def test_body_is_ignored_so_nobody_can_save_for_someone_else(self):
        self.client.force_authenticate(self.guest)
        self.client.put(fav_url(self.loft.id), {"user": self.other.id, "property": self.villa.id}, format="json")
        self.assertEqual(list(Favorite.objects.values_list("user_id", "property_id")), [(self.guest.id, self.loft.id)])

    def test_remove_returns_204(self):
        self.save(self.loft)
        self.client.force_authenticate(self.guest)
        res = self.client.delete(fav_url(self.loft.id))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Favorite.objects.exists())

    def test_removing_twice_or_something_never_saved_is_still_204(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.delete(fav_url(self.loft.id)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.delete(fav_url(999999)).status_code, status.HTTP_204_NO_CONTENT)

    def test_can_remove_a_property_that_was_deactivated_after_saving(self):
        self.save(self.loft)
        Property.objects.filter(pk=self.loft.pk).update(is_active=False)
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.delete(fav_url(self.loft.id)).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Favorite.objects.exists())

    def test_removing_only_touches_the_callers_favorite(self):
        self.save(self.loft)
        self.save(self.loft, user=self.other)
        self.client.force_authenticate(self.guest)
        self.client.delete(fav_url(self.loft.id))
        self.assertEqual(list(Favorite.objects.values_list("user_id", flat=True)), [self.other.id])

    def test_other_methods_are_not_allowed(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.client.get(fav_url(self.loft.id)).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(self.client.post(LIST_URL, {"property": self.loft.id}).status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


# --------------------------------------------------------------------------
# GET /api/favorites/
# --------------------------------------------------------------------------


class SavedListTests(FavoriteFixtures, APITestCase):
    def setUp(self):
        self.make_world()

    def test_anonymous_gets_401(self):
        self.assertEqual(self.client.get(LIST_URL).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_empty_list(self):
        self.client.force_authenticate(self.guest)
        res = self.client.get(LIST_URL)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["count"], 0)
        self.assertEqual(res.data["results"], [])

    def test_only_the_callers_favorites_newest_first(self):
        self.client.force_authenticate(self.guest)
        for prop in (self.loft, self.villa, self.studio):
            self.client.put(fav_url(prop.id))
        self.save(self.villa, user=self.other)
        self.client.delete(fav_url(self.villa.id))
        res = self.client.get(LIST_URL)
        self.assertEqual([p["title"] for p in res.data["results"]], ["Studio", "Loft"])

    def test_cards_have_the_listing_shape_plus_saved_at(self):
        Review.objects.create(property=self.loft, guest=self.other, rating=4)
        Review.objects.create(property=self.loft, guest=self.admin, rating=5)
        self.save(self.loft)
        self.client.force_authenticate(self.guest)
        card = self.client.get(LIST_URL).data["results"][0]
        listing_card = self.client.get(PROPERTIES_URL).data["results"]
        listing_card = next(p for p in listing_card if p["id"] == self.loft.id)
        self.assertEqual(set(card) - set(listing_card), {"saved_at"})
        self.assertEqual(card["cover_image"], "https://example.com/Loft.jpg")
        self.assertEqual(card["rating_avg"], 4.5)
        self.assertEqual(card["review_count"], 2)
        self.assertTrue(card["is_favorite"])
        self.assertTrue(card["is_active"])
        self.assertNotIn("favorite_count", card)

    def test_deactivated_properties_stay_in_the_list_marked_inactive(self):
        self.save(self.loft)
        self.save(self.villa)
        Property.objects.filter(pk=self.loft.pk).update(is_active=False)
        self.client.force_authenticate(self.guest)
        res = self.client.get(LIST_URL)
        self.assertEqual(res.data["count"], 2)
        by_title = {p["title"]: p for p in res.data["results"]}
        self.assertFalse(by_title["Loft"]["is_active"])
        self.assertTrue(by_title["Villa"]["is_active"])

    def test_paginated_12_per_page(self):
        for i in range(14):
            self.save(self.make_property(f"Place {i}", "60.00"))
        self.client.force_authenticate(self.guest)
        first = self.client.get(LIST_URL).data
        self.assertEqual(first["count"], 14)
        self.assertEqual(len(first["results"]), 12)
        second = self.client.get(LIST_URL, {"page": 2}).data
        self.assertEqual(len(second["results"]), 2)
        ids = [p["id"] for p in first["results"] + second["results"]]
        self.assertEqual(len(set(ids)), 14)

    def test_query_count_does_not_grow_with_the_page(self):
        self.client.force_authenticate(self.guest)
        self.save(self.loft)
        with CaptureQueriesContext(connection) as small:
            self.client.get(LIST_URL)
        for i in range(8):
            prop = self.make_property(f"Place {i}", "60.00")
            Review.objects.create(property=prop, guest=self.other, rating=3)
            self.save(prop)
        with CaptureQueriesContext(connection) as big:
            self.client.get(LIST_URL)
        self.assertEqual(len(big), len(small))


# --------------------------------------------------------------------------
# is_favorite / favorite_count on /api/properties/
# --------------------------------------------------------------------------


class PropertyFavoriteFieldsTests(FavoriteFixtures, APITestCase):
    def setUp(self):
        self.make_world()
        self.save(self.loft)
        self.save(self.loft, user=self.other)
        self.save(self.villa, user=self.other)

    def flags(self):
        return {p["title"]: p["is_favorite"] for p in self.client.get(PROPERTIES_URL).data["results"]}

    def test_anonymous_sees_false_everywhere(self):
        self.assertEqual(self.flags(), {"Loft": False, "Villa": False, "Studio": False})
        self.assertFalse(self.client.get(property_url(self.loft.id)).data["is_favorite"])

    def test_is_favorite_is_per_caller_on_the_list(self):
        self.client.force_authenticate(self.guest)
        self.assertEqual(self.flags(), {"Loft": True, "Villa": False, "Studio": False})
        self.client.force_authenticate(self.other)
        self.assertEqual(self.flags(), {"Loft": True, "Villa": True, "Studio": False})

    def test_is_favorite_on_the_detail(self):
        self.client.force_authenticate(self.guest)
        self.assertTrue(self.client.get(property_url(self.loft.id)).data["is_favorite"])
        self.assertFalse(self.client.get(property_url(self.villa.id)).data["is_favorite"])

    def test_saving_and_removing_flip_is_favorite(self):
        self.client.force_authenticate(self.guest)
        self.client.put(fav_url(self.studio.id))
        self.assertTrue(self.client.get(property_url(self.studio.id)).data["is_favorite"])
        self.client.delete(fav_url(self.studio.id))
        self.assertFalse(self.client.get(property_url(self.studio.id)).data["is_favorite"])

    def test_guests_never_see_favorite_count(self):
        self.assertNotIn("favorite_count", self.client.get(PROPERTIES_URL).data["results"][0])
        self.client.force_authenticate(self.guest)
        self.assertNotIn("favorite_count", self.client.get(PROPERTIES_URL).data["results"][0])
        self.assertNotIn("favorite_count", self.client.get(property_url(self.loft.id)).data)

    def test_admin_sees_favorite_count_on_list_and_detail(self):
        self.client.force_authenticate(self.admin)
        counts = {p["title"]: p["favorite_count"] for p in self.client.get(PROPERTIES_URL).data["results"]}
        self.assertEqual(counts, {"Loft": 2, "Villa": 1, "Studio": 0})
        self.assertEqual(self.client.get(property_url(self.loft.id)).data["favorite_count"], 2)

    def test_favorite_count_includes_inactive_properties_for_admin(self):
        Property.objects.filter(pk=self.loft.pk).update(is_active=False)
        self.client.force_authenticate(self.admin)
        res = self.client.get(PROPERTIES_URL, {"is_active": "false"})
        self.assertEqual([(p["title"], p["favorite_count"]) for p in res.data["results"]], [("Loft", 2)])

    def test_favorites_do_not_skew_the_rating(self):
        # favorite_count is a subquery, not another JOIN next to reviews.
        Review.objects.create(property=self.loft, guest=self.guest, rating=5)
        Review.objects.create(property=self.loft, guest=self.other, rating=2)
        self.client.force_authenticate(self.admin)
        loft = self.client.get(property_url(self.loft.id)).data
        self.assertEqual((loft["rating_avg"], loft["review_count"], loft["favorite_count"]), (3.5, 2, 2))

    def test_admin_write_response_includes_the_new_fields(self):
        self.client.force_authenticate(self.admin)
        res = self.client.patch(property_url(self.loft.id), {"title": "Loft 2"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["favorite_count"], 2)
        self.assertFalse(res.data["is_favorite"])

    def test_list_query_count_does_not_grow_with_favorites(self):
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as small:
            self.client.get(PROPERTIES_URL)
        for i in range(6):
            prop = self.make_property(f"Place {i}", "60.00")
            self.save(prop)
            self.save(prop, user=self.other)
        with CaptureQueriesContext(connection) as big:
            self.client.get(PROPERTIES_URL)
        self.assertEqual(len(big), len(small))
