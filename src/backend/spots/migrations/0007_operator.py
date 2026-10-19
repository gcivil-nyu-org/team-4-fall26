"""Record who runs a place, and let search find it by them.

A library branch is named after its neighborhood -- "Howard Beach", "Fresh
Meadows", "Glendale" -- so nothing in the record said which system runs it.
FacDB has always carried it in ``opname``; the importer simply did not take it.
Without it "qpl" could not find the 67 Queens Public Library branches, because
not one of them says so in any other field.

Hand-written for the same reason as 0006: Django refuses to alter a
GeneratedField, so the vector column is dropped and rebuilt around the new
field, and its index with it. The operator column has to exist first, because
the vector reads it.
"""

import django.contrib.postgres.indexes
import django.contrib.postgres.search
from django.db import migrations, models

#: Weight B, beside the campus: both answer "which institution is this", and it
#: is what puts a system's own branches above incidental matches.
SEARCH_VECTOR = models.GeneratedField(
    db_persist=True,
    expression=(
        django.contrib.postgres.search.SearchVector("name", config="english", weight="A")
        + django.contrib.postgres.search.SearchVector("university", config="english", weight="B")
        + django.contrib.postgres.search.SearchVector("operator", config="english", weight="B")
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
        ("spots", "0006_search_borough_and_category"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyspot",
            name="operator",
            field=models.TextField(
                blank=True,
                null=True,
                help_text=(
                    "Who runs the place, where the city records it. For a public library "
                    "branch this is its system -- New York, Brooklyn or Queens Public "
                    "Library -- which nothing else in the record says: branches are named "
                    "after their neighborhood. Absent for cafes, whose licence names only "
                    "the company holding it."
                ),
            ),
        ),
        migrations.RemoveIndex(model_name="studyspot", name="spots_search_idx"),
        migrations.RemoveField(model_name="studyspot", name="search_vector"),
        migrations.AddField(
            model_name="studyspot",
            name="search_vector",
            field=SEARCH_VECTOR,
        ),
        migrations.AddIndex(model_name="studyspot", index=SEARCH_INDEX),
    ]
