"""Request and response serializers for the study-spot routes.

These belong to the HTTP layer rather than to ``models.py``: paging and query
validation are the route's concern, while the model is what the API, the loader,
and the search projection all agree on.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from .models import (
    DEFAULT_LIMIT,
    MAX_FILTER_LENGTH,
    MAX_LIMIT,
    NO_PURCHASE_CATEGORIES,
    Borough,
    StudySpot,
)


class StudySpotSerializer(serializers.ModelSerializer):
    """The shared study-spot summary.

    The field list is explicit rather than ``__all__``: this response shape is
    the shared contract, and a column added to the model should not silently
    become part of the public API.
    """

    #: Derived here rather than stored, and rather than left to the browser.
    #:
    #: It is a pure function of ``category``, so a column would be a copy that
    #: can fall out of step with the value beside it. Computing it in the
    #: browser instead would put the same rule in two languages, which is the
    #: drift this avoids: ``NO_PURCHASE_CATEGORIES`` stays the one definition
    #: and every consumer reads the answer.
    #:
    #: This is why the API publishes one field more than ``data/spots.json``
    #: stores. The snapshot holds what the city supplied; this is what the
    #: contract says about it.
    no_purchase_needed = serializers.SerializerMethodField()

    def get_no_purchase_needed(self, spot: StudySpot) -> bool:
        return spot.category in NO_PURCHASE_CATEGORIES

    class Meta:
        model = StudySpot
        fields = [
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
            "no_purchase_needed",
        ]


class BoroughField(serializers.CharField):
    """A borough name in any casing or internal spacing.

    ``?borough=brooklyn`` and ``?borough=  Staten   Island `` both resolve, which
    is the behaviour the published contract describes.
    """

    def to_internal_value(self, data: Any) -> str:
        value = super().to_internal_value(data)
        wanted = " ".join(value.split()).casefold()
        for borough in Borough.values:
            if borough.casefold() == wanted:
                return borough
        raise serializers.ValidationError(
            f"Must be one of the five boroughs: {', '.join(Borough.values)}."
        )


def filter_field(help_text: str) -> serializers.CharField:
    """A trimmed, non-blank, bounded filter value."""
    return serializers.CharField(
        required=False,
        trim_whitespace=True,
        min_length=1,
        max_length=MAX_FILTER_LENGTH,
        help_text=help_text,
    )


def borough_field() -> BoroughField:
    """The borough filter, which every spot endpoint accepts identically."""
    return BoroughField(
        required=False,
        trim_whitespace=True,
        min_length=1,
        max_length=MAX_FILTER_LENGTH,
        help_text="Case-insensitive exact match on one of the five boroughs.",
    )


def cost_field() -> serializers.BooleanField:
    """The no-purchase filter.

    ``false`` is a filter in its own right -- places that do expect a purchase,
    which is every cafe -- rather than the absence of one.
    """
    return serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
        help_text=(
            "Restrict to places where sitting down costs nothing, or to those where "
            "it does not. About money rather than entry: a campus building is free "
            "and still wants the university's credentials."
        ),
    )


def wifi_field() -> serializers.BooleanField:
    """The Wi-Fi filter. ``false`` is a filter in its own right, not its absence."""
    return serializers.BooleanField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Restrict to spots with, or without, free public Wi-Fi nearby.",
    )


def limit_field() -> serializers.IntegerField:
    return serializers.IntegerField(
        required=False,
        default=DEFAULT_LIMIT,
        min_value=1,
        max_value=MAX_LIMIT,
        help_text=f"Page size, 1 to {MAX_LIMIT}.",
    )


def offset_field() -> serializers.IntegerField:
    return serializers.IntegerField(
        required=False,
        default=0,
        min_value=0,
        help_text="Rows to skip before this page.",
    )


class StrictQuerySerializer(serializers.Serializer):
    """A query string in which every parameter must be known and non-empty.

    Shared by all three spot endpoints rather than written out in each: they
    have to agree on this, and three copies of it would be three chances to
    drift apart.
    """

    def to_internal_value(self, data: Any) -> dict[str, Any]:
        """Reject parameters this endpoint does not define, and blank values.

        A misspelled filter that is silently ignored returns a plausible page of
        the wrong results, which is worse than an error. The FastAPI
        implementation forbade extra fields for the same reason.
        """
        unknown = sorted(set(data) - set(self.fields))
        if unknown:
            raise serializers.ValidationError(
                {name: "Unknown query parameter." for name in unknown}
            )

        # ``?name=`` has to be rejected explicitly. A QueryDict is HTML input as
        # far as DRF is concerned, and for an optional field that does not allow
        # blanks, DRF reads an empty value as "not supplied" and drops it. The
        # published contract treats a present-but-empty parameter as a bad
        # request, and silently widening a search because its value was lost is
        # the same failure as ignoring a misspelled one.
        blank = sorted(
            name
            for name in self.fields
            if name in data and isinstance(data[name], str) and not data[name].strip()
        )
        if blank:
            raise serializers.ValidationError(
                {name: "This field may not be blank." for name in blank}
            )

        return super().to_internal_value(data)


class SpotQuerySerializer(StrictQuerySerializer):
    """Query parameters for ``GET /spots``. Unknown parameters are rejected."""

    name = filter_field("Case-insensitive substring match on the spot name.")
    neighborhood = filter_field("Case-insensitive exact match on the neighborhood name.")
    category = filter_field(
        "Case-insensitive exact match on the category. The vocabulary belongs to the "
        "importer rather than to this endpoint, so the values a snapshot actually "
        "contains are what GET /spots/facets reports."
    )
    free_public_wifi = wifi_field()
    no_purchase_needed = cost_field()
    borough = borough_field()
    university = filter_field(
        "Case-insensitive exact match on the institution a spot belongs to. Only "
        "records the importer takes from a curated campus list carry one, so "
        "every other spot is excluded when this filter is used."
    )

    limit = limit_field()
    offset = offset_field()


class SpotSearchQuerySerializer(StrictQuerySerializer):
    """Query parameters for ``GET /spots/search``. Unknown parameters are rejected."""

    q = serializers.CharField(
        trim_whitespace=True,
        min_length=1,
        max_length=MAX_FILTER_LENGTH,
        help_text="Free text matched against the spot name and neighborhood.",
    )

    # The same filters the listing endpoint takes. They narrow the candidates
    # before ranking, so "library" restricted to the Bronx ranks the Bronx
    # libraries rather than ranking everything and hiding most of it.
    neighborhood = filter_field("Case-insensitive exact match on the neighborhood name.")
    borough = borough_field()
    category = filter_field("Case-insensitive exact match on the category.")
    university = filter_field("Case-insensitive exact match on the campus.")
    free_public_wifi = wifi_field()
    no_purchase_needed = cost_field()

    limit = limit_field()
    offset = offset_field()


class SpotFacetsQuerySerializer(StrictQuerySerializer):
    """Query parameters for ``GET /spots/facets``.

    Every filter either listing endpoint accepts, plus ``q``, all optional. The
    endpoint reports what the filters can be set to *given the request already
    in force*, so it has to be told what that request is. With nothing supplied
    it describes the whole snapshot, which is what an unfiltered page needs.

    There is no ``limit`` or ``offset``: a facet list is as long as the number
    of distinct values, not as long as a page.
    """

    q = serializers.CharField(
        required=False,
        trim_whitespace=True,
        min_length=1,
        max_length=MAX_FILTER_LENGTH,
        help_text="The same free text GET /spots/search ranks by.",
    )

    name = filter_field("Case-insensitive substring match on the spot name.")
    neighborhood = filter_field("Case-insensitive exact match on the neighborhood name.")
    borough = borough_field()
    category = filter_field("Case-insensitive exact match on the category.")
    university = filter_field("Case-insensitive exact match on the campus.")
    free_public_wifi = wifi_field()
    no_purchase_needed = cost_field()
