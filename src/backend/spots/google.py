"""A spot as Google Places sees it: its rating, reviews and photos.

StudySpot's own data has none of these. They come from the Places API (New),
looked up by the spot's name near its coordinates, and only when
``GOOGLE_PLACES_API_KEY`` is set. Google's terms require the attributions
that come with each review and photo to be shown with them, so they are kept.

Answers are cached for a day: a spot's Google page changes slowly, and every
lookup costs quota.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any

from django.conf import settings
from django.core.cache import cache

from .models import StudySpot

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.reviews",
        "places.photos",
    ]
)
TIMEOUT_SECONDS = 6
CACHE_SECONDS = 60 * 60 * 24
MOST_PHOTOS = 6
PHOTO_WIDTH = 640


class GoogleUnavailable(Exception):
    """Google could not be asked, or did not answer usefully."""


@dataclass(frozen=True)
class Attribution:
    name: str
    uri: str | None


@dataclass(frozen=True)
class GoogleReview:
    author: Attribution
    author_photo: str | None
    rating: int
    text: str
    when: str


@dataclass(frozen=True)
class GooglePhoto:
    uri: str
    attributions: tuple[Attribution, ...]


@dataclass(frozen=True)
class GooglePlace:
    name: str
    rating: float | None
    rating_count: int
    maps_uri: str | None
    reviews: tuple[GoogleReview, ...]
    photos: tuple[GooglePhoto, ...]

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


def _key() -> str:
    key: str = getattr(settings, "GOOGLE_PLACES_API_KEY", "")
    if not key:
        raise GoogleUnavailable("Google Places is not configured.")
    return key


def _request(request: urllib.request.Request) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body: dict[str, Any] = json.load(response)
            return body
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise GoogleUnavailable("Google Places did not answer.") from error


def _attribution(raw: dict[str, Any]) -> Attribution:
    return Attribution(name=str(raw.get("displayName") or "A Google user"), uri=raw.get("uri"))


def _photo_uri(name: str, key: str) -> str | None:
    """The photo's public address, without the key in it."""
    query = urllib.parse.urlencode(
        {"maxWidthPx": PHOTO_WIDTH, "skipHttpRedirect": "true", "key": key}
    )
    request = urllib.request.Request(f"https://places.googleapis.com/v1/{name}/media?{query}")
    try:
        uri = _request(request).get("photoUri")
    except GoogleUnavailable:
        return None
    return uri if isinstance(uri, str) else None


def parse_place(raw: dict[str, Any], photo_uri: Any) -> GooglePlace:
    """Turn one Places API ``place`` into a :class:`GooglePlace`.

    ``photo_uri`` resolves a photo resource name to its public address, or
    ``None`` when it cannot; such photos are left out.
    """
    reviews = tuple(
        GoogleReview(
            author=_attribution(review.get("authorAttribution") or {}),
            author_photo=(review.get("authorAttribution") or {}).get("photoUri"),
            rating=int(review.get("rating") or 0),
            text=str((review.get("text") or review.get("originalText") or {}).get("text") or ""),
            when=str(review.get("relativePublishTimeDescription") or ""),
        )
        for review in raw.get("reviews") or []
    )
    photos: list[GooglePhoto] = []
    for photo in (raw.get("photos") or [])[:MOST_PHOTOS]:
        uri = photo_uri(photo.get("name", ""))
        if uri:
            photos.append(
                GooglePhoto(
                    uri=uri,
                    attributions=tuple(
                        _attribution(a) for a in photo.get("authorAttributions") or []
                    ),
                )
            )
    return GooglePlace(
        name=str((raw.get("displayName") or {}).get("text") or ""),
        rating=raw.get("rating"),
        rating_count=int(raw.get("userRatingCount") or 0),
        maps_uri=raw.get("googleMapsUri"),
        reviews=reviews,
        photos=tuple(photos),
    )


def place_for(spot: StudySpot) -> GooglePlace | None:
    """Google's page for ``spot``, or ``None`` when Google has none.

    Raises :class:`GoogleUnavailable` when Google is not configured or does
    not answer.
    """
    cache_key = f"google-place:{spot.pk}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached or None

    key = _key()
    body = json.dumps(
        {
            "textQuery": spot.name if not spot.address else f"{spot.name}, {spot.address}",
            "maxResultCount": 1,
            "locationBias": {
                "circle": {
                    "center": {"latitude": spot.latitude, "longitude": spot.longitude},
                    "radius": 250.0,
                }
            },
        }
    ).encode()
    request = urllib.request.Request(
        SEARCH_URL,
        data=body,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-goog-api-key": key,
            "x-goog-fieldmask": FIELDS,
        },
    )
    places = _request(request).get("places") or []
    place = parse_place(places[0], lambda name: _photo_uri(name, key)) if places else None
    # An empty string marks "Google has no page", so that is cached too.
    cache.set(cache_key, place or "", CACHE_SECONDS)
    return place
