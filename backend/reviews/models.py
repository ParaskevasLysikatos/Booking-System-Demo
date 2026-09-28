from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class ReviewQuerySet(models.QuerySet):
    def visible(self):
        """Reviews the public sees: everything an admin hasn't hidden
        (TICKET-032). Hidden reviews also don't count toward a property's
        rating average or review count."""
        return self.filter(is_hidden=False)


def has_finished_stay(user, property_id):
    """The review rule (TICKET-032): a guest may review a property once they
    have a *confirmed* booking there whose check-out date has arrived.
    Pending (unpaid) and cancelled bookings never count."""
    from bookings.models import Booking  # local import: bookings -> reviews already

    if not (user and user.is_authenticated):
        return False
    return Booking.objects.filter(
        guest=user,
        property_id=property_id,
        status=Booking.Status.CONFIRMED,
        check_out__lte=timezone.localdate(),
    ).exists()


class Review(models.Model):
    """A guest's rating/comment on a Property.

    Reviews are final (TICKET-032): the API lets a guest post one per
    property and never edit or delete it. An admin can hide one (and show
    it again) instead of deleting it.
    """

    property = models.ForeignKey(
        "listings.Property",
        on_delete=models.PROTECT,
        related_name="reviews",
        help_text="PROTECT, same reasoning as Booking: review history shouldn't be lost to a hard-delete - use Property.is_active instead.",
    )
    guest = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="1-5 stars.",
    )
    comment = models.TextField(blank=True)
    is_hidden = models.BooleanField(
        default=False,
        help_text="Hidden by an admin: not shown publicly and not counted in the rating. The guest still can't post another one.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ReviewQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=models.Q(rating__gte=1) & models.Q(rating__lte=5),
                name="review_rating_between_1_and_5",
            ),
            models.UniqueConstraint(
                fields=["property", "guest"],
                name="unique_review_per_guest_per_property",
            ),
        ]

    def __str__(self):
        return f"{self.rating}★ review of {self.property.title} by {self.guest.get_username()}"
