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
    return f"geocode:v1:{digest}"


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
        "accept-language": settings.GEOCODING_LANGUAGE,
    }
    with _lock:
        _wait_for_turn()
        raw = _fetch(params)
    results = _clean(raw)
    cache.set(key, results, CACHE_SECONDS if results else EMPTY_CACHE_SECONDS)
    return results
