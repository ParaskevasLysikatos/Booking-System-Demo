from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.permissions import is_app_admin
from core.pagination import StandardPagination
from listings.models import PropertyImage

from .models import Booking
from .serializers import BookingCreateSerializer, BookingSerializer, BookingStatusSerializer

EXCLUSION_VIOLATION = "23P01"  # Postgres SQLSTATE for exclusion_violation
NO_OVERLAP_CONSTRAINT = "booking_no_overlap_per_property"

DATES_TAKEN = "These dates are no longer available for this property."
DATES_JUST_TAKEN = "These dates were just booked by someone else. Please pick different dates."


def is_overlap_violation(exc):
    """True only for our no-overlap exclusion constraint - any other
    IntegrityError is a real bug and should still surface as a 500."""
    cause = getattr(exc, "__cause__", None)
    if getattr(cause, "pgcode", None) != EXCLUSION_VIOLATION:
        return False
    diag = getattr(cause, "diag", None)
    name = getattr(diag, "constraint_name", None)
    return name in (None, NO_OVERLAP_CONSTRAINT)


class BookingFilterSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Booking.Status.choices, required=False)
    when = serializers.ChoiceField(choices=["upcoming", "past"], required=False)
    property = serializers.IntegerField(required=False, min_value=1)  # admin only


class BookingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """/api/bookings/ (TICKET-015)

    - GET list/detail - guests see only their own bookings (someone else's
      is a 404), admins see all. Filters: ?status=, ?when=upcoming|past,
      ?property= (admin only). Paginated.
    - POST            - any logged-in user books for themselves.
    - PATCH           - status only: guest may cancel their own booking
                        until 48h before check-in (15:00 local on the
                        check-in date); admin: pending->confirmed/cancelled,
                        confirmed->cancelled. Cancelled is final.
    - PUT / DELETE    - not offered (405): cancelling is how a booking ends.
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def _is_admin(self):
        if not hasattr(self, "_admin_flag"):
            self._admin_flag = is_app_admin(self.request.user)
        return self._admin_flag

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["is_admin"] = self._is_admin()
        return context

    def get_queryset(self):
        qs = Booking.objects.select_related("property", "guest").prefetch_related(
            Prefetch("property__images", queryset=PropertyImage.objects.all())
        )
        if not self._is_admin():
            qs = qs.filter(guest=self.request.user)
        return qs

    def filter_queryset(self, queryset):
        if self.action != "list":
            return queryset
        params = BookingFilterSerializer(data=self.request.query_params)
        params.is_valid(raise_exception=True)
        f = params.validated_data
        today = timezone.localdate()
        if f.get("status"):
            queryset = queryset.filter(status=f["status"])
        if f.get("when") == "upcoming":
            # Not checked out yet (includes stays in progress), soonest first.
            queryset = queryset.filter(check_out__gt=today).order_by("check_in", "id")
        elif f.get("when") == "past":
            queryset = queryset.filter(check_out__lte=today).order_by("-check_in", "-id")
        else:
            queryset = queryset.order_by("-check_in", "-id")
        if f.get("property") and self._is_admin():
            queryset = queryset.filter(property_id=f["property"])
        return queryset

    def get_serializer_class(self):
        return BookingCreateSerializer if self.action == "create" else BookingSerializer

    def _respond(self, booking, status_code):
        fresh = self.get_queryset().get(pk=booking.pk)
        return Response(
            BookingSerializer(fresh, context=self.get_serializer_context()).data,
            status=status_code,
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # 1) Friendly pre-check: covers the normal "those dates are taken"
        #    case with a clear message. NOT race-proof on its own.
        if Booking.objects.overlapping(data["property"], data["check_in"], data["check_out"]).exists():
            return Response({"detail": DATES_TAKEN, "code": "dates_unavailable"},
                            status=status.HTTP_409_CONFLICT)

        # 2) The real guarantee: the DB exclusion constraint. If another
        #    request committed an overlapping booking between our pre-check
        #    and this insert, Postgres rejects it here -> clean 409, not 500.
        try:
            with transaction.atomic():
                booking = serializer.save()
        except IntegrityError as exc:
            if is_overlap_violation(exc):
                return Response({"detail": DATES_JUST_TAKEN, "code": "dates_unavailable"},
                                status=status.HTTP_409_CONFLICT)
            raise
        return self._respond(booking, status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        body = BookingStatusSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        new_status = body.validated_data["status"]

        # Single atomic read-modify-write: lock this booking's row so a
        # guest's cancel and an admin's status change landing at the same
        # time are serialised - the second one sees the first one's result
        # (and is validated against it) instead of silently overwriting it.
        with transaction.atomic():
            booking = get_object_or_404(
                self.get_queryset().select_for_update(of=("self",)), pk=kwargs["pk"]
            )
            self._check_transition(booking, new_status)
            booking.status = new_status
            booking.save(update_fields=["status"])
        return self._respond(booking, status.HTTP_200_OK)

    def _check_transition(self, booking, new_status):
        current = booking.status
        if new_status == current:
            raise ValidationError({"status": [f"Booking is already {current}."]})
        if self._is_admin():
            allowed = Booking.ADMIN_TRANSITIONS[current]
        else:
            if new_status != Booking.Status.CANCELLED:
                raise ValidationError({"status": ["Guests can only cancel a booking."]})
            if not booking.guest_can_cancel():
                deadline = timezone.localtime(booking.cancel_deadline())
                hours = settings.BOOKING_GUEST_CANCELLATION_HOURS
                raise ValidationError({"status": [
                    f"Online cancellation closed on {deadline:%Y-%m-%d %H:%M} "
                    f"({hours} hours before check-in). Please contact us."
                ]})
            allowed = Booking.GUEST_TRANSITIONS[current]
        if new_status not in allowed:
            raise ValidationError(
                {"status": [f"Can't change a {current} booking to {new_status}."]}
            )
