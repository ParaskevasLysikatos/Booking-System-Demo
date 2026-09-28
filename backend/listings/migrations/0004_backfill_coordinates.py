"""TICKET-034: give existing properties a map position.

Properties whose `location` starts with one of the seeder's 12 Greek cities
("Chania, Greece" -> Chania) get a point near that city; any other property
keeps no coordinates (it just isn't on the map until an admin sets one).
Properties that already have coordinates are left alone.

The city table is a frozen copy of listings/geo.py:CITY_CENTRES at the time
of writing - migrations must not import code that can change later. The
random offset is seeded per property id, so re-running this on the same
data gives the same points.
"""

import math
import random
from decimal import ROUND_HALF_UP, Decimal

from django.db import migrations

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
METRES_PER_DEGREE = 111_320
PLACES = Decimal("0.000001")


def point_near(city, rng):
    lat, lng, radius = CITY_CENTRES[city]
    metres = radius * math.sqrt(rng.random())
    bearing = rng.random() * 2 * math.pi
    dlat = metres * math.cos(bearing) / METRES_PER_DEGREE
    dlng = metres * math.sin(bearing) / (METRES_PER_DEGREE * math.cos(math.radians(lat)))
    return (
        Decimal(lat + dlat).quantize(PLACES, rounding=ROUND_HALF_UP),
        Decimal(lng + dlng).quantize(PLACES, rounding=ROUND_HALF_UP),
    )


def backfill(apps, schema_editor):
    Property = apps.get_model("listings", "Property")
    for prop in Property.objects.filter(latitude__isnull=True, longitude__isnull=True).only("id", "location"):
        city = (prop.location or "").split(",")[0].strip().lower()
        if city not in CITY_CENTRES:
            continue
        lat, lng = point_near(city, random.Random(f"property-coords-{prop.pk}"))
        Property.objects.filter(pk=prop.pk).update(latitude=lat, longitude=lng)


class Migration(migrations.Migration):

    dependencies = [
        ("listings", "0003_property_coordinates"),
    ]

    operations = [
        # Reversing is a no-op: unapplying 0003 drops the columns anyway.
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
