"""Ranked study-spot search.

``GET /spots`` filters: a value either matches or it does not, and the order is
alphabetical. That is the right behaviour for a filter and the wrong one for a
search box, where "libary" and "kimel" are what people actually type and
returning nothing is indistinguishable from having no data.

This module ranks instead, in two passes, because the two things a search box
has to do pull in opposite directions. Finding every word the person typed is a
question of precision; surviving a misspelling is a question of tolerance, and a
rule loose enough for the second is far too loose for the first.

**Full text first.** Postgres parses the query with ``websearch_to_tsquery`` and
requires *every* word to appear somewhere in the row, across four fields with
different weights: the name counts for most, then the campus, the neighborhood
and the address. Requiring all of them is what keeps "library bobst" to the one
library it describes instead of to every library in the city, and searching the
campus is what lets "NYU" find the buildings that never say so in their name --
14 spots relate to NYU and only 3 name it.

**Trigrams if that found nothing.** A misspelling produces a word Postgres has
never indexed, so full text cannot match it at all. Only then does the older
rule run: trigram similarity against the best-matching run of words in the name,
and the same lower-weighted against the neighborhood, with anything below
:data:`THRESHOLD` dropped so an unrelated query returns nothing rather than
everything.

The order matters more than either rule. Tried the other way round, a typo-
tolerant match for "library" would bury the exact hit for "library bobst"; this
way the fuzzy pass only ever runs when the precise one has already failed.

Both passes lean on an index: ``spots_search_idx`` over the generated
``search_vector`` column for the first, and the ``gin_trgm_ops`` indexes for the
second.
"""

from __future__ import annotations

from django.contrib.postgres.search import SearchQuery, SearchRank, TrigramWordSimilarity
from django.db.models import Case, F, FloatField, QuerySet, Value, When
from django.db.models.functions import Coalesce, Greatest

from .models import StudySpot

#: Below this, a trigram result is noise.
#:
#: Measured against the real snapshot rather than guessed. A one-character typo
#: in a seven-letter word scores 0.5 -- "libary" against "Library" -- and
#: unrelated words sit around 0.33, so the useful range is narrow. Anything from
#: 0.45 to 0.5 returns identical results on the queries that matter; 0.45 is the
#: low end of that band, so the common typo clears it with margin instead of
#: landing exactly on it. At 0.6 "libary" matches nothing at all, which is the
#: failure this whole module exists to prevent.
#:
#: It applies only to the trigram pass. The full-text pass needs no threshold:
#: requiring every word to be present is itself the filter, and scoring there
#: decides order rather than membership.
THRESHOLD = 0.45

#: Scores for the non-fuzzy rules, above anything similarity or rank returns so
#: that a literal match always outranks an approximate one.
EXACT = 1.0
PREFIX = 0.95
SUBSTRING = 0.9
NEIGHBORHOOD_EXACT = 0.85

#: Weight applied to fuzzy matches on the neighborhood, so that a place *called*
#: Greenpoint outranks a place *in* Greenpoint.
NEIGHBORHOOD_WEIGHT = 0.7

#: Relative worth of a match in each weighted field, in the order Postgres wants
#: them: D, C, B, A -- address, neighborhood, campus, name.
#:
#: The gaps are wide on purpose. A query word in the name should beat the same
#: word in an address outright rather than on a tiebreak, because "Washington"
#: almost always means a place called Washington and almost never means any of
#: the places on Washington Street.
FIELD_WEIGHTS = [0.1, 0.2, 0.6, 1.0]

#: ``ts_rank_cd`` is unbounded, which would let a long row outscore the literal
#: rules above. 32 is the Postgres flag for rank / (rank + 1), which compresses
#: it into 0..1 and keeps every score in this module on one scale.
RANK_NORMALIZATION = 32

#: Initialisms nobody spells out, expanded before the query reaches Postgres.
#:
#: No fuzzy algorithm connects "NYPL" to "New York Public Library" -- they share
#: almost no trigrams -- so this is a lookup rather than something cleverer.
INITIALISMS = {
    "nypl": "New York Public Library",
    "bpl": "Brooklyn Public Library",
    "qpl": "Queens Public Library",
    "nyu": "New York University",
    "cuny": "City University of New York",
    "suny": "State University of New York",
    "snfl": "Stavros Niarchos Foundation Library",
}


def expand(query: str) -> str:
    """Expand every word of ``query`` that is a known initialism.

    This used to expand only when the whole query was one, because against a
    single trigram comparison replacing one word of several changed what the
    rest was measured against in ways that were hard to predict. Full text has
    no such problem: it matches word by word, so "nyu library" can become "New
    York University library" and mean exactly what it says.
    """
    return " ".join(INITIALISMS.get(word.casefold(), word) for word in query.split())


def _tsquery(query: str) -> SearchQuery:
    """The query as Postgres full text understands it.

    ``websearch`` is the forgiving parser: it ANDs bare words, takes a quoted
    phrase literally, and treats a leading ``-`` as exclusion, none of which can
    raise a syntax error on something a person typed into a box.
    """
    return SearchQuery(query, config="english", search_type="websearch")


def precise(query: str, queryset: QuerySet[StudySpot]) -> QuerySet[StudySpot]:
    """Rows containing every word of ``query``, best first."""
    tsquery = _tsquery(query)

    return (
        queryset.filter(search_vector=tsquery)
        .annotate(
            relevance=Greatest(
                # Kept from the trigram rules: full-text rank alone does not
                # guarantee that typing a name exactly puts that row first.
                Case(
                    When(name__iexact=query, then=Value(EXACT)),
                    When(name__istartswith=query, then=Value(PREFIX)),
                    default=Value(0.0),
                    output_field=FloatField(),
                ),
                SearchRank(
                    F("search_vector"),
                    tsquery,
                    weights=Value(FIELD_WEIGHTS),
                    normalization=Value(RANK_NORMALIZATION),
                ),
                output_field=FloatField(),
            )
        )
        .order_by(F("relevance").desc(), "name", "id")
    )


def score(query: str) -> Greatest:
    """Build the trigram ranking expression for ``query``."""
    return Greatest(
        # Literal matches, strongest first. Case() stops at the first match, so
        # an exact name never also scores as a substring.
        Case(
            When(name__iexact=query, then=Value(EXACT)),
            When(name__istartswith=query, then=Value(PREFIX)),
            When(name__icontains=query, then=Value(SUBSTRING)),
            When(neighborhood__iexact=query, then=Value(NEIGHBORHOOD_EXACT)),
            default=Value(0.0),
            output_field=FloatField(),
        ),
        TrigramWordSimilarity(query, "name"),
        # Coalesce because neighborhood is null for some records and a null
        # here would otherwise propagate through the comparison.
        Coalesce(
            TrigramWordSimilarity(query, "neighborhood") * Value(NEIGHBORHOOD_WEIGHT),
            Value(0.0),
            output_field=FloatField(),
        ),
        output_field=FloatField(),
    )


def tolerant(query: str, queryset: QuerySet[StudySpot]) -> QuerySet[StudySpot]:
    """Rows close enough to ``query`` to be worth showing, best first."""
    return (
        queryset.annotate(relevance=score(query))
        .filter(relevance__gte=THRESHOLD)
        .order_by(F("relevance").desc(), "name", "id")
    )


def search(query: str, queryset: QuerySet[StudySpot] | None = None) -> QuerySet[StudySpot]:
    """Return spots matching ``query``, best first.

    ``queryset`` narrows the candidates before they are ranked, which is the
    order filtering and searching have to happen in: ranking first and filtering
    after would drop the best matches out of a page rather than out of the
    result set, and the count would describe something the caller never sees.

    Ties break on name then id, the same total ordering ``GET /spots`` uses, so
    that paging through results is stable when many share a score.

    Choosing the pass costs one ``EXISTS`` each, which is a cheap price for not
    having to reconcile two scoring schemes into one number: full text ranks by
    where a word was found, trigrams by how close it was, and a blend of the two
    would be a figure nobody could reason about.
    """
    base = StudySpot.objects.all() if queryset is None else queryset
    expanded = expand(query)

    # The expansion is a hint, not a replacement, so the literal term gets a
    # turn before the fuzzy pass does.
    #
    # "CUNY" is the case that proved it. It expands to "City University of New
    # York", which no record contains -- the campuses are named "CUNY Hunter
    # College" and carry CUNY in their campus field -- so the only attempt
    # failed and the query fell through to trigrams, where "New York Cit..." is
    # a close match for "New York City Bagel & Coffee House". Typing CUNY
    # returned bagel shops. Trying "cuny" itself finds the five real campuses.
    attempts = [expanded, query] if expanded != query else [query]
    for attempt in attempts:
        matches = precise(attempt, base)
        if matches.exists():
            return matches

    # Trigrams on what was actually typed, never on the expansion. Fuzzy
    # matching against words the person did not write is how the bagels got in:
    # "libary" should reach "Library", and nothing should reach a phrase the
    # search box silently substituted.
    return tolerant(query, base)


__all__ = [
    "FIELD_WEIGHTS",
    "INITIALISMS",
    "THRESHOLD",
    "expand",
    "precise",
    "score",
    "search",
    "tolerant",
]
