"""Turn NYC Open Data into the normalized study-spot snapshot.

.. code-block:: text

    NYC Open Data ---\
                      ingest.py -> spots.json
    nyu_buildings.json /

Run it through just, which writes ``data/spots.json`` in place::

    just ingest

The snapshot stays in version control, so a checkout can load the serving table
and run the API without reaching the network. Regenerating it is how the data
changes; nothing writes to ``spots.json`` at runtime.

Where the records come from
---------------------------

Four sources. The first is the city's Facilities Database (FacDB, Socrata ``ji82-xba5``),
which is what the ``facdb:`` identifier prefix refers to. Two subsets of it are
places a student might read in -- the ``LIBRARIES`` facility group and the
``COLLEGES OR UNIVERSITIES`` subgroup.

The second is Dining Out NYC (``fpeh-f7ci``), the register of outdoor-dining
licences, which the ``dining:`` prefix refers to and which is where the cafes
come from. FacDB holds none and never will: it registers what the city
*operates*, and a cafe is something the city *licenses*.

Neighborhood names come from the 2020 Neighborhood Tabulation Areas
(``9nt8-h7nd``), because both registers publish the NTA code and not its name.

The second is ``nyu_buildings.json``, a hand-maintained list of NYU buildings
merged over the open-data records by :func:`combine`. FacDB registers NYU as an
institution and its schools as administrative points, but not the buildings
students study in, so without this list the snapshot has no campus study space
at all. Those records carry the ``nyu:`` identifier prefix and name the
institution whose building it is rather than a campus that happens to be within
500 m.

The third is the city's public Wi-Fi hotspot locations (``yjub-udmw``), used
only to answer one question: is there free public Wi-Fi at this spot. A hotspot
within 25 m sets ``free_public_wifi``. That radius is tight on purpose -- the
matches at 25 m are overwhelmingly hotspots the libraries themselves run, while
widening it to 100 m starts counting LinkNYC kiosks on the street, which is not
Wi-Fi anyone can use sitting down.

``free_public_wifi`` is false for every curated NYU building, and that is
correct rather than missing: those buildings have Wi-Fi that needs NYU
credentials, and the field answers whether *anyone* can use it.

No source lists hours, noise, or power outlets. The city publishes a link to
each Queens branch's page and a weekly total of open hours for NYPL branches,
neither of which is a schedule, so "open now" is not derivable. No source lists
access conditions either, and the contract has no field for one: several
curated buildings require a university ID to enter.

FacDB does not list cafés, so no record maps to the published ``cafe`` category
yet. The obvious candidate, the health department's restaurant inspection
results, is an inspection log rather than a directory of open businesses: it
keeps establishments that closed years ago and carries no 2020 NTA, so
publishing it as study spots would assert more than the data supports.

Why the identifiers look like that
----------------------------------

An identifier is the source prefix and FacDB's own ``uid``, as in
``facdb:eec118768e15a5e03d3354abda7b00da``. The digest is upstream's, derived
from the source record, and this importer treats it as the record's identity
rather than computing one of its own.

That choice is about churn. ``load_spots`` replaces the whole table rather than
upserting, so an identifier derived from a record's *contents* -- its name,
address or coordinates -- would change every time the city fixed a typo or
re-geocoded a building, and every row of the snapshot would silently come back
as a different spot with the old one deleted. Anything holding an identifier,
including a bookmarked ``GET /spots/{id}``, would break for a cosmetic edit
upstream. Deriving the identifier from identity alone means re-running this
importer against unchanged upstream data produces a byte-identical snapshot,
and a changed name is an update to one row.

The prefix is not decoration: it keeps a second source from colliding with
FacDB if its keys happen to look the same, and it says where a record came
from.

What normalization does
-----------------------

Presentation is part of it. FacDB writes names and addresses in capitals, and
the published contract shows "125th Street Library" rather than "125TH STREET
LIBRARY", so this module title-cases both. Coordinates are rounded to six
decimal places, about a tenth of a metre, which is finer than a building and
keeps the snapshot small.

``address``, ``neighborhood`` and ``university`` are absent for some records.
They are written as ``null``, never as an empty string: the contract
distinguishes the two and the API returns ``null``.

``university`` is proximity and nothing else
--------------------------------------------

It names the closest campus within 500 metres, or the campus itself for a
campus record, and is ``null`` when no campus is that close. The campus list is
curated -- it is the higher-education subset of FacDB named above, the same
records this importer publishes as ``university`` spots -- and the field is
never guessed from a facility's name, its operator, or anything else.

A named campus is not an affiliation, an endorsement, or a claim that anyone
may walk in: 169 metres is what the data says about "125th Street Library" and
"Touro University - Harlem", and it says nothing more than that.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: ``data/ingest.py`` -> ``data/``.
HERE = Path(__file__).resolve().parent

DEFAULT_OUTPUT = HERE / "spots.json"

#: Trimmed upstream responses, so the tests and `--fixtures` need no network.
DEFAULT_FIXTURES = HERE / "fixtures"

SOCRATA_DOMAIN = "data.cityofnewyork.us"

#: Facilities Database. The ``facdb:`` identifier prefix names this dataset.
FACILITIES_DATASET = "ji82-xba5"
FACILITIES_WHERE = "facgroup = 'LIBRARIES' OR facsubgrp = 'COLLEGES OR UNIVERSITIES'"

#: 2020 Neighborhood Tabulation Areas, for the names FacDB only codes.
NEIGHBORHOODS_DATASET = "9nt8-h7nd"

#: Public Wi-Fi hotspots, for the one amenity the open data can support.
#:
#: Only the free ones: the dataset also carries "Limited Free", which means a
#: trial or a time limit, and a filter that promised Wi-Fi and delivered thirty
#: minutes of it would be worse than not offering the filter.
WIFI_DATASET = "yjub-udmw"
WIFI_WHERE = "type = 'Free'"

#: Dining Out NYC, the city's register of outdoor-dining licences and the
#: successor to the retired DCA sidewalk-cafe dataset. The ``dining:``
#: identifier prefix names this dataset.
#:
#: FacDB is a register of *city facilities*, which is why it holds libraries and
#: campuses and not a single cafe. Cafes are licensed rather than operated by
#: the city, so they live in a licence register instead. The published ``cafe``
#: category had no source until this was found.
CAFES_DATASET = "fpeh-f7ci"

#: Issued sidewalk licences only.
#:
#: ``license_status`` also carries applications that were never granted, and a
#: cafe that does not exist is worse than one the snapshot omits. ``Sidewalk``
#: rather than ``Roadway`` because a roadway licence is a dining structure in a
#: parking lane, which is seasonal, frequently removed, and not somewhere to sit
#: with a laptop.
CAFES_WHERE = "license_status = 'Issued' AND license_type = 'Sidewalk'"

SOURCE_PREFIX = "facdb"
CAFE_PREFIX = "dining"

#: The category every Dining Out record takes. The licence says the place
#: serves food outdoors, not what kind of place it is, so there is nothing
#: finer to map.
CAFE_CATEGORY = "cafe"

#: A hand-maintained list of NYU buildings, kept as data rather than code so it
#: can be edited without touching the importer.
#:
#: FacDB is a register of city facilities, so it carries NYU as an institution
#: and its schools as administrative points, but none of the buildings students
#: actually study in. These ten are recorded by hand from public building
#: information. They are the reason the snapshot has campus study space at all.
CURATED_PATH = HERE / "nyu_buildings.json"

#: Socrata serves at most 1,000 rows per request.
PAGE_SIZE = 1000

#: Anonymous requests share one throttled pool. A token raises the limit and is
#: free; it is read from the environment so it never reaches version control.
APP_TOKEN_VARIABLE = "NYC_OPEN_DATA_APP_TOKEN"

HTTP_TIMEOUT_SECONDS = 60

#: NYC Open Data asks for identifiable traffic and sheds load under pressure.
#: Two requests do not need a budget, but paging politely costs nothing.
PAGE_DELAY_SECONDS = 0.25
USER_AGENT = "StudySpot-ingest/1.0 (+https://github.com/gcivil-nyu-org/team-4-fall26)"

#: The fields ``load_spots`` accepts. A tenth field fails the load rather than
#: being dropped, so the importer checks its own output against this.
CONTRACT_FIELDS = (
    "id",
    "name",
    "category",
    "address",
    "neighborhood",
    "borough",
    "latitude",
    "longitude",
    "university",
    "operator",
    "free_public_wifi",
)

#: The published category vocabulary, keyed on FacDB's most specific type so
#: that a new upstream type fails loudly instead of landing in a near-enough
#: bucket. ``None`` is a deliberate exclusion rather than a missing mapping.
#:
#: ``PUBLIC LIBRARY`` and ``SPECIAL LIBRARIES`` are kept apart rather than both
#: published as libraries, because the difference is the one a reader cares
#: about. A branch of NYPL, BPL or QPL is somewhere anyone can walk into; a
#: special library is an institutional collection -- a club's, a society's, a
#: hospital's -- and many are open by appointment or to members only. Publishing
#: the second as ``public_library`` would claim access the data does not
#: support, which is the same overclaim ``free_public_wifi`` and ``university``
#: are each worded to avoid.
#:
#: The NYCHA community centre library is a city-run facility open to the
#: community it sits in, so it goes with the public branches.
CATEGORY_BY_FACILITY_TYPE: dict[str, str | None] = {
    "PUBLIC LIBRARY": "public_library",
    "NYCHA COMMUNITY CENTER - LIBRARY": "public_library",
    "SPECIAL LIBRARIES": "special_library",
    "ACADEMIC LIBRARIES": "academic_library",
    "2 YEAR INDEPENDENT": "university",
    "2 YEAR PROPRIETARY": "university",
    "4 YEAR PROPRIETARY": "university",
    "4-YEAR INDEPENDENT": "university",
    "CUNY - 4 YEAR COLLEGE": "university",
    "CUNY - COMMUNITY COLLEGE": "university",
    "CUNY - GRADUATE CENTER": "university",
    "GRADUATE PROGRAMS ONLY": "university",
    "SUNY - COMMUNITY COLLEGES": "university",
    "SUNY - HEALTH SCIENCE CENTERS": "university",
    "SUNY - SPECIALIZED COLLEGES": "university",
    # Someone's home. Listing it as a place to study would invite people to a
    # residence.
    "UNIVERSITY RESIDENTIAL STRUCTURE": None,
}

#: How close a free hotspot has to be before the spot is credited with it.
#:
#: Measured rather than chosen. At 25 m, 203 of the 248 public libraries match,
#: and almost every match is a hotspot the library itself operates -- NYPL, QPL
#: and BPL run 214 of them. Widen it to 100 m and the count rises to 274, but
#: the additions are LinkNYC kiosks on the street rather than Wi-Fi anyone can
#: use sitting down, which is the question the field is meant to answer.
WIFI_RADIUS_METRES = 25.0

CAMPUS_CATEGORY = "university"

#: Close enough to walk out of one and into the other.
CAMPUS_RADIUS_METRES = 500.0

BOROUGH_BY_FACILITY_BOROUGH = {
    "MANHATTAN": "Manhattan",
    "BROOKLYN": "Brooklyn",
    "QUEENS": "Queens",
    "BRONX": "Bronx",
    "STATEN ISLAND": "Staten Island",
}

#: About a tenth of a metre, and what the published example record shows.
COORDINATE_DIGITS = 6

EARTH_RADIUS_METRES = 6_371_000.0

#: Initialisms FacDB shouts for a reason, and which title case would mangle.
#: Every one of these appears in the facilities the importer publishes; a type
#: this list has not caught yet shows up as "Cuny" in the snapshot.
INITIALISMS = frozenset(
    {
        "AMG",
        "CUNY",
        "IE",
        "LIU",
        "MCNY",
        "NY",
        "NYADI",
        "NYC",
        "NYFA",
        "NYU",
        "SI",
        "SNFL",
        "SUNY",
    }
)

MINOR_WORDS = frozenset(
    {"a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to"}
)

#: "125TH STREET" is a street number, not emphasis.
ORDINAL = re.compile(r"^(\d+)(ST|ND|RD|TH)$", re.IGNORECASE)

#: Keeps an apostrophe inside its word, so "ST JOHN'S" does not become
#: "St John'S", and keeps every other run of punctuation as a separator, so
#: "100% COFFEE" keeps its per cent sign.
WORD_BOUNDARY = re.compile(r"([^\w']+)")


class IngestError(Exception):
    """The importer cannot produce a snapshot the loader would accept."""


@dataclass(frozen=True)
class Campus:
    """One entry of the curated campus list."""

    name: str
    latitude: float
    longitude: float


def warn(message: str) -> None:
    print(f"ingest: {message}", file=sys.stderr)


# -- Upstream ----------------------------------------------------------------


def socrata_page(dataset: str, params: dict[str, Any], token: str | None) -> list[Any]:
    url = f"https://{SOCRATA_DOMAIN}/resource/{dataset}.json?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    if token:
        request.add_header("X-App-Token", token)

    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 429:
            raise IngestError(
                "NYC Open Data is throttling this client. Request a free app token at "
                f"https://{SOCRATA_DOMAIN}/profile/edit/developer_settings and export it as "
                f"{APP_TOKEN_VARIABLE}."
            ) from error
        detail = error.read(100).decode("utf-8", "replace").strip()
        raise IngestError(
            f"NYC Open Data answered HTTP {error.code} for dataset {dataset}: {detail}"
        ) from error
    except urllib.error.URLError as error:
        raise IngestError(
            f"Could not reach {SOCRATA_DOMAIN} ({error.reason}). "
            "Pass --fixtures to run against the committed sample instead."
        ) from error

    if not isinstance(payload, list):
        raise IngestError(
            f"Dataset {dataset} answered with {type(payload).__name__}, not an array."
        )
    return payload


def socrata_rows(dataset: str, params: dict[str, Any], token: str | None, order: str) -> list[Any]:
    """Every row matching ``params``, one page at a time.

    ``order`` is a column of this dataset: ``$offset`` paging over an unordered
    query can repeat and skip rows.
    """
    rows: list[Any] = []
    offset = 0
    while True:
        page = socrata_page(
            dataset,
            {**params, "$order": order, "$limit": PAGE_SIZE, "$offset": offset},
            token,
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE
        time.sleep(PAGE_DELAY_SECONDS)


def fixture_rows(directory: Path, name: str) -> list[Any]:
    path = directory / f"{name}.json"
    if not path.exists():
        raise IngestError(f"No fixture at {path}.")
    rows = json.loads(path.read_text("utf-8"))
    if not isinstance(rows, list):
        raise IngestError(f"{path} must contain an array of upstream records.")
    return rows


def read_sources(fixtures: Path | None) -> tuple[list[Any], list[Any], list[Any], list[Any]]:
    """The raw upstream records, from the network or from a fixture directory."""
    if fixtures is not None:
        return (
            fixture_rows(fixtures, "facilities"),
            fixture_rows(fixtures, "cafes"),
            fixture_rows(fixtures, "neighborhoods"),
            fixture_rows(fixtures, "wifi"),
        )

    token = os.environ.get(APP_TOKEN_VARIABLE) or None
    if not token:
        warn(f"no {APP_TOKEN_VARIABLE} set; using the shared anonymous rate limit")

    facilities = socrata_rows(FACILITIES_DATASET, {"$where": FACILITIES_WHERE}, token, order="uid")
    cafes = socrata_rows(
        CAFES_DATASET,
        {"$where": CAFES_WHERE},
        token,
        # Dining Out publishes no stable row identifier, so paging is ordered on
        # Socrata's own row id: without a total order the pages can overlap and
        # drop records between them.
        order=":id",
    )
    neighborhoods = socrata_rows(
        NEIGHBORHOODS_DATASET,
        # The boundaries themselves are megabytes of geometry, and the code and
        # its name are all this needs.
        {"$select": "nta2020,ntaname"},
        token,
        order="nta2020",
    )
    hotspots = socrata_rows(
        WIFI_DATASET,
        # Coordinates are all the proximity test needs; the rest of the row is
        # provider metadata.
        {"$select": "objectid,latitude,longitude", "$where": WIFI_WHERE},
        token,
        order="objectid",
    )
    return facilities, cafes, neighborhoods, hotspots


# -- Normalization -----------------------------------------------------------


def text(value: Any) -> str | None:
    """A trimmed string, or ``None`` for anything upstream left blank."""
    if not isinstance(value, str):
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


def title_word(word: str, *, minor_allowed: bool) -> str:
    stem, apostrophe, suffix = word.partition("'")
    if apostrophe and suffix.upper() == "S" and stem.upper() in INITIALISMS:
        return f"{stem.upper()}'s"

    shouted = word.upper()
    if shouted in INITIALISMS:
        return shouted

    ordinal = ORDINAL.match(word)
    if ordinal:
        return f"{ordinal.group(1)}{ordinal.group(2).lower()}"

    # A one-letter word is a middle initial far more often than it is an
    # article: "STEPHEN A. SCHWARZMAN BUILDING".
    if minor_allowed and len(word) > 1 and word.lower() in MINOR_WORDS:
        return word.lower()

    if shouted.startswith("MC") and len(word) > 3 and word.isalpha():
        return f"Mc{word[2:].capitalize()}"

    return word.capitalize()


def title_case(value: str) -> str:
    """Make a shouted FacDB string readable.

    Best effort, and deliberately so: the alternative to a short rule set is
    showing people "125TH STREET LIBRARY", which the published contract does
    not. Mixed-case input is normalized the same way, because FacDB is not
    consistent about which rows shout.
    """
    parts = WORD_BOUNDARY.split(" ".join(value.split()))
    words = [index for index, part in enumerate(parts) if index % 2 == 0 and part]
    rebuilt: list[str] = []
    separator = ""
    for index, part in enumerate(parts):
        if index % 2:
            separator = part
            rebuilt.append(part)
            continue
        if not part:
            continue
        # A minor word only stays lowercase in the middle of a phrase. After a
        # bracket or a dash it begins one -- "Juilliard School (The)", "Rose
        # Hill-Lincoln" -- and FacDB truncates long names mid-word, which leaves
        # a trailing "A" that is not an article.
        inside = index not in (words[0], words[-1]) and separator.isspace()
        rebuilt.append(title_word(part, minor_allowed=inside))
    return "".join(rebuilt)


def operator(record: dict[str, Any]) -> str | None:
    """Who runs the place, where the city records it.

    This is the one field that connects a branch to its library system, and
    nothing else in the record does. A branch is named after its neighborhood --
    "Howard Beach", "Fresh Meadows", "Glendale" -- so without this there is no
    way to find the 67 Queens Public Library branches by asking for them.

    FacDB fills it meaningfully for the 226 public branches (91 New York Public
    Library, 68 Brooklyn, 67 Queens) and repeats the facility's own name for the
    academic and special libraries, where it adds nothing and does no harm.

    Not title-cased. Upstream already capitalises this field, unlike ``facname``,
    and running it through title_case() would leave "Nyu Tamiment Library"
    exactly as wrong as it arrives.
    """
    return text(record.get("opname"))


def spot_id(record: dict[str, Any]) -> str:
    uid = text(record.get("uid"))
    if not uid:
        raise IngestError(f"An upstream record has no uid: {record.get('facname')!r}.")
    return f"{SOURCE_PREFIX}:{uid}"


def category(record: dict[str, Any]) -> str | None:
    """The published category, or ``None`` for a deliberately excluded type."""
    facility_type = text(record.get("factype"))
    if facility_type is None:
        raise IngestError(f"Record {spot_id(record)} has no facility type.")
    try:
        return CATEGORY_BY_FACILITY_TYPE[facility_type.upper()]
    except KeyError:
        # Inventing a category here would publish a guess as data, and mapping
        # it to the nearest existing one would bury the change. FacDB added a
        # type; someone has to decide what it is.
        raise IngestError(
            f"Record {spot_id(record)} has the unmapped facility type {facility_type!r}. "
            "Add it to CATEGORY_BY_FACILITY_TYPE, or map it to None to exclude it."
        ) from None


def borough(record: dict[str, Any]) -> str:
    name = text(record.get("boro"))
    if name is None:
        raise IngestError(f"Record {spot_id(record)} has no borough.")
    try:
        return BOROUGH_BY_FACILITY_BOROUGH[name.upper()]
    except KeyError:
        raise IngestError(
            f"Record {spot_id(record)} is in {name!r}, which is not one of the five boroughs."
        ) from None


def street_address(record: dict[str, Any]) -> str | None:
    """The address as the contract publishes it, or ``None``.

    FacDB leaves the street address off a few dozen library branches. The
    remaining pieces -- a city and a zip code -- are not an address, so the
    field stays null rather than becoming ", New York, NY 11208".
    """
    street = text(record.get("address"))
    if street is None:
        return None

    parts = [title_case(street)]
    city = text(record.get("city"))
    if city:
        parts.append(title_case(city))
    zipcode = text(record.get("zipcode"))
    parts.append(f"NY {zipcode}" if zipcode else "NY")
    return ", ".join(parts)


def neighborhood_names(rows: list[Any]) -> dict[str, str]:
    names: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = text(row.get("nta2020"))
        name = text(row.get("ntaname"))
        if code and name:
            names[code] = name
    if not names:
        raise IngestError("The neighborhood dataset supplied no 2020 NTA names.")
    return names


def neighborhood(record: dict[str, Any], names: dict[str, str], identifier: str) -> str | None:
    """The 2020 NTA name, or ``None`` when the source does not place the record.

    Both upstream datasets carry ``nta2020``, which is the whole reason cafes
    could join this snapshot without a point-in-polygon test against the
    boundary geometry. The identifier is passed in rather than derived: a
    Dining Out row has no ``uid`` for :func:`spot_id` to read.
    """
    code = text(record.get("nta2020"))
    if code is None:
        return None
    name = names.get(code)
    if name is None:
        # The two datasets are revised on their own schedules, so a code can
        # outrun the boundary file. Publishing the code instead would put a
        # string like "MN1102" where the contract promises a name.
        warn(f"no 2020 NTA name for {code!r}; leaving {identifier} without a neighborhood")
    return name


def cafe_id(name: str, address: str) -> str:
    """A stable identifier for one storefront.

    Dining Out publishes no row identifier that survives a re-licensing, so the
    identity has to be derived. Name and address together are what distinguishes
    one storefront from another, and both stay put between runs, which is what
    :func:`write_snapshot` needs to produce a stable diff.
    """
    digest = hashlib.sha1(f"{name}|{address}".encode()).hexdigest()[:16]
    return f"{CAFE_PREFIX}:{digest}"


def cafe_address(record: dict[str, Any]) -> str | None:
    """The address as the contract publishes it, or ``None``.

    Dining Out names the pieces differently from FacDB -- ``street`` and
    ``postcode`` rather than ``address`` and ``zipcode`` -- and stores them in
    upper case, so they are title-cased here as the facility names are.
    """
    street = text(record.get("street"))
    if street is None:
        return None

    parts = [title_case(street)]
    city = text(record.get("city"))
    if city:
        parts.append(title_case(city))
    postcode = text(record.get("postcode"))
    parts.append(f"NY {postcode}" if postcode else "NY")
    return ", ".join(parts)


def cafe_spot(record: dict[str, Any], names: dict[str, str]) -> dict[str, Any] | None:
    """Map one Dining Out row onto the contract, or ``None`` if it cannot be.

    ``assumed_name_s`` is the name over the door; ``business_legal_name`` is the
    entity that holds the licence, and is usually something like "CGM-LLNR LLC".
    Nobody searches for that, so the trading name is preferred and the legal one
    is only a fallback.
    """
    name = text(record.get("assumed_name_s")) or text(record.get("business_legal_name"))
    address = cafe_address(record)
    latitude = coordinate(record, "latitude", 90.0)
    longitude = coordinate(record, "longitude", 180.0)
    named_borough = text(record.get("borough"))

    # A licence with no name, address, borough or coordinates describes nothing
    # anyone could walk to. Unlike a facility this does not fail the import: the
    # register is maintained for licensing rather than for mapping, and a
    # handful of rows are missing a borough at any given time.
    if name is None or address is None or latitude is None or longitude is None:
        return None
    if named_borough is None:
        return None
    # Dining Out already title-cases the borough where FacDB shouts it; the
    # same mapping serves both because it is keyed on the upper-cased name.
    where = BOROUGH_BY_FACILITY_BOROUGH.get(named_borough.upper())
    if where is None:
        return None

    return {
        "id": cafe_id(name, address),
        "name": title_case(name),
        "category": CAFE_CATEGORY,
        "address": address,
        "neighborhood": neighborhood(record, names, cafe_id(name, address)),
        "borough": where,
        "latitude": latitude,
        "longitude": longitude,
        # Filled in by normalize(), from the rest of the snapshot.
        "university": None,
        # Dining Out carries `business_legal_name`, the entity holding the
        # licence, which is "CGM-LLNR LLC" where the trading name is "JEAN'S".
        # That is a registration rather than an operator anyone would search
        # for, so cafes have none.
        "operator": None,
        "free_public_wifi": False,
    }


def coordinate(record: dict[str, Any], field: str, limit: float) -> float | None:
    raw = record.get(field)
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise IngestError(f"Record {spot_id(record)} has a non-numeric {field}: {raw!r}.") from None
    if not math.isfinite(value) or abs(value) > limit:
        raise IngestError(f"Record {spot_id(record)} has an out-of-range {field}: {value!r}.")
    return round(value, COORDINATE_DIGITS)


def haversine_metres(
    latitude: float, longitude: float, other_latitude: float, other_longitude: float
) -> float:
    first, second = math.radians(latitude), math.radians(other_latitude)
    delta_latitude = second - first
    delta_longitude = math.radians(other_longitude - longitude)
    arc = (
        math.sin(delta_latitude / 2) ** 2
        + math.cos(first) * math.cos(second) * math.sin(delta_longitude / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METRES * math.asin(math.sqrt(arc))


def hotspot_points(rows: list[Any]) -> list[tuple[float, float]]:
    """Usable coordinates from the Wi-Fi rows, ignoring ungeocoded ones."""
    points: list[tuple[float, float]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        latitude = coordinate(row, "latitude", 90.0)
        longitude = coordinate(row, "longitude", 180.0)
        if latitude is not None and longitude is not None:
            points.append((latitude, longitude))
    return points


def has_free_wifi(latitude: float, longitude: float, hotspots: list[tuple[float, float]]) -> bool:
    """Whether a free public hotspot sits within :data:`WIFI_RADIUS_METRES`.

    False means no free hotspot is recorded near the spot, which is not the same
    as there being no Wi-Fi: an NYU building has Wi-Fi that needs NYU
    credentials, and the city's dataset has no reason to know about it. The
    field answers "can anyone use Wi-Fi here", which is the question a study
    spot raises.
    """
    # A degree of latitude is about 111 km everywhere, and a degree of longitude
    # at least 78 km at New York's latitude, so this box can only ever be
    # generous. It turns a million haversine calls into a few thousand.
    margin = WIFI_RADIUS_METRES / 78_000.0

    return any(
        abs(spot_latitude - latitude) <= margin
        and abs(spot_longitude - longitude) <= margin
        and haversine_metres(latitude, longitude, spot_latitude, spot_longitude)
        <= WIFI_RADIUS_METRES
        for spot_latitude, spot_longitude in hotspots
    )


def nearest_campus(latitude: float, longitude: float, campuses: list[Campus]) -> str | None:
    """The closest curated campus within ``CAMPUS_RADIUS_METRES``, if any.

    Proximity, not affiliation: see this module's docstring.
    """
    nearby = [
        (haversine_metres(latitude, longitude, campus.latitude, campus.longitude), campus.name)
        for campus in campuses
    ]
    # Sorting on the name too keeps two equidistant campuses from making the
    # snapshot depend on the order upstream happened to return rows in.
    within = sorted(pair for pair in nearby if pair[0] <= CAMPUS_RADIUS_METRES)
    return within[0][1] if within else None


def normalize(
    facilities: list[Any], cafes: list[Any], names: dict[str, str], hotspots: list[Any]
) -> list[dict[str, Any]]:
    """The whole mapping, from raw upstream records to contract records.

    Both registers are normalized here rather than in separate passes so that
    the two derivations that depend on the whole snapshot -- the Wi-Fi
    proximity test and the nearest campus -- are applied once, to everything,
    and cannot drift between sources.
    """
    spots: list[dict[str, Any]] = []
    skipped = 0

    for record in facilities:
        if not isinstance(record, dict):
            raise IngestError("An upstream record is not a JSON object.")

        published_category = category(record)
        if published_category is None:
            continue

        name = text(record.get("facname"))
        if name is None:
            raise IngestError(f"Record {spot_id(record)} has no name.")

        latitude = coordinate(record, "latitude", 90.0)
        longitude = coordinate(record, "longitude", 180.0)
        if latitude is None or longitude is None:
            # Nothing can place these on a map, and the model requires both.
            # Upstream ungeocoded rows should not fail a whole import.
            skipped += 1
            continue

        spots.append(
            {
                "id": spot_id(record),
                "name": title_case(name),
                "category": published_category,
                "address": street_address(record),
                "neighborhood": neighborhood(record, names, spot_id(record)),
                "borough": borough(record),
                "latitude": latitude,
                "longitude": longitude,
                # Filled in below: it depends on the rest of the snapshot.
                "university": None,
                "operator": operator(record),
                "free_public_wifi": False,
            }
        )

    if skipped:
        warn(f"skipped {skipped} record(s) without coordinates")

    # Licences, not facilities: one storefront can hold more than one, and a
    # re-licensing issues a new row for a cafe that was already here. Keyed on
    # the derived identifier, which is the storefront rather than the licence.
    by_id: dict[str, dict[str, Any]] = {}
    unusable = 0
    for record in cafes:
        if not isinstance(record, dict):
            raise IngestError("An upstream record is not a JSON object.")
        spot = cafe_spot(record, names)
        if spot is None:
            unusable += 1
            continue
        by_id[spot["id"]] = spot

    if unusable:
        warn(f"skipped {unusable} licence(s) that could not be placed")
    duplicates = len(cafes) - unusable - len(by_id)
    if duplicates:
        warn(f"merged {duplicates} repeat licence(s) onto storefronts already seen")
    spots.extend(by_id.values())

    points = hotspot_points(hotspots)
    for spot in spots:
        spot["free_public_wifi"] = has_free_wifi(spot["latitude"], spot["longitude"], points)

    campuses = [
        Campus(spot["name"], spot["latitude"], spot["longitude"])
        for spot in spots
        if spot["category"] == CAMPUS_CATEGORY
    ]
    for spot in spots:
        if spot["category"] == CAMPUS_CATEGORY:
            spot["university"] = spot["name"]
        elif spot["category"] == CAFE_CATEGORY:
            # Cafes are third places in their own right, not somewhere you
            # reach through a campus, so the field stays null however close one
            # happens to be. A library beside a campus is plausibly *its*
            # library; the cafe on the same corner is just a cafe.
            #
            # The measurement that settled it: 41% of cafes picked up a label
            # here, and tightening the radius made it worse rather than better.
            # FacDB stores one point per institution whatever its size, so
            # Columbia's whole campus is a single coordinate and its nearest
            # cafe is 181 m away, while a school occupying one floor has one at
            # 67 m. Any radius strips the universities students attend before
            # it strips the vocational schools nobody is looking for.
            spot["university"] = None
        else:
            spot["university"] = nearest_campus(spot["latitude"], spot["longitude"], campuses)

    # Campus records anchor the derivation above and are then dropped rather
    # than published. A FacDB campus is an administrative point for an
    # institution, not a room: "Daemen University-Brooklyn Branch" is a
    # registration, and nobody can sit down in it. The application lists places
    # a person can actually go, and access to a campus is restricted anyway.
    #
    # They still have to be built, because the "near which campus" label on the
    # libraries is derived from exactly these coordinates. The curated NYU
    # buildings are the campus study space the snapshot does publish, and those
    # were recorded by hand from public building information.
    published = [spot for spot in spots if spot["category"] != CAMPUS_CATEGORY]

    validate(published)
    # Identifiers rather than names: a renamed facility then moves one line of
    # the snapshot instead of shifting every record after it.
    return sorted(published, key=lambda spot: spot["id"])


def curated_spots(path: Path = CURATED_PATH) -> list[dict[str, Any]]:
    """Read the hand-maintained building records.

    These arrive already in the shared contract rather than in an upstream
    shape, so the work here is checking that they still match it. A hand-edited
    file is exactly where a typo or a field outside the contract appears, and
    finding it here names the record instead of failing at load time.
    """
    if not path.exists():
        raise IngestError(f"No curated building list at {path}.")

    records = json.loads(path.read_text("utf-8"))
    if not isinstance(records, list):
        raise IngestError(f"{path} must contain a JSON array of study spots.")

    spots: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise IngestError(f"Curated record {index} is not a JSON object.")

        name = record.get("id", index)
        missing = [field for field in CONTRACT_FIELDS if field not in record]
        if missing:
            raise IngestError(f"Curated record {name!r} is missing {missing}.")

        extra = sorted(set(record) - set(CONTRACT_FIELDS))
        if extra:
            raise IngestError(f"Curated record {name!r} has fields outside the contract: {extra}.")

        # Rebuilt in contract order: validate() compares the key order itself,
        # and a hand-edited file has no reason to preserve it.
        spots.append({field: record[field] for field in CONTRACT_FIELDS})

    return spots


def combine(
    facilities: list[dict[str, Any]], curated: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge the curated buildings over the open-data records.

    A curated entry wins an identifier collision, because it was written by
    someone who checked the building and the open-data row was not. Collisions
    should not happen -- the two sources use different identifier prefixes --
    but an importer that silently kept the wrong one would be worse than one
    that prefers the deliberate record.

    The curated entries keep the ``university`` they were given. For an
    open-data record that field is the nearest campus within 500 m; for these it
    is the institution whose building it is, which is the stronger claim the
    contract allows for a campus record.
    """
    merged = {spot["id"]: spot for spot in facilities}
    merged.update({spot["id"]: spot for spot in curated})

    spots = sorted(merged.values(), key=lambda spot: spot["id"])
    validate(spots)
    return spots


def validate(spots: list[dict[str, Any]]) -> None:
    """Refuse a snapshot ``load_spots`` would reject.

    The loader validates every record too, but it runs at deployment time and
    inside a Lambda function. Failing here points at the importer instead.
    """
    seen: set[str] = set()
    for spot in spots:
        if tuple(spot) != CONTRACT_FIELDS:
            raise IngestError(
                f"Record {spot['id']} does not match the shared contract: {list(spot)}."
            )
        if spot["id"] in seen:
            # Two records with one identifier means uid is not the identity it
            # is being used as, and the load would quietly keep one of them.
            raise IngestError(f"Duplicate identifier {spot['id']!r}.")
        seen.add(spot["id"])
        for field in ("name", "category", "borough"):
            if not isinstance(spot[field], str) or not spot[field]:
                raise IngestError(f"Record {spot['id']} has an empty {field}.")
        for field in ("address", "neighborhood", "university"):
            if spot[field] is not None and not str(spot[field]).strip():
                raise IngestError(f"Record {spot['id']} has a blank {field}; it should be null.")


def write_snapshot(path: Path, spots: list[dict[str, Any]]) -> None:
    # ensure_ascii=False keeps "García" readable in the diff; the loader and the
    # API are UTF-8 throughout.
    path.write_text(json.dumps(spots, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Normalize NYC Open Data into the study-spot snapshot."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Where to write the snapshot (default: %(default)s).",
    )
    parser.add_argument(
        "--fixtures",
        type=Path,
        nargs="?",
        const=DEFAULT_FIXTURES,
        default=None,
        help=(
            "Read the committed upstream sample from this directory instead of the network "
            f"(default when the flag is given: {DEFAULT_FIXTURES})."
        ),
    )
    options = parser.parse_args(argv)

    try:
        facilities, cafes, neighborhoods, hotspots = read_sources(options.fixtures)
        spots = combine(
            normalize(facilities, cafes, neighborhood_names(neighborhoods), hotspots),
            curated_spots(),
        )
    except IngestError as error:
        warn(str(error))
        return 1

    write_snapshot(options.output, spots)
    counts = Counter(spot["category"] for spot in spots)
    summary = ", ".join(f"{count} {name}" for name, count in sorted(counts.items()))
    wifi = sum(1 for spot in spots if spot["free_public_wifi"])
    print(f"wrote {len(spots)} spots ({summary}; {wifi} with free public wifi) to {options.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
