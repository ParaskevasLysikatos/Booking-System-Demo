from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Review(models.Model):
    """A guest's rating/comment on a Property."""

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
    created_at = models.DateTimeField(auto_now_add=True)

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
