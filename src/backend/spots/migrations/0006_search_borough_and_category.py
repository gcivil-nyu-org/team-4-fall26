"""Add borough and category to what free-text search matches against.

Written by hand because Django refuses to alter a GeneratedField -- "the field
must be removed and re-added with the new definition" -- so the column is
dropped and rebuilt, and the index with it. Postgres recomputes the vector for
every row as it adds the column back, which is a table rewrite: instant at 1,916
rows, and worth knowing about before this table is large.

Without these two fields the phrases people actually type did not work.
"bronx public library" found three spots and put a Manhattan one first;
"manhattan library" found five of the sixty-eight. Both have a filter of their
own, but a search box is where someone types them first.

They cannot flood a result set, because the full-text pass requires every word
to match: "bobst library" still returns the one library named Bobst. A bare
"cafe" does grow to every cafe, which is what the word means.
"""

import django.contrib.postgres.indexes
import django.contrib.postgres.search
from django.db import migrations, models

#: The two fields joined at the lowest weight, alongside the address. A word in
#: the name still outranks the same word in a borough by an order of magnitude;
#: see FIELD_WEIGHTS in spots/search.py.
SEARCH_VECTOR = models.GeneratedField(
    db_persist=True,
    expression=(
        django.contrib.postgres.search.SearchVector("name", config="english", weight="A")
        + django.contrib.postgres.search.SearchVector("university", config="english", weight="B")
        + django.contrib.postgres.search.SearchVector("neighborhood", config="english", weight="C")
        + django.contrib.postgres.search.SearchVector("address", config="english", weight="D")
        + django.contrib.postgres.search.SearchVector("borough", config="english", weight="D")
        + django.contrib.postgres.search.SearchVector("category", config="english", weight="D")
    ),
    output_field=django.contrib.postgres.search.SearchVectorField(),
)

SEARCH_INDEX = django.contrib.postgres.indexes.GinIndex(
    fields=["search_vector"], name="spots_search_idx"
)


class Migration(migrations.Migration):
    dependencies = [
        ("spots", "0005_university_excludes_cafes"),
    ]

    operations = [
        # The index goes first and comes back last: it is built on the column,
        # so it cannot outlive it, and Django's migration state has to be told
        # rather than left to infer it from the cascade.
        migrations.RemoveIndex(model_name="studyspot", name="spots_search_idx"),
        migrations.RemoveField(model_name="studyspot", name="search_vector"),
        migrations.AddField(
            model_name="studyspot",
            name="search_vector",
            field=SEARCH_VECTOR,
        ),
        migrations.AddIndex(model_name="studyspot", index=SEARCH_INDEX),
    ]
