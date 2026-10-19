"""The shared study-spot contract, as a Django model.

One model serves the HTTP API, the dataset loader, and any future search
projection, so those cannot drift apart.

Nullability follows what NYC Open Data actually supplies rather than what would
be convenient. In the committed snapshots, ``address`` and ``neighborhood`` are
both genuinely absent for some records, so requiring them would reject real
rows. ``university`` is absent for every record the importer does not take from
a curated campus list, which is most of them.
"""

from __future__ import annotations

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector, SearchVectorField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Upper

#: Page size defaults for ``GET /spots``, part of the published contract.
DEFAULT_LIMIT = 20
MAX_LIMIT = 100

#: Filter values are trimmed, must not be blank, and are bounded.
MAX_FILTER_LENGTH = 120

#: Categories where sitting down costs nothing.
#:
#: This answers the question a student actually asks -- "can I work here without
#: buying something?" -- which no single category answers: it is true of all the
#: libraries and of the campus buildings, and false only of cafes.
#:
#: **It is about money and not about entry.** A special library may be open by
#: appointment, an academic library may want a university ID, and an NYU
#: building wants NYU credentials. The contract has no field for access and the
#: application promises none; this one says only that nobody will ask you to buy
#: a coffee.
#:
#: An allowlist rather than its inverse, so that a category added upstream is
#: not silently published as free. The vocabulary belongs to ``data/ingest.py``
#: and this is the one place the API has an opinion about it, so the two have to
#: be changed together.
NO_PURCHASE_CATEGORIES = frozenset(
    {
        "public_library",
        "special_library",
        "academic_library",
        "university_building",
    }
)


class Borough(models.TextChoices):
    """The five New York City boroughs."""

    MANHATTAN = "Manhattan", "Manhattan"
    BROOKLYN = "Brooklyn", "Brooklyn"
    QUEENS = "Queens", "Queens"
    BRONX = "Bronx", "Bronx"
    STATEN_ISLAND = "Staten Island", "Staten Island"


class StudySpot(models.Model):
    """One study spot.

    ``category`` is a free string rather than an enumeration: the vocabulary
    belongs to the data importer, and pinning it here would force every category
    change through the shared contract and a migration.

    Case-insensitive filters go through Django's ``icontains`` and ``iexact``,
    which is why this table has no case-folded companion columns. The previous
    SQLite-backed version needed them because SQLite only folds ASCII; Postgres
    folds the whole of Unicode, provided every column involved uses the database
    collation. See the note on ``name`` below for what happens when one does not.

    One behavioural difference survives the change from the folded columns:
    Python's ``str.casefold()`` maps ``ß`` to ``ss`` and Postgres ``UPPER()``
    does not, so a search for "strasse" no longer matches "Straße". No record in
    the NYC snapshots is affected.
    """

    #: Identifiers are prefixed with their source dataset, as in
    #: ``facdb:eec118768e15a5e03d3354abda7b00da``.
    id = models.TextField(
        primary_key=True,
        help_text="Stable identifier, prefixed with its source dataset.",
    )

    # Neither of these columns declares a collation, and that is deliberate.
    #
    # An earlier version pinned both to "C" to make Meta.ordering byte-wise, on
    # the theory that the database's own locale could let two different names tie
    # in the sort key and so serve one row on two pages. That theory was wrong:
    # the ordering is (name, id) and `id` is a unique primary key, so the
    # tiebreaker already makes the sort total and deterministic under any
    # deterministic collation. Which collation is used only changes what order
    # the names come out in, not whether paging is stable.
    #
    # It was also actively harmful. Django compiles `icontains` and `iexact` to
    # UPPER(column) LIKE UPPER(%s), and UPPER() folds according to the collation
    # of its argument. A "C"-collated column folds ASCII only, while the bound
    # parameter folds under the database collation, so the two sides disagree on
    # every non-ASCII letter: UPPER('café') is 'CAFÉ' for the parameter but
    # 'CAFé' for the column, and `name__iexact='Café Grumpy'` could not match the
    # row it was copied from. NYC Open Data is full of accented names.
    #
    # Leaving both columns on the database collation makes the two sides fold
    # identically, which is what matters -- it is correct whether the cluster was
    # initialised with en_US.UTF-8 or with C.
    name = models.TextField()

    category = models.TextField()
    address = models.TextField(blank=True, null=True)
    neighborhood = models.TextField(
        blank=True,
        null=True,
        help_text="Neighborhood name, when the source supplies one.",
    )
    borough = models.TextField(choices=Borough.choices)

    latitude = models.FloatField(
        validators=[MinValueValidator(-90.0), MaxValueValidator(90.0)],
    )
    longitude = models.FloatField(
        validators=[MinValueValidator(-180.0), MaxValueValidator(180.0)],
    )

    university = models.TextField(
        blank=True,
        null=True,
        help_text=(
            "The closest campus within 500 m, or the campus itself for a campus "
            "record. Proximity and never affiliation: a named campus does not mean "
            "the institution runs the place or that anyone may walk in. Cafes never "
            "carry one, being third places in their own right rather than somewhere "
            "reached through a campus."
        ),
    )

    operator = models.TextField(
        blank=True,
        null=True,
        help_text=(
            "Who runs the place, where the city records it. For a public library "
            "branch this is its system -- New York, Brooklyn or Queens Public "
            "Library -- which nothing else in the record says: branches are named "
            "after their neighborhood. Absent for cafes, whose licence names only "
            "the company holding it."
        ),
    )

    free_public_wifi = models.BooleanField(
        default=False,
        help_text=(
            "Whether a free public Wi-Fi hotspot the city publishes sits within 25 m. "
            "False means none is recorded, not that there is no Wi-Fi: a campus "
            "building's Wi-Fi needs the university's credentials and the city has no "
            "reason to know about it."
        ),
    )

    #: What free-text search matches against, maintained by Postgres rather
    #: than by application code: a generated column cannot fall out of step with
    #: the row the way a column the loader has to remember to update can.
    #:
    #: The weights are the ranking. A query word found in the name (A) counts
    #: for more than the same word in the campus (B), the neighborhood (C), or
    #: the address, borough and category (D), so "Washington" ranks a library
    #: called Washington above one on Washington Street. Campus is weighted
    #: second because it is the field that makes a search for a university find
    #: its buildings: 14 spots relate to NYU and only 3 say so in their name.
    #:
    #: The operator shares the campus's weight because it answers the same kind
    #: of question -- which institution is this -- and it is the only field that
    #: connects a branch to its library system. Without it "qpl" could not find
    #: the 67 Queens Public Library branches, because not one of them says so in
    #: any other field: they are named "Howard Beach" and "Fresh Meadows".
    #:
    #: Borough and category are in here despite each having a filter of its
    #: own, because without them the phrases people actually type did not work.
    #: "bronx public library" found three spots and put a Manhattan one first;
    #: "manhattan library" found five of the sixty-eight. They cannot flood a
    #: result set either, because the full-text pass requires every word to
    #: match: "bobst library" still returns the one library named Bobst, since
    #: only one row matches both words. A bare "cafe" does grow to every cafe,
    #: which is what the word means.
    #:
    #: The category needs no transformation. Postgres splits on the underscore,
    #: so "public_library" indexes exactly as "public library" does.
    search_vector = models.GeneratedField(
        expression=(
            SearchVector("name", weight="A", config="english")
            + SearchVector("university", weight="B", config="english")
            + SearchVector("operator", weight="B", config="english")
            + SearchVector("neighborhood", weight="C", config="english")
            + SearchVector("address", weight="D", config="english")
            + SearchVector("borough", weight="D", config="english")
            + SearchVector("category", weight="D", config="english")
        ),
        output_field=SearchVectorField(),
        db_persist=True,
    )

    class Meta:
        db_table = "spots"
        verbose_name = "study spot"
        verbose_name_plural = "study spots"

        #: Deterministic and total, so a row can never be repeated or skipped
        #: across pages.
        ordering = ["name", "id"]

        constraints = [
            # The field's `choices` are only enforced by full_clean(), which the
            # loader does not call on every row. The database should refuse a
            # sixth borough whatever wrote it.
            models.CheckConstraint(
                condition=models.Q(borough__in=Borough.values),
                name="spots_borough_known",
            ),
            models.CheckConstraint(
                condition=models.Q(latitude__gte=-90, latitude__lte=90),
                name="spots_latitude_range",
            ),
            models.CheckConstraint(
                condition=models.Q(longitude__gte=-180, longitude__lte=180),
                name="spots_longitude_range",
            ),
        ]

        indexes = [
            # Matches Meta.ordering, so paging is an index scan rather than a
            # sort of the whole table.
            models.Index(fields=["name", "id"], name="spots_order_idx"),
            # `iexact` compiles to UPPER(column) = UPPER(%s), so the index has to
            # be on the same expression to be usable.
            models.Index(Upper("neighborhood"), name="spots_neighborhood_idx"),
            models.Index(Upper("borough"), name="spots_borough_idx"),
            models.Index(Upper("university"), name="spots_university_idx"),
            models.Index(fields=["free_public_wifi"], name="spots_wifi_idx"),
            # Trigram indexes for the ranked search in spots/search.py. A GIN
            # index with gin_trgm_ops is what turns a similarity comparison
            # from a scan of every row into an index lookup, and it serves the
            # `icontains` filter on the same column too, which a btree cannot
            # because the pattern has a leading wildcard.
            GinIndex(
                fields=["name"],
                opclasses=["gin_trgm_ops"],
                name="spots_name_trgm_idx",
            ),
            GinIndex(
                fields=["neighborhood"],
                opclasses=["gin_trgm_ops"],
                name="spots_neighborhood_trgm_idx",
            ),
            # Full-text search is the other half of spots/search.py, and the
            # reason the column is persisted rather than computed per query:
            # search now runs on a debounced keystroke, so recomputing four
            # to_tsvector calls per row per request would be work repeated for
            # every letter typed.
            GinIndex(fields=["search_vector"], name="spots_search_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.borough})"
