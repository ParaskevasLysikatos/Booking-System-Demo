"""Map coordinates for properties (TICKET-034).

Two jobs live here:

1. **Approximate location for guests.** Admins see a property's exact
   latitude/longitude; everyone else gets a point moved 100-400 m away from
   it, and the frontend draws a 500 m circle around that point. The exact
   point is therefore always inside the circle but never at its centre, and
   it never reaches a guest's browser. The offset is *deterministic* (an
   HMAC of SECRET_KEY + the property id), so the circle doesn't jump around
   between page loads - averaging many requests can't recover the real spot.

2. **Demo coordinates.** A table of the seeder's 12 Greek cities with a
   point a little inland from each centre and a small radius, so seeded
   places land near the town (and not in the sea). Used by seed_demo_data.
   The backfill migration (0003) keeps its own frozen copy of this table,
   as migrations should not import code that may change later.
"""

import hashlib
import hmac
import math
import random
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

# Metres per degree of latitude (close enough everywhere for our purposes).
METRES_PER_DEGREE = 111_320

APPROX_MIN_METRES = 100
APPROX_MAX_METRES = 400
# The circle the frontend draws around the approximate point. Must be larger
# than APPROX_MAX_METRES so the real point is always inside it.
APPROX_RADIUS_METRES = 500

COORD_PLACES = Decimal("0.000001")  # 6 decimals ~ 11 cm - the DB precision


def quantize(value):
    return Decimal(value).quantize(COORD_PLACES, rounding=ROUND_HALF_UP)


def offset_point(lat, lng, metres, bearing_rad):
    """Move (lat, lng) `metres` in direction `bearing_rad` (0 = north).
    Flat-earth approximation - fine for a few hundred metres."""
    lat, lng = float(lat), float(lng)
    dlat = metres * math.cos(bearing_rad) / METRES_PER_DEGREE
    dlng = metres * math.sin(bearing_rad) / (METRES_PER_DEGREE * math.cos(math.radians(lat)))
    return quantize(lat + dlat), quantize(lng + dlng)


def approximate_point(property_id, lat, lng):
    """The point guests see: 100-400 m from the real one, in a direction and
    distance fixed per property (derived from SECRET_KEY, so it can't be
    reversed from the public data)."""
    if lat is None or lng is None:
        return None, None
    digest = hmac.new(
        settings.SECRET_KEY.encode(), f"property-location:{property_id}".encode(), hashlib.sha256
    ).digest()
    bearing = int.from_bytes(digest[0:4], "big") / 2**32 * 2 * math.pi
    fraction = int.from_bytes(digest[4:8], "big") / 2**32
    metres = APPROX_MIN_METRES + fraction * (APPROX_MAX_METRES - APPROX_MIN_METRES)
    return offset_point(lat, lng, metres, bearing)


def distance_metres(lat1, lng1, lat2, lng2):
    """Haversine distance - used by the tests to check the offset."""
    lat1, lng1, lat2, lng2 = map(lambda v: math.radians(float(v)), (lat1, lng1, lat2, lng2))
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


# city -> (lat, lng, radius in metres). Points sit a little inland of each
# town centre, radii are kept small on coasts and islands.
CITY_CENTRES = {
    "thessaloniki": (40.6380, 22.9470, 700),
    "athens": (37.9755, 23.7348, 1500),
    "chania": (35.5120, 24.0200, 600),
    "heraklion": (35.3350, 25.1370, 700),
    "rhodes": (36.4400, 28.2200, 500),
    "santorini": (36.4165, 25.4350, 400),
    "mykonos": (37.4450, 25.3330, 400),
    "nafplio": (37.5640, 22.8080, 500),
    "ioannina": (39.6640, 20.8480, 700),
    "kalamata": (37.0400, 22.1130, 800),
    "volos": (39.3660, 22.9420, 600),
    "corfu": (39.6200, 19.9150, 500),
}


def city_for(location):
    """'Chania, Greece' -> 'chania' when it's one of the known cities."""
    city = (location or "").split(",")[0].strip().lower()
    return city if city in CITY_CENTRES else None


def demo_point(location, rng=random):
    """A random point near the city in `location` (uniform over a disc), or
    (None, None) for a place we have no centre for."""
    city = city_for(location)
    if city is None:
        return None, None
    lat, lng, radius = CITY_CENTRES[city]
    metres = radius * math.sqrt(rng.random())
    return offset_point(lat, lng, metres, rng.random() * 2 * math.pi)
