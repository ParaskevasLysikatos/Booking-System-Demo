"""The annotated Property queryset shared by every endpoint that returns
property cards or details (TICKET-033 moved it here from PropertyViewSet so
the Saved page - favorites/views.py - returns exactly the same card data).

Everything is computed in the one SQL query that loads the page, never one
query per property:

- rating_avg / review_count - visible reviews only (TICKET-032)
- is_favorite  - has the *caller* saved it? (TICKET-033; False when logged out)
- favorite_count - how many accounts saved it, only when `with_favorite_count`
  is asked for (admins, TICKET-033)
- images prefetched (cover first) for `cover_image`
"""

from django.db.models import Avg, Count, Exists, IntegerField, OuterRef, Prefetch, Q, Subquery, Value
from django.db.models.functions import Coalesce

from favorites.models import Favorite

from .models import Property, PropertyImage


def favorite_count_subquery():
    # A subquery rather than Count("favorites"): another JOIN next to the
    # reviews JOIN would multiply rows and skew the other aggregates.
    counts = (
        Favorite.objects.filter(property=OuterRef("pk"))
        .order_by()
        .values("property")
        .annotate(n=Count("id"))
        .values("n")
    )
    return Coalesce(Subquery(counts, output_field=IntegerField()), Value(0))


def property_cards(user=None, *, with_favorite_count=False):
    qs = Property.objects.annotate(
        rating_avg=Avg("reviews__rating", filter=Q(reviews__is_hidden=False)),
        review_count=Count("reviews", filter=Q(reviews__is_hidden=False), distinct=True),
    ).prefetch_related(Prefetch("images", queryset=PropertyImage.objects.all()))

    if user is not None and user.is_authenticated:
        qs = qs.annotate(is_favorite=Exists(Favorite.objects.filter(user=user, property=OuterRef("pk"))))
    else:
        qs = qs.annotate(is_favorite=Value(False))

    if with_favorite_count:
        qs = qs.annotate(favorite_count=favorite_count_subquery())
    return qs
