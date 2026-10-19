"""Public study-spot routes."""

from __future__ import annotations

from typing import Any

from django.db.models import Count, QuerySet
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import NO_PURCHASE_CATEGORIES, StudySpot
from .search import search
from .serializers import (
    SpotFacetsQuerySerializer,
    SpotQuerySerializer,
    SpotSearchQuerySerializer,
    StudySpotSerializer,
)

#: Maps a validated query parameter to the lookup it filters with. Substring for
#: the name, exact for the rest, all case-insensitive. A `university` or
#: `neighborhood` filter therefore excludes rows where the column is NULL, which
#: is the documented behaviour.
LOOKUPS = {
    "name": "name__icontains",
    "category": "category__iexact",
    "neighborhood": "neighborhood__iexact",
    "borough": "borough__iexact",
    "university": "university__iexact",
    "free_public_wifi": "free_public_wifi",
}


def apply_filters(queryset: QuerySet[StudySpot], parameters: dict[str, Any]) -> QuerySet[StudySpot]:
    """Narrow ``queryset`` by every filter the caller supplied.

    Django escapes the LIKE wildcards in an ``icontains`` value, so a search for
    ``100%`` is a search for a literal percent sign.
    """
    lookups = {
        lookup: parameters[parameter]
        for parameter, lookup in LOOKUPS.items()
        if parameters.get(parameter) is not None
    }
    narrowed = queryset.filter(**lookups) if lookups else queryset
    return apply_cost(narrowed, parameters.get("no_purchase_needed"))


def apply_cost(queryset: QuerySet[StudySpot], wanted: bool | None) -> QuerySet[StudySpot]:
    """Narrow to places that cost nothing to sit in, or to those that do not.

    Kept out of LOOKUPS because it is not a column. There is no cost field on
    the model and there should not be: the answer is a property of the category
    vocabulary, so storing it would be a copy that can fall out of step with the
    category beside it.
    """
    if wanted is None:
        return queryset
    if wanted:
        return queryset.filter(category__in=NO_PURCHASE_CATEGORIES)
    return queryset.exclude(category__in=NO_PURCHASE_CATEGORIES)


class SpotListView(APIView):
    """``GET /spots`` -- a filtered, paginated page of study spots."""

    def get(self, request: Request) -> Response:
        query = SpotQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        parameters = query.validated_data

        limit: int = parameters["limit"]
        offset: int = parameters["offset"]

        matching = apply_filters(StudySpot.objects.all(), parameters)

        # Counted before slicing, because the envelope reports the size of the
        # whole result set rather than of this page.
        total = matching.count()
        items = StudySpotSerializer(matching[offset : offset + limit], many=True).data

        return Response(
            {
                "items": items,
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "count": len(items),
                    "total": total,
                    "has_more": offset + len(items) < total,
                },
            }
        )


class SpotDetailView(APIView):
    """``GET /spots/{id}`` -- one study spot."""

    def get(self, request: Request, spot_id: str) -> Response:
        try:
            spot = StudySpot.objects.get(pk=spot_id)
        except StudySpot.DoesNotExist:
            raise NotFound(f"No study spot has the identifier {spot_id!r}.") from None
        return Response(StudySpotSerializer(spot).data)


class SpotSearchView(APIView):
    """``GET /spots/search`` -- study spots ranked by how well they match ``q``.

    The envelope is the one ``GET /spots`` uses, so a caller can swap between
    filtering and searching without handling two response shapes. The relevance
    score is not part of it: it exists to order the results and would be a
    number the contract has to keep stable for no one's benefit.
    """

    def get(self, request: Request) -> Response:
        query = SpotSearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        parameters = query.validated_data

        limit: int = parameters["limit"]
        offset: int = parameters["offset"]

        # Filter first, then rank. The other order would drop the best
        # matches out of a page rather than out of the result set.
        matching = search(parameters["q"], apply_filters(StudySpot.objects.all(), parameters))

        total = matching.count()
        items = StudySpotSerializer(matching[offset : offset + limit], many=True).data

        return Response(
            {
                "items": items,
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "count": len(items),
                    "total": total,
                    "has_more": offset + len(items) < total,
                },
            }
        )


#: The fields ``GET /spots/facets`` reports values for, mapped to the response
#: key that carries each one. Wi-Fi is absent deliberately: a boolean has no
#: list of values to offer, so it is reported as a single count instead.
FACET_FIELDS = {
    "borough": "boroughs",
    "category": "categories",
    "university": "universities",
}


class SpotFacetsView(APIView):
    """``GET /spots/facets`` -- the values the filters can take, with counts.

    A filter control cannot be built from the contract alone: `borough` is five
    fixed names, but `category` belongs to the importer and the campuses are
    whatever the data happens to contain. Hard-coding either in the browser
    would mean a filter that silently stops matching when the snapshot changes.

    Counts come along because a filter offering a value that matches nothing is
    worse than not offering it. That is why this endpoint takes the request
    already in force: counted over the whole snapshot, every number stops
    describing what the caller would actually get the moment one filter is on,
    and the control goes on offering values that now match nothing.

    Each facet is counted with every *other* filter applied but not its own.
    Applying a facet's own filter to itself would leave one value standing --
    the one already chosen -- and no way to switch to another.
    """

    def get(self, request: Request) -> Response:
        query = SpotFacetsQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        parameters = query.validated_data

        base = StudySpot.objects.all()
        if parameters.get("q"):
            # Matched through a subquery rather than by counting the ranked
            # queryset directly. Grouping over it would pull search()'s
            # relevance expression and ordering into the GROUP BY, which counts
            # every row on its own; the subquery keeps the ranking where it
            # belongs and leaves a plain set of rows to aggregate.
            ranked = search(parameters["q"], base).order_by().values("pk")
            base = StudySpot.objects.filter(pk__in=ranked)

        def narrow(excluding: str) -> QuerySet[StudySpot]:
            """``base`` with every filter applied except ``excluding``."""
            others = {name: value for name, value in parameters.items() if name != excluding}
            return apply_filters(base, others)

        def counts(field: str) -> list[dict[str, Any]]:
            rows = (
                narrow(field)
                .exclude(**{f"{field}__isnull": True})
                # order_by() before grouping, because Django adds ordering
                # columns to the GROUP BY and the default Meta ordering would
                # otherwise split every value into one group per row.
                .order_by()
                .values(field)
                .annotate(count=Count("id"))
                .order_by("-count", field)
            )
            return [{"value": row[field], "count": row["count"]} for row in rows]

        body: dict[str, Any] = {key: counts(field) for field, key in FACET_FIELDS.items()}

        # One number rather than a list: the control is a checkbox, so the only
        # count worth having is how many spots are left when it is ticked.
        body["free_public_wifi"] = narrow("free_public_wifi").filter(free_public_wifi=True).count()
        body["no_purchase_needed"] = (
            narrow("no_purchase_needed").filter(category__in=NO_PURCHASE_CATEGORIES).count()
        )

        return Response(body)
