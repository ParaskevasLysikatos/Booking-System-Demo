"""Numbers for the admin dashboard (TICKET-016): GET /api/admin/stats/.

Definitions (agreed before building):

- The period is a range of *nights*: from `start` to `end`, both
  inclusive. The night of date D is the one starting on D, so a stay
  check_in=10th, check_out=13th occupies the nights of the 10th, 11th and
  12th.
- Only the nights of a stay that fall inside the period count, for both
  occupancy and revenue. A 10-night stay crossing month-end is split
  between the two months.
- Occupancy = confirmed nights / (active properties x nights in period).
  Pending nights are reported separately (the pipeline) and don't count as
  occupied. Cancelled bookings never count.
- Revenue is spread evenly over a stay's nights (total_price / nights per
  night). Confirmed = revenue, pending = expected revenue.

Everything is computed from the bookings whose stay overlaps the period
(one query), in exact Decimal, rounded to cents only at the very end.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from listings.models import Property

from .models import Booking

CENT = Decimal("0.01")


def _money(value):
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _rate(numerator, denominator):
    if not denominator:
        return None  # e.g. no active properties - "no data", not 0%
    return round(numerator / denominator, 4)


def nights_inside(check_in, check_out, start, end_exclusive):
    """How many nights of [check_in, check_out) fall in [start, end_exclusive)."""
    return max(0, (min(check_out, end_exclusive) - max(check_in, start)).days)


def compute_stats(start, end):
    end_exclusive = end + timedelta(days=1)
    period_nights = (end_exclusive - start).days

    rows = (
        Booking.objects.filter(check_in__lt=end_exclusive, check_out__gt=start)
        .values("property_id", "check_in", "check_out", "total_price", "status")
    )

    counts = {status: 0 for status in Booking.Status.values}
    per_prop = defaultdict(lambda: {
        "booked_nights": 0,
        "pending_nights": 0,
        "revenue": Decimal("0"),
        "pending_revenue": Decimal("0"),
    })

    for b in rows:
        counts[b["status"]] += 1
        if b["status"] == Booking.Status.CANCELLED:
            continue
        inside = nights_inside(b["check_in"], b["check_out"], start, end_exclusive)
        stay_nights = (b["check_out"] - b["check_in"]).days
        share = b["total_price"] * inside / stay_nights
        p = per_prop[b["property_id"]]
        if b["status"] == Booking.Status.CONFIRMED:
            p["booked_nights"] += inside
            p["revenue"] += share
        else:  # pending
            p["pending_nights"] += inside
            p["pending_revenue"] += share

    created = Booking.objects.filter(
        created_at__date__gte=start, created_at__date__lte=end
    ).count()

    # Breakdown rows: every active property (even with no bookings - an
    # empty row is useful information), plus any inactive property that
    # still earned something in the period.
    props = Property.objects.filter(is_active=True) | Property.objects.filter(pk__in=list(per_prop))
    props = props.distinct().only("id", "title", "is_active")
    active_ids = set()
    breakdown = []
    for prop in props:
        p = per_prop[prop.id]
        if prop.is_active:
            active_ids.add(prop.id)
        breakdown.append({
            "id": prop.id,
            "title": prop.title,
            "is_active": prop.is_active,
            "booked_nights": p["booked_nights"],
            "pending_nights": p["pending_nights"],
            "occupancy_rate": _rate(p["booked_nights"], period_nights),
            "revenue": _money(p["revenue"]),
            "pending_revenue": _money(p["pending_revenue"]),
        })
    breakdown.sort(key=lambda r: (-Decimal(r["revenue"]), -r["booked_nights"], r["title"].lower(), r["id"]))

    # Occupancy only over active properties - a retired property's nights
    # aren't "available" any more, so they'd distort the rate.
    booked_active = sum(per_prop[i]["booked_nights"] for i in active_ids)
    pending_active = sum(per_prop[i]["pending_nights"] for i in active_ids)
    available = len(active_ids) * period_nights

    return {
        "period": {"from": start, "to": end, "nights": period_nights},
        "bookings": {
            "total": sum(counts.values()),
            **counts,
            "created_in_period": created,
        },
        "occupancy": {
            "rate": _rate(booked_active, available),
            "booked_nights": booked_active,
            "pending_nights": pending_active,
            "available_nights": available,
            "active_properties": len(active_ids),
        },
        "revenue": {
            "confirmed": _money(sum((p["revenue"] for p in per_prop.values()), Decimal("0"))),
            "pending": _money(sum((p["pending_revenue"] for p in per_prop.values()), Decimal("0"))),
        },
        "properties": breakdown,
    }
