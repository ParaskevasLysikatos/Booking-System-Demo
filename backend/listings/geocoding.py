"""Place search for the admin property form's "Find on map" (TICKET-034).

Looks a text up with OpenStreetMap's Nominatim (free, no API key) and
returns up to 5 *specific* places in Greece - addresses, streets,
neighbourhoods, towns - each with its point, so the admin can pick the one
they mean and drop the pin there. Region/country-level matches ("Crete",
"Greece") are dropped: they would put the pin in the middle of nowhere.

It runs on the server (GET /api/admin/geocode/) rather than in the browser
so that Nominatim's usage policy is easy to follow in one place:
https://operations.osmfoundation.org/policies/nominatim/

- an identifying User-Agent (settings.GEOCODING_USER_AGENT)
- at most 1 request per second (per server process - a lock + a timestamp)
- results cached (24 h; 1 h for "nothing found"), so repeated searches for
  the same text never reach Nominatim again
- the attribution is returned for the page to show
"""

import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache

MAX_RESULTS = 5
# Ask Nominatim for more than we return: some get dropped as too broad.
FETCH_LIMIT = 10
CACHE_SECONDS = 24 * 60 * 60
EMPTY_CACHE_SECONDS = 60 * 60
MIN_INTERVAL_SECONDS = 1.0
ATTRIBUTION = "Search by OpenStreetMap Nominatim · © OpenStreetMap contributors"

# Nominatim's place_rank (https://nominatim.org/release-docs/latest/customize/Ranking/)
# -> how precise the point is. Below 13 (country, state/region, county) is
# too broad for a property and is dropped.
MIN_PLACE_RANK = 13


def precision_for(place_rank):
    if place_rank >= 28:
        return "address"  # a house number, building or named place (POI)
    if place_rank >= 26:
        return "street"
    if place_rank >= 17:
        return "area"  # village, suburb, neighbourhood, island
    return "city"


# Short labels (TICKET-042): Nominatim's display_name is the whole address
# chain ("Ιωάννη Τσιμισκή, Ladadika, 1st District of Thessaloniki,
# Thessaloniki Municipal Unit, Municipality of Thessaloniki, ..., 546 23,
# Greece"). short_label() keeps what an admin needs at a glance: the place's
# own name (for a named place), street + number, one neighbourhood and the
# town - "Ιωάννη Τσιμισκή, Ladadika, Thessaloniki".
STREET_KEYS = ("road", "pedestrian", "footway", "path", "square")
AREA_KEYS = ("neighbourhood", "quarter", "suburb", "residential")
# Most specific first: Kardamyli is a village inside "Municipal Unit of
# Lefktro" (Nominatim's `city`) - the village is what people know.
TOWN_KEYS = ("village", "town", "hamlet", "city", "municipality")
REGION_KEYS = ("county", "state_district", "state")
FALLBACK_PARTS = 3
_POSTCODE = re.compile(r"^\d{3}\s?\d{2}$")
# Greek administrative wrappers around a plain name.
_ADMIN_WORDS = re.compile(
    r"^(?:Municipal Unit of|Municipality of|Regional Unit of|Region of)\s+"
    r"|\s+(?:Municipal Unit|Municipality|Regional Unit|Region)$",
    re.IGNORECASE,
)
# Areas too broad to help: "1st District of Thessaloniki", the
# "Μητροπολιτική Περιοχή Θεσσαλονίκης" (metropolitan area) suburb.
_BROAD_AREA = re.compile(r"district|metropolitan|μητροπολιτική", re.IGNORECASE)


def _plain(value):
    return _ADMIN_WORDS.sub("", str(value or "").strip()).strip()


def short_label(item):
    """A short, readable form of a Nominatim result, built from its
    `address` details (asked for with addressdetails=1):

        [own name,] street [number,] [neighbourhood,] town
        Egnatia 100 -> "Εγνατία 100, Thessaloniki"
        a named place -> "White Tower of Thessaloniki, Νίκης, Thessaloniki"
        just a town -> "Kardamyli, Messenia", "Chania, Crete"
        no town -> "<name>, <regional unit>"

    Without address details it falls back to the first parts of
    display_name, minus postcode and country. The full line stays available
    as `label`."""
    address = item.get("address") if isinstance(item.get("address"), dict) else {}

    def first(keys, skip=None):
        for key in keys:
            value = _plain(address.get(key))
            if value and not (skip and skip.search(value)):
                return value
        return ""

    street = first(STREET_KEYS)
    number = str(address.get("house_number") or "").strip()
    town = first(TOWN_KEYS)
    name = str(item.get("name") or "").strip()

    parts = []
    if name and name not in (street, number, town) and not name.isdigit():
        parts.append(name)  # a named place: "White Tower of Thessaloniki"
    if street:
        parts.append(f"{street} {number}" if number else street)
    parts.append(first(AREA_KEYS, skip=_BROAD_AREA))
    parts.append(town)

    seen, short = set(), []
    for part in parts:
        if part and part.lower() not in seen:
            seen.add(part.lower())
            short.append(part)
    if short and (not town or short == [town]):
        # Just a town, or no town at all: add the region for context.
        region = next((r for r in (_plain(address.get(k)) for k in REGION_KEYS)
                       if r and r.lower() not in seen), "")
        if region:
            short.append(region)
    if address and short:
        return ", ".join(short)

    pieces = [p.strip() for p in str(item.get("display_name") or "").split(",") if p.strip()]
    pieces = [p for p in pieces if not _POSTCODE.match(p) and p.lower() != "greece"]
    return ", ".join(pieces[:FALLBACK_PARTS])


class GeocodingError(Exception):
    """Nominatim couldn't be reached or answered with something unusable."""


class GeocodingDisabled(GeocodingError):
    """GEOCODING_URL is empty - map search switched off."""


_lock = threading.Lock()
_last_request_at = 0.0


def _wait_for_turn():
    """Keep at least MIN_INTERVAL_SECONDS between two requests from this
    process. Called with _lock held, so concurrent searches queue up."""
    global _last_request_at
    wait = MIN_INTERVAL_SECONDS - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def _fetch(params):
    """GET the Nominatim search URL; returns the parsed JSON. The one place
    that talks to the network (the tests replace it)."""
    url = f"{settings.GEOCODING_URL}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={
        "User-Agent": settings.GEOCODING_USER_AGENT,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=settings.GEOCODING_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        # URLError covers HTTP errors (incl. 429 Too Many Requests) and DNS;
        # ValueError covers a body that isn't JSON.
        raise GeocodingError(str(exc)) from exc


def _clean(raw):
    """Nominatim items -> our result shape: specific places only, valid
    points, no duplicates, at most MAX_RESULTS, in Nominatim's relevance order."""
    if not isinstance(raw, list):
        raise GeocodingError("Unexpected response from the place search.")
    results, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            lat, lng = float(item["lat"]), float(item["lon"])
            rank = int(item.get("place_rank", 0))
        except (KeyError, TypeError, ValueError):
            continue
        if rank < MIN_PLACE_RANK or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        label = str(item.get("display_name") or "").strip()
        key = (round(lat, 5), round(lng, 5))
        if not label or key in seen:
            continue
        seen.add(key)
        results.append({
            "label": label,
            "short_label": short_label(item) or label,
            "name": str(item.get("name") or label.split(",")[0]).strip(),
            "latitude": round(lat, 6),
            "longitude": round(lng, 6),
            "precision": precision_for(rank),
            "kind": str(item.get("addresstype") or item.get("type") or ""),
        })
        if len(results) == MAX_RESULTS:
            break
    return results


def _cache_key(query):
    normalised = " ".join(query.lower().split())
    digest = hashlib.sha256(f"{normalised}|{settings.GEOCODING_LANGUAGE}".encode()).hexdigest()
    # v2: results carry short_label (TICKET-042) - older cached lists don't.
    return f"geocode:v2:{digest}"


def search(query):
    """Up to 5 specific places in Greece matching `query` (may be []).
    Raises GeocodingError when the search service can't be used."""
    if not settings.GEOCODING_URL:
        raise GeocodingDisabled("Map search is switched off (GEOCODING_URL is empty).")
    key = _cache_key(query)
    cached = cache.get(key)
    if cached is not None:
        return cached

    params = {
        "q": query,
        "format": "jsonv2",
        "countrycodes": "gr",
        "limit": FETCH_LIMIT,
        "addressdetails": 1,  # the parts short_label() is built from
        "accept-language": settings.GEOCODING_LANGUAGE,
    }
    with _lock:
        _wait_for_turn()
        raw = _fetch(params)
    results = _clean(raw)
    cache.set(key, results, CACHE_SECONDS if results else EMPTY_CACHE_SECONDS)
    return results
