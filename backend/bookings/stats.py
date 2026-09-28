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

Revenue over time (TICKET-035): the same numbers, split into buckets for
the dashboard chart - see `revenue_series()`.
"""

import bisect

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


# --------------------------------------------------------------------------
# Revenue over time (TICKET-035)
# --------------------------------------------------------------------------

# Bucket size picked from the period length: by day up to 62 nights (every
# month preset, next 30 days), by week up to 190 nights (~6 months), by
# month beyond that (the 366-night maximum -> 12-13 bars).
SERIES_DAY_MAX_NIGHTS = 62
SERIES_WEEK_MAX_NIGHTS = 190


def series_granularity(period_nights):
    if period_nights <= SERIES_DAY_MAX_NIGHTS:
        return "day"
    if period_nights <= SERIES_WEEK_MAX_NIGHTS:
        return "week"
    return "month"


def series_buckets(start, end_exclusive, granularity):
    """[(from, to_exclusive), ...] covering [start, end_exclusive) without
    gaps. Weeks start on Monday and months on the 1st; the first and last
    bucket are cut to the period's edges (so they can be partial)."""
    buckets = []
    cursor = start
    while cursor < end_exclusive:
        if granularity == "day":
            nxt = cursor + timedelta(days=1)
        elif granularity == "week":
            nxt = cursor + timedelta(days=7 - cursor.weekday())
        else:
            nxt = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        nxt = min(nxt, end_exclusive)
        buckets.append((cursor, nxt))
        cursor = nxt
    return buckets


def _split_rounded(exact_values, rounded_total):
    """Round each value to cents so they add up *exactly* to `rounded_total`
    (the figure shown on the Revenue card). Rounding every bucket on its own
    could drift a cent or two from the card; rounding the running total
    instead can't: bucket = round(sum up to here) - round(sum before)."""
    out, running, previous = [], Decimal("0"), Decimal("0")
    for value in exact_values:
        running += value
        rounded = running.quantize(CENT, rounding=ROUND_HALF_UP)
        out.append(rounded - previous)
        previous = rounded
    if out:
        # The running total already matches the card's figure; this only
        # absorbs a last-digit difference of Decimal's 28-digit precision
        # between summing per bucket and summing per property.
        out[-1] += Decimal(rounded_total) - previous
    return [_money(v) for v in out]


def revenue_series(rows, start, end_exclusive, confirmed_total, pending_total):
    """Revenue, expected revenue and nights per bucket, from the same
    booking rows and with the same rules as the totals: each night's share
    of a stay's price lands in the bucket that night belongs to, cancelled
    bookings don't count, retired properties' revenue does. `booked_nights`
    / `pending_nights` are over *all* properties (the nights that earned the
    revenue next to them), so they can differ from the occupancy card, which
    only counts active properties."""
    granularity = series_granularity((end_exclusive - start).days)
    ranges = series_buckets(start, end_exclusive, granularity)
    starts = [b[0] for b in ranges]
    revenue = [Decimal("0")] * len(ranges)
    pending = [Decimal("0")] * len(ranges)
    booked_nights = [0] * len(ranges)
    pending_nights = [0] * len(ranges)

    for b in rows:
        if b["status"] == Booking.Status.CANCELLED:
            continue
        stay_nights = (b["check_out"] - b["check_in"]).days
        first = max(b["check_in"], start)
        last = min(b["check_out"], end_exclusive)
        i = bisect.bisect_right(starts, first) - 1
        while i < len(ranges) and ranges[i][0] < last:
            inside = nights_inside(first, last, ranges[i][0], ranges[i][1])
            share = b["total_price"] * inside / stay_nights
            if b["status"] == Booking.Status.CONFIRMED:
                revenue[i] += share
                booked_nights[i] += inside
            else:  # pending
                pending[i] += share
                pending_nights[i] += inside
            i += 1

    revenue_out = _split_rounded(revenue, confirmed_total)
    pending_out = _split_rounded(pending, pending_total)
    return {
        "granularity": granularity,
        "buckets": [
            {
                "from": frm,
                "to": to_ex - timedelta(days=1),  # inclusive, like the period
                "nights": (to_ex - frm).days,
                "revenue": revenue_out[i],
                "pending_revenue": pending_out[i],
                "booked_nights": booked_nights[i],
                "pending_nights": pending_nights[i],
            }
            for i, (frm, to_ex) in enumerate(ranges)
        ],
    }


def compute_stats(start, end):
    end_exclusive = end + timedelta(days=1)
    period_nights = (end_exclusive - start).days

    rows = list(
        Booking.objects.filter(check_in__lt=end_exclusive, check_out__gt=start)
        .values("property_id", "check_in", "check_out", "total_price", "status")
    )  # a list: read twice (totals + the revenue series), still one query

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

    confirmed_total = _money(sum((p["revenue"] for p in per_prop.values()), Decimal("0")))
    pending_total = _money(sum((p["pending_revenue"] for p in per_prop.values()), Decimal("0")))

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
            "confirmed": confirmed_total,
            "pending": pending_total,
        },
        "properties": breakdown,
        "series": revenue_series(rows, start, end_exclusive, confirmed_total, pending_total),
    }
