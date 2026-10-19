"""Tests for the NYC Open Data importer.

These run against ``fixtures/``, a trimmed copy of what the two Socrata
datasets actually return, so the suite never depends on NYC Open Data being up
and CI needs no network. The fixture keeps the awkward records the backend's own
fixtures warn about -- an accented name, a name carrying SQL ``LIKE`` wildcards,
a branch with no address, an older extract with no 2020 NTA column, a facility
type the importer excludes on purpose -- because those are the records a mapping
quietly gets wrong.

What matters here is that the snapshot the importer writes is one the loader
accepts and the API can serve: nine fields, five boroughs, nulls rather than
blanks, and identifiers that do not move when upstream edits a name.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import ingest
import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"

#: The example record published in docs/source/api.md. The importer has to
#: reproduce it exactly: it is what the frontend, the API and the search index
#: were written against.
PUBLISHED_EXAMPLE = {
    "id": "facdb:eec118768e15a5e03d3354abda7b00da",
    "name": "125th Street Library",
    "category": "public_library",
    "address": "224 East 125 Street, New York, NY 10035",
    "neighborhood": "East Harlem (North)",
    "borough": "Manhattan",
    "latitude": 40.803027,
    "longitude": -73.934853,
    "university": "Touro University - Harlem",
    # FacDB's opname. The branch is named after its neighborhood and nothing
    # else in the record says which system runs it.
    "operator": "New York Public Library",
    # The fixture puts a free hotspot on this branch; see fixtures/wifi.json.
    "free_public_wifi": True,
}

#: The published vocabulary. `university_building` is a campus building a
#: student can work in, which FacDB has no equivalent for and only the curated
#: list supplies; `cafe` has no source at all yet.
CATEGORIES = {
    "public_library",
    "special_library",
    "academic_library",
    "university_building",
    "cafe",
}
BOROUGHS = {"Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"}


@pytest.fixture(scope="module")
def facilities() -> list[dict[str, Any]]:
    return ingest.fixture_rows(FIXTURES, "facilities")


@pytest.fixture(scope="module")
def names() -> dict[str, str]:
    return ingest.neighborhood_names(ingest.fixture_rows(FIXTURES, "neighborhoods"))


@pytest.fixture(scope="module")
def hotspots() -> list[dict[str, Any]]:
    return ingest.fixture_rows(FIXTURES, "wifi")


@pytest.fixture(scope="module")
def cafes() -> list[dict[str, Any]]:
    return ingest.fixture_rows(FIXTURES, "cafes")


@pytest.fixture(scope="module")
def spots(
    facilities: list[dict[str, Any]],
    names: dict[str, str],
    hotspots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """The facility half of the snapshot. Cafes have their own fixture below."""
    return ingest.normalize(facilities, [], names, hotspots)


@pytest.fixture(scope="module")
def cafe_spots(
    cafes: list[dict[str, Any]],
    names: dict[str, str],
) -> list[dict[str, Any]]:
    return [
        spot
        for spot in ingest.normalize([], cafes, names, [])
        if spot["category"] == ingest.CAFE_CATEGORY
    ]


def upstream(facilities: list[dict[str, Any]], facname: str) -> dict[str, Any]:
    """One raw record, copied so a test can edit it without affecting others."""
    return dict(next(record for record in facilities if record["facname"] == facname))


def published(spots: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(spot for spot in spots if spot["name"] == name)


class TestPublishedExample:
    def test_is_reproduced_field_for_field(self, spots: list[dict[str, Any]]) -> None:
        spot = next(spot for spot in spots if spot["id"] == PUBLISHED_EXAMPLE["id"])
        assert spot == PUBLISHED_EXAMPLE


class TestIdentifiers:
    def test_carry_the_source_prefix_and_the_upstream_key(
        self, facilities: list[dict[str, Any]], spots: list[dict[str, Any]]
    ) -> None:
        for spot in spots:
            prefix, _, digest = spot["id"].partition(":")
            assert prefix == "facdb"
            assert digest in {record["uid"] for record in facilities}

    def test_survive_an_upstream_edit_to_the_record(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # The loader replaces the table wholesale, so an identifier derived from
        # a record's contents would delete and recreate every row the city
        # corrected a typo in.
        record = upstream(facilities, "125TH STREET LIBRARY")
        edited = {
            **record,
            "facname": "125TH STREET BRANCH LIBRARY",
            "address": "224 E 125 STREET",
            "latitude": "40.8030269999",
        }
        assert ingest.normalize([edited], [], names, [])[0]["id"] == PUBLISHED_EXAMPLE["id"]

    def test_a_repeated_upstream_key_is_an_error(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        record = upstream(facilities, "125TH STREET LIBRARY")
        with pytest.raises(ingest.IngestError, match="Duplicate identifier"):
            ingest.normalize([record, {**record, "facname": "SOMEWHERE ELSE"}], [], names, [])

    def test_a_record_without_an_upstream_key_is_an_error(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        record = upstream(facilities, "125TH STREET LIBRARY")
        del record["uid"]
        with pytest.raises(ingest.IngestError, match="no uid"):
            ingest.normalize([record], [], names, [])


class TestCategories:
    @pytest.mark.parametrize(
        ("facname", "expected"),
        [
            ("125TH STREET LIBRARY", "public_library"),
            # A club's collection. Kept apart from the public branches because
            # the difference is the one a reader cares about: many special
            # libraries are open by appointment or to members only.
            ("THE GROLIER CLUB OF NEW YORK", "special_library"),
            ("COLUMBIA UNIVERSITY BUTLER LIBRARY", "academic_library"),
            ("COLUMBIA UNIVERSITY", "university"),
        ],
    )
    def test_upstream_types_map_onto_the_published_vocabulary(
        self, facilities: list[dict[str, Any]], facname: str, expected: str
    ) -> None:
        assert ingest.category(upstream(facilities, facname)) == expected

    def test_every_published_category_is_in_the_vocabulary(
        self, spots: list[dict[str, Any]]
    ) -> None:
        assert {spot["category"] for spot in spots} <= CATEGORIES

    def test_a_residence_is_excluded_rather_than_published(
        self, spots: list[dict[str, Any]]
    ) -> None:
        # People live there. The fixture carries CUNY's chancellor's residence
        # because FacDB files it under higher education.
        assert ingest.category({"uid": "x", "factype": "UNIVERSITY RESIDENTIAL STRUCTURE"}) is None
        assert not [spot for spot in spots if "Residence" in spot["name"]]

    def test_an_unmapped_type_fails_loudly(self, facilities: list[dict[str, Any]]) -> None:
        # Mapping it to the nearest existing category would publish a guess and
        # hide the fact that FacDB changed.
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "factype": "COWORKING SPACE"}
        with pytest.raises(ingest.IngestError, match="COWORKING SPACE"):
            ingest.category(record)


class TestBoroughs:
    def test_are_the_five_exact_names(self, spots: list[dict[str, Any]]) -> None:
        assert {spot["borough"] for spot in spots} == BOROUGHS

    def test_a_sixth_borough_is_an_error(self, facilities: list[dict[str, Any]]) -> None:
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "boro": "YONKERS"}
        with pytest.raises(ingest.IngestError, match="not one of the five boroughs"):
            ingest.borough(record)


class TestAbsentValues:
    def test_a_branch_without_an_address_publishes_null(self, spots: list[dict[str, Any]]) -> None:
        # FacDB has no street address for this branch. A city and a zip code are
        # not an address, so the field is null rather than ", Brooklyn, NY".
        assert published(spots, "Cypress Hills Library")["address"] is None

    def test_an_older_extract_without_the_nta_column_publishes_null(
        self, spots: list[dict[str, Any]]
    ) -> None:
        assert published(spots, "Great Kills Library")["neighborhood"] is None

    def test_nothing_is_published_as_a_blank_string(self, spots: list[dict[str, Any]]) -> None:
        # The contract distinguishes null from blank and the API returns null,
        # so an empty string would assert that the source supplied one.
        for spot in spots:
            for field in ("address", "neighborhood", "university"):
                assert spot[field] is None or spot[field].strip() == spot[field] != ""

    def test_a_record_without_coordinates_is_skipped(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "latitude": "", "longitude": ""}
        assert ingest.normalize([record], [], names, []) == []

    def test_a_non_numeric_coordinate_is_an_error(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "latitude": "uptown"}
        with pytest.raises(ingest.IngestError, match="non-numeric latitude"):
            ingest.normalize([record], [], names, [])


class TestNeighborhoods:
    def test_are_2020_nta_names(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "125th Street Library")["neighborhood"] == "East Harlem (North)"
        assert published(spots, "Columbia University Butler Library")["neighborhood"] == (
            "Morningside Heights"
        )

    def test_a_code_the_boundary_file_does_not_know_publishes_null(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # The two datasets are revised separately. Publishing "MN9999" would put
        # a code where the contract promises a name.
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "nta2020": "MN9999"}
        assert ingest.normalize([record], [], names, [])[0]["neighborhood"] is None


class TestUniversityIsProximity:
    def test_a_campus_is_an_anchor_and_not_a_spot(self, spots: list[dict[str, Any]]) -> None:
        # A FacDB campus is an administrative point for an institution rather
        # than a room -- nobody can sit down in a registration -- so it anchors
        # the label below without being published as somewhere to study.
        assert not [spot for spot in spots if spot["name"] == "Columbia University"]
        assert "university" not in {spot["category"] for spot in spots}

    def test_the_anchor_still_labels_what_is_near_it(self, spots: list[dict[str, Any]]) -> None:
        # Dropping the campus records must not drop the derivation they feed.
        assert published(spots, "Columbia University Butler Library")["university"] == (
            "Columbia University"
        )

    def test_a_spot_inside_the_radius_names_the_closest_campus(
        self, spots: list[dict[str, Any]]
    ) -> None:
        assert published(spots, "Columbia University Butler Library")["university"] == (
            "Columbia University"
        )

    def test_a_spot_with_no_campus_nearby_publishes_null(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "The Grolier Club of New York")["university"] is None

    def test_a_name_that_mentions_a_university_is_not_enough(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # Affiliation is never inferred from a name, an operator, or anything
        # else: only the curated campus list and a distance.
        far = {
            **upstream(facilities, "GREAT KILLS LIBRARY"),
            "facname": "COLUMBIA UNIVERSITY READING ROOM",
        }
        campus = upstream(facilities, "COLUMBIA UNIVERSITY")
        published_spots = ingest.normalize([far, campus], [], names, [])
        assert published(published_spots, "Columbia University Reading Room")["university"] is None

    def test_the_radius_is_500_metres(self) -> None:
        campus = ingest.Campus("Somewhere College", 40.8, -73.95)
        # Roughly 330 m and 670 m north of the campus.
        assert ingest.nearest_campus(40.803, -73.95, [campus]) == "Somewhere College"
        assert ingest.nearest_campus(40.806, -73.95, [campus]) is None

    def test_the_closest_of_several_campuses_wins(self) -> None:
        near = ingest.Campus("Near College", 40.8005, -73.95)
        far = ingest.Campus("Far College", 40.803, -73.95)
        assert ingest.nearest_campus(40.8, -73.95, [far, near]) == "Near College"

    def test_the_documented_distance_holds(self, facilities: list[dict[str, Any]]) -> None:
        library = upstream(facilities, "125TH STREET LIBRARY")
        campus = upstream(facilities, "TOURO UNIVERSITY - HARLEM")
        metres = ingest.haversine_metres(
            float(library["latitude"]),
            float(library["longitude"]),
            float(campus["latitude"]),
            float(campus["longitude"]),
        )
        assert 160 < metres < 180


class TestNames:
    @pytest.mark.parametrize(
        ("shouted", "expected"),
        [
            ("125TH STREET LIBRARY", "125th Street Library"),
            ("ST JOHN'S UNIVERSITY LIBRARY", "St John's University Library"),
            ("CUNY HUNTER COLLEGE", "CUNY Hunter College"),
            ("CUNY'S CHANCELLORS RESIDENCE", "CUNY's Chancellors Residence"),
            ("LIBRARY FOR ARTS & CULTURE", "Library for Arts & Culture"),
            ("JUILLIARD SCHOOL (THE)", "Juilliard School (The)"),
            ("AMERICAN ACAD MCALLISTER INST", "American Acad McAllister Inst"),
            ("FORDHAM UNIV (ROSE HILL-LINCOLN CTR)", "Fordham Univ (Rose Hill-Lincoln Ctr)"),
            ("NY COL OF PODIATRIC MEDICINE", "NY Col of Podiatric Medicine"),
            # FacDB truncates long names mid-word and writes middle initials
            # without one, so neither trailing "A" is an article.
            ("NEW YORK CONSERVATORY FOR DRAMATIC A", "New York Conservatory for Dramatic A"),
            ("STEPHEN A. SCHWARZMAN BUILDING", "Stephen A. Schwarzman Building"),
        ],
    )
    def test_shouted_upstream_names_become_readable(self, shouted: str, expected: str) -> None:
        assert ingest.title_case(shouted) == expected

    def test_accents_survive(self, spots: list[dict[str, Any]]) -> None:
        # The API folds case across the whole of Unicode, so "garcía" has to
        # match what is stored. Mangling the accent here would break that.
        assert published(spots, "Biblioteca Yolanda García")
        assert ingest.title_case("YOLANDA GARCÍA PARK") == "Yolanda García Park"

    def test_sql_wildcards_are_left_alone(self, spots: list[dict[str, Any]]) -> None:
        # `?name=` matches `%` and `_` literally, so the importer must not
        # rewrite or escape them -- the API's filter is what handles them.
        spot = published(spots, "100% Coffee Reading Room")
        assert "%" in spot["name"]
        assert ingest.title_case("100% COFFEE_HOUSE") == "100% Coffee_house"

    def test_punctuation_between_words_is_kept(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "Inwood Library–Joseph and Sheila Rosenblatt Building")


class TestSnapshot:
    def test_every_record_is_exactly_the_contract(self, spots: list[dict[str, Any]]) -> None:
        for spot in spots:
            assert tuple(spot) == ingest.CONTRACT_FIELDS

    def test_coordinates_are_rounded_to_six_places(self, spots: list[dict[str, Any]]) -> None:
        for spot in spots:
            assert spot["latitude"] == round(spot["latitude"], 6)
            assert spot["longitude"] == round(spot["longitude"], 6)
            assert -90 <= spot["latitude"] <= 90
            assert -180 <= spot["longitude"] <= 180

    def test_the_order_does_not_depend_on_the_upstream_order(
        self,
        facilities: list[dict[str, Any]],
        names: dict[str, str],
        hotspots: list[dict[str, Any]],
    ) -> None:
        # Socrata pages in whatever order it likes, and a reordered snapshot is
        # a diff of every line.
        assert ingest.normalize(list(reversed(facilities)), [], names, hotspots) == (
            ingest.normalize(facilities, [], names, hotspots)
        )

    def test_rerunning_writes_the_same_bytes(
        self,
        facilities: list[dict[str, Any]],
        names: dict[str, str],
        hotspots: list[dict[str, Any]],
        tmp_path: Path,
    ) -> None:
        first, second = tmp_path / "first.json", tmp_path / "second.json"
        for path in (first, second):
            ingest.write_snapshot(path, ingest.normalize(facilities, [], names, hotspots))
        assert first.read_bytes() == second.read_bytes()

    def test_a_record_outside_the_contract_is_an_error(self) -> None:
        with pytest.raises(ingest.IngestError, match="does not match the shared contract"):
            ingest.validate([{**PUBLISHED_EXAMPLE, "wifi": True}])


class TestCommandLine:
    def test_the_fixture_run_needs_no_network(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def refuse(*args: Any, **kwargs: Any) -> None:
            raise AssertionError("the fixture run reached the network")

        monkeypatch.setattr(ingest.urllib.request, "urlopen", refuse)
        output = tmp_path / "spots.json"
        assert ingest.main(["--fixtures", str(FIXTURES), "--output", str(output)]) == 0

        written = json.loads(output.read_text("utf-8"))
        # Nine published facility records -- eleven mapped, less the two
        # campuses, which anchor the proximity label without being spots --
        # and four cafes from six licences, one without a borough and one a
        # repeat of a storefront already seen. Plus the curated buildings,
        # which are read from the repository rather than from the network.
        assert len(written) == 9 + 4 + len(ingest.curated_spots())

    def test_a_missing_fixture_directory_is_reported_not_raised(self, tmp_path: Path) -> None:
        assert ingest.main(["--fixtures", str(tmp_path / "absent")]) == 1


@pytest.fixture(scope="module")
def snapshot() -> list[dict[str, Any]]:
    return json.loads((Path(__file__).resolve().parent / "spots.json").read_text("utf-8"))


class TestCommittedSnapshot:
    """The snapshot in version control, which is what deployments load."""

    def test_holds_real_records(self, snapshot: list[dict[str, Any]]) -> None:
        assert len(snapshot) > 100

    def test_matches_the_contract_the_loader_enforces(self, snapshot: list[dict[str, Any]]) -> None:
        ingest.validate(snapshot)
        assert {spot["borough"] for spot in snapshot} <= BOROUGHS
        assert {spot["category"] for spot in snapshot} <= CATEGORIES

    def test_is_sorted_and_unique_by_identifier(self, snapshot: list[dict[str, Any]]) -> None:
        identifiers = [spot["id"] for spot in snapshot]
        assert identifiers == sorted(identifiers)
        assert len(set(identifiers)) == len(identifiers)


@pytest.fixture
def curated() -> list[dict[str, Any]]:
    return ingest.curated_spots()


class TestCuratedBuildings:
    """The hand-maintained NYU list, which FacDB has no equivalent for.

    FacDB registers NYU as an institution and its schools as administrative
    points; none of them is a building a student can sit down in. These records
    are the only campus study space in the snapshot, so what matters is that a
    hand-edited file still satisfies the contract the loader enforces.
    """

    def test_every_record_matches_the_contract(self, curated: list[dict[str, Any]]) -> None:
        for spot in curated:
            assert tuple(spot) == ingest.CONTRACT_FIELDS

    def test_identifiers_carry_the_source_prefix(self, curated: list[dict[str, Any]]) -> None:
        # `nyu:` rather than `facdb:`, and a colon rather than a hyphen, so the
        # source stays parseable for anything that splits on the separator.
        for spot in curated:
            assert spot["id"].startswith("nyu:")

    def test_the_institution_is_named_rather_than_inferred(
        self, curated: list[dict[str, Any]]
    ) -> None:
        # For an open-data record `university` is the nearest campus within
        # 500 m. For these it is the institution whose building it is, which is
        # the stronger claim the contract allows for a campus record.
        for spot in curated:
            assert spot["university"] == "New York University"

    def test_a_missing_file_is_an_error(self, tmp_path: Path) -> None:
        with pytest.raises(ingest.IngestError, match="No curated building list"):
            ingest.curated_spots(tmp_path / "absent.json")

    def test_a_json_object_is_an_error(self, tmp_path: Path) -> None:
        path = tmp_path / "curated.json"
        path.write_text('{"id": "nyu:x"}', encoding="utf-8")
        with pytest.raises(ingest.IngestError, match="JSON array"):
            ingest.curated_spots(path)

    def test_a_missing_field_names_the_record(self, tmp_path: Path) -> None:
        path = tmp_path / "curated.json"
        path.write_text(json.dumps([{"id": "nyu:x", "name": "X"}]), encoding="utf-8")
        with pytest.raises(ingest.IngestError, match="nyu:x.*missing"):
            ingest.curated_spots(path)

    def test_a_field_outside_the_contract_is_an_error(
        self, tmp_path: Path, curated: list[dict[str, Any]]
    ) -> None:
        # A tenth field fails the load rather than being dropped, so the
        # importer refuses it where the record can still be named.
        record = {**curated[0], "wifi": True}
        path = tmp_path / "curated.json"
        path.write_text(json.dumps([record]), encoding="utf-8")
        with pytest.raises(
            ingest.IngestError, match="outside the shared contract|outside the contract"
        ):
            ingest.curated_spots(path)

    def test_key_order_is_rebuilt_rather_than_trusted(self, tmp_path: Path) -> None:
        # validate() compares key order, and a hand-edited file has no reason
        # to preserve it.
        reversed_record = {
            field: value
            for field, value in reversed(
                list(
                    {
                        "id": "nyu:x",
                        "name": "X",
                        "category": "university_building",
                        "address": None,
                        "neighborhood": None,
                        "borough": "Manhattan",
                        "latitude": 40.73,
                        "longitude": -73.99,
                        "university": "New York University",
                        "operator": "New York University",
                        "free_public_wifi": False,
                    }.items()
                )
            )
        }
        path = tmp_path / "curated.json"
        path.write_text(json.dumps(reversed_record and [reversed_record]), encoding="utf-8")

        assert tuple(ingest.curated_spots(path)[0]) == ingest.CONTRACT_FIELDS


class TestCombine:
    def test_both_sources_reach_the_snapshot(
        self, spots: list[dict[str, Any]], curated: list[dict[str, Any]]
    ) -> None:
        merged = ingest.combine(spots, curated)

        assert len(merged) == len(spots) + len(curated)
        assert any(spot["id"].startswith("facdb:") for spot in merged)
        assert any(spot["id"].startswith("nyu:") for spot in merged)

    def test_the_curated_record_wins_an_identifier_collision(
        self, spots: list[dict[str, Any]], curated: list[dict[str, Any]]
    ) -> None:
        # The prefixes make this impossible in practice; keeping the wrong one
        # silently would be worse than preferring the deliberate record.
        clash = {**curated[0], "id": spots[0]["id"]}

        merged = ingest.combine(spots, [clash])

        assert len(merged) == len(spots)
        assert next(s for s in merged if s["id"] == clash["id"])["name"] == clash["name"]

    def test_the_result_is_sorted_by_identifier(
        self, spots: list[dict[str, Any]], curated: list[dict[str, Any]]
    ) -> None:
        merged = ingest.combine(spots, curated)

        assert [spot["id"] for spot in merged] == sorted(spot["id"] for spot in merged)

    def test_a_curated_record_breaking_the_contract_fails_the_merge(
        self, spots: list[dict[str, Any]], curated: list[dict[str, Any]]
    ) -> None:
        broken = {**curated[0], "borough": ""}

        with pytest.raises(ingest.IngestError, match="empty borough"):
            ingest.combine(spots, [broken])


class TestFreePublicWifi:
    """The one amenity the open data can support.

    The claim is narrow on purpose: a free hotspot the city publishes sits
    within 25 m. It is not "this place has Wi-Fi", because a campus building's
    Wi-Fi needs the university's credentials and the city has no reason to know
    about it.
    """

    def test_a_hotspot_on_the_spot_counts(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "125th Street Library")["free_public_wifi"] is True

    def test_a_hotspot_a_metre_away_counts(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "Columbia University Butler Library")["free_public_wifi"] is True

    def test_a_hotspot_beyond_the_radius_does_not(self, spots: list[dict[str, Any]]) -> None:
        # The fixture puts one 40 m from this branch, outside the 25 m radius.
        # Widening the radius is what turns the field from "Wi-Fi here" into
        # "a kiosk somewhere on the block".
        assert published(spots, "Cypress Hills Library")["free_public_wifi"] is False

    def test_a_spot_with_no_hotspot_nearby_is_false(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "Great Kills Library")["free_public_wifi"] is False

    def test_an_ungeocoded_hotspot_is_ignored(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # The real dataset carries rows with no coordinates; they cannot place
        # anything and must not crash the import.
        rows = [{"objectid": "x", "latitude": None, "longitude": None}]
        assert all(
            spot["free_public_wifi"] is False
            for spot in ingest.normalize(facilities, [], names, rows)
        )

    def test_the_value_is_always_a_boolean(self, spots: list[dict[str, Any]]) -> None:
        # The loader writes a BooleanField; None would be rejected at load time.
        assert all(isinstance(spot["free_public_wifi"], bool) for spot in spots)

    def test_curated_campus_buildings_are_false(self) -> None:
        # They have Wi-Fi; it needs NYU credentials. The field answers whether
        # anyone can use it.
        assert all(spot["free_public_wifi"] is False for spot in ingest.curated_spots())

    def test_the_radius_is_tight_enough_to_mean_something(self) -> None:
        assert ingest.WIFI_RADIUS_METRES <= 50.0


class TestCafes:
    """Dining Out NYC, the source for the published ``cafe`` category.

    FacDB is a register of city facilities, so it holds libraries and campuses
    and not one cafe. Cafes are licensed rather than operated by the city, which
    is why they are in a licence register instead and why the category had no
    source until this one.
    """

    def by_name(self, spots: list[dict[str, Any]], name: str) -> dict[str, Any]:
        return next(spot for spot in spots if spot["name"] == name)

    def test_a_licence_becomes_a_cafe(self, cafe_spots: list[dict[str, Any]]) -> None:
        spot = self.by_name(cafe_spots, "Jean's")

        assert spot["category"] == "cafe"
        assert spot["borough"] == "Manhattan"
        assert spot["address"] == "415 Lafayette Street, New York, NY 10003"

    def test_the_identifier_names_the_source(self, cafe_spots: list[dict[str, Any]]) -> None:
        assert all(spot["id"].startswith("dining:") for spot in cafe_spots)

    def test_the_identifier_is_stable_across_runs(
        self, cafes: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # Dining Out publishes no row identifier that survives a re-licensing,
        # so it is derived from name and address. If it moved between runs the
        # snapshot would churn and every spot's URL would change.
        first = ingest.normalize([], cafes, names, [])
        again = ingest.normalize([], cafes, names, [])
        assert [spot["id"] for spot in first] == [spot["id"] for spot in again]

    def test_the_trading_name_is_preferred(self, cafe_spots: list[dict[str, Any]]) -> None:
        # "JEAN'S" is over the door; "CGM-LLNR LLC" holds the licence, and
        # nobody searches for that.
        assert self.by_name(cafe_spots, "Jean's")["name"] == "Jean's"

    def test_the_legal_name_is_the_fallback(self, cafe_spots: list[dict[str, Any]]) -> None:
        # One row in the fixture has no trading name at all.
        assert self.by_name(cafe_spots, "No Trading Name Corp") is not None

    def test_shouted_names_are_title_cased(self, cafe_spots: list[dict[str, Any]]) -> None:
        # The register stores them upper case, as FacDB does.
        assert self.by_name(cafe_spots, "The Butcher's Daughter")["name"] == (
            "The Butcher's Daughter"
        )

    def test_one_storefront_with_two_licences_is_one_spot(
        self, cafe_spots: list[dict[str, Any]]
    ) -> None:
        # The fixture holds the same address under two licence holders, which
        # is what a re-licensing looks like upstream.
        matching = [spot for spot in cafe_spots if spot["name"] == "The Butcher's Daughter"]
        assert len(matching) == 1

    def test_a_licence_with_no_borough_is_dropped(self, cafe_spots: list[dict[str, Any]]) -> None:
        # Not an error: the register is maintained for licensing rather than
        # for mapping, and a row that cannot be placed is simply not a spot.
        assert not [spot for spot in cafe_spots if spot["name"] == "Nowhere In Particular"]

    def test_a_cafe_gets_its_neighborhood_from_the_same_join(
        self, cafe_spots: list[dict[str, Any]]
    ) -> None:
        # Dining Out carries nta2020 just as FacDB does, which is the whole
        # reason cafes could join without a point-in-polygon test.
        assert self.by_name(cafe_spots, "Jean's")["neighborhood"] is not None

    def test_an_nta_code_with_no_name_leaves_the_neighborhood_null(
        self, cafe_spots: list[dict[str, Any]]
    ) -> None:
        spot = self.by_name(cafe_spots, "Code Ahead of the Boundary File")
        assert spot["neighborhood"] is None

    def test_every_cafe_matches_the_contract(self, cafe_spots: list[dict[str, Any]]) -> None:
        for spot in cafe_spots:
            assert tuple(spot) == ingest.CONTRACT_FIELDS

    def test_only_issued_sidewalk_licences_are_requested(self) -> None:
        # A licence that was applied for and never granted describes a cafe
        # that does not exist; a roadway licence is a structure in a parking
        # lane rather than somewhere to sit with a laptop.
        assert "license_status = 'Issued'" in ingest.CAFES_WHERE
        assert "license_type = 'Sidewalk'" in ingest.CAFES_WHERE


class TestCafesAreNotAttachedToCampuses:
    """A cafe is a third place in its own right.

    A library beside a campus is plausibly *its* library; the cafe on the same
    corner is just a cafe. The field would also have been unreliable: FacDB
    stores one point per institution whatever its size, so no radius separates
    the universities students attend from the vocational schools nobody is
    looking for.
    """

    def test_a_cafe_beside_a_campus_has_no_university(
        self, cafes: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # A campus placed on top of the first fixture cafe, so proximity cannot
        # be the reason the field is empty.
        first = ingest.normalize([], cafes, names, [])[0]
        campus = {
            "uid": "campus-on-the-doorstep",
            "facname": "RIGHT NEXT DOOR UNIVERSITY",
            "facsubgrp": "COLLEGES OR UNIVERSITIES",
            "factype": "4-YEAR INDEPENDENT",
            "boro": "MANHATTAN",
            "latitude": str(first["latitude"]),
            "longitude": str(first["longitude"]),
        }

        spots = ingest.normalize([campus], cafes, names, [])
        for spot in spots:
            if spot["category"] == ingest.CAFE_CATEGORY:
                assert spot["university"] is None

    def test_a_facility_beside_the_same_campus_still_gets_one(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        # The rule is about cafes, not about switching the derivation off.
        spots = ingest.normalize(facilities, [], names, [])
        assert any(spot["university"] for spot in spots if spot["category"] != "university")


class TestOperator:
    """The one field that connects a branch to its library system.

    A branch is named after its neighborhood -- "Howard Beach", "Fresh
    Meadows" -- so without this nothing in the record says who runs it, and
    asking for the Queens Public Library branches could not find them.
    """

    def test_a_branch_names_its_system(self, spots: list[dict[str, Any]]) -> None:
        assert published(spots, "125th Street Library")["operator"] == "New York Public Library"

    def test_it_is_not_title_cased(self, facilities: list[dict[str, Any]]) -> None:
        # Upstream already capitalises this field, unlike facname, so running
        # it through title_case() would only make it worse.
        record = {**upstream(facilities, "125TH STREET LIBRARY"), "opname": "NYU Tamiment Library"}
        assert ingest.operator(record) == "NYU Tamiment Library"

    def test_a_record_without_one_publishes_null(
        self, facilities: list[dict[str, Any]], names: dict[str, str]
    ) -> None:
        record = {**upstream(facilities, "125TH STREET LIBRARY")}
        record.pop("opname", None)
        assert ingest.normalize([record], [], names, [])[0]["operator"] is None

    def test_a_cafe_has_none(self, cafe_spots: list[dict[str, Any]]) -> None:
        # Dining Out carries the licence holder -- "CGM-LLNR LLC" where the
        # trading name is "JEAN'S" -- which is a registration rather than an
        # operator anyone would search for.
        assert all(spot["operator"] is None for spot in cafe_spots)

    def test_it_is_part_of_the_contract(self, spots: list[dict[str, Any]]) -> None:
        assert "operator" in ingest.CONTRACT_FIELDS
        for spot in spots:
            assert tuple(spot) == ingest.CONTRACT_FIELDS
