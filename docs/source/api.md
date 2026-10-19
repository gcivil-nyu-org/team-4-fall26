# HTTP API

The API is available directly at `http://localhost:7501` and through the frontend proxy under `http://localhost:7500/api`. Deployments publish it under `/api`, and both edges strip that prefix before the request reaches the application, so the routes below are the same everywhere.

No route has a trailing slash, and the application does not redirect one onto the other: `/spots/` is a 404 rather than a 301 to `/spots`.

## Implemented routes

| Route | Purpose |
|---|---|
| `GET /health/live` | Reports whether the API process can serve requests. It intentionally does not contact Postgres. |
| `GET /spots` | Returns a filtered, paginated page of study spots. |
| `GET /spots/{id}` | Returns one study spot. |

`GET /health/live` returns:

```json
{
  "status": "ok"
}
```

## Study-spot summary

```json
{
  "id": "facdb:eec118768e15a5e03d3354abda7b00da",
  "name": "125th Street Library",
  "category": "public_library",
  "address": "224 East 125 Street, New York, NY 10035",
  "neighborhood": "East Harlem (North)",
  "borough": "Manhattan",
  "latitude": 40.803027,
  "longitude": -73.934853,
  "university": "Touro University - Harlem",
  "operator": "New York Public Library",
  "free_public_wifi": true,
  "no_purchase_needed": true
}
```

The records represent public third places from NYC Open Data — today the libraries and campuses of the city's facilities database. They are candidate gathering and study locations; the API must not imply that unverified amenities are available. This response shape belongs to the shared contract. Changes require review from frontend, API, data, and search owners.

`category` currently takes one of `cafe`, `public_library`, `special_library`, `academic_library` and `university_building`.

`public_library` and `special_library` are kept apart because the difference is the one a reader cares about: a branch of NYPL, BPL or QPL is somewhere anyone can walk into, while a special library is an institutional collection — a club's, a society's, a hospital's — and many are open by appointment or to members only.

`university_building` is a campus building a student can work in. The city's facilities database registers institutions and administrative points rather than buildings, so these come from the curated list in `data/nyu_buildings.json` and all carry the `nyu:` identifier prefix. The institution records themselves are *not* published: an administrative point is not a room, and campus access is restricted. They are read only to anchor the `university` label.

`cafe` comes from the outdoor-dining licence register: see [Data and search](data-and-search.md). The API does not constrain the value: the vocabulary belongs to the importer, and pinning it in the serving schema would put every category change through a migration.

`no_purchase_needed` is true where sitting down costs nothing — every library and every campus building, and no café. It answers the question a reader actually has, which no single category answers, and **it is about money rather than entry**: a campus building is free and still wants the university's credentials, and a special library may be open only by appointment.

It is the one field the API publishes that `data/spots.json` does not store. It is a pure function of `category`, so a column would be a copy that can fall out of step with the value beside it, and computing it in the browser would put the same rule in two languages. `NO_PURCHASE_CATEGORIES` in `spots/models.py` is the single definition, and it is an allowlist so that a category added upstream is never silently published as free. `free_public_wifi` is true when a free public Wi-Fi hotspot the city publishes
sits within 25 m, derived from `yjub-udmw`. False means none is recorded, which
is not the same as there being no Wi-Fi: a campus building's network needs the
university's credentials, and the city has no reason to know about it. The field
answers whether *anyone* can use Wi-Fi there. `borough` is one of the five
borough names and the database refuses any other. `neighborhood` is the 2020 Neighborhood Tabulation Area name and is `null` when NYC Open Data does not place the record in one.

```{important}
`university` is an addition to the previously agreed contract and still needs owner sign-off. It is proximity and nothing else: it names the closest campus within 500 metres, or the campus itself for a campus record, and is `null` when no campus is that close. The campus list is curated — the college and university records of the city's facilities database — and the field is never guessed from a spot's name, its operator, or anything else. It is not an affiliation, an endorsement, or an access claim: a named campus does not mean the institution is connected to the spot or that the public may use the room. In the example above, 169 metres separate a public library branch from a campus with no relationship to it.

Cafés never carry one. A café is a third place in its own right rather than somewhere reached through a campus, and the measurement bears that out: FacDB stores a single point per institution whatever its size, so Columbia's whole campus is one coordinate with its nearest café 181 metres away, while a school occupying one floor has one at 67 metres. Any radius would drop the universities students attend before the vocational schools nobody is looking for.
```

## Listing study spots

`GET /spots` returns one page of spots inside a stable envelope:

```json
{
  "items": [],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "count": 0,
    "total": 1900,
    "has_more": false
  }
}
```

`total` counts every spot matching the filters, ignoring the page window. `count` is the number of items on this page, and `has_more` is true when `offset + count < total`.

Results are ordered by name, then by identifier. Because the identifier is unique, that sort key is total, so paging over an unchanged dataset never repeats or skips a spot. What the contract promises is that the order does not move between requests, not the exact sequence: where in the alphabet punctuation and digits fall is the database collation's business.

### Query parameters

| Parameter | Type | Default | Behavior |
|---|---|---|---|
| `name` | string | — | Case-insensitive substring match. `%` and `_` are matched literally. |
| `neighborhood` | string | — | Case-insensitive exact match. |
| `borough` | string | — | Case-insensitive exact match on one of the five borough names. |
| `university` | string | — | Case-insensitive exact match. Spots with no curated campus affiliation are excluded. |
| `limit` | integer | `20` | Page size, between 1 and 100. |
| `offset` | integer | `0` | Rows to skip before the page starts. |

Filters combine with AND. Text filters are trimmed, must not be blank, and are limited to 120 characters. A `borough` value is also normalized for internal spacing, so `?borough=brooklyn` and `?borough=  Staten   Island ` both resolve.

Case-insensitivity covers the whole of Unicode, not only ASCII, so `?name=café` and `?name=CAFÉ` return the same spots. Folding is the database's, applied identically to the stored value and the filter value, and every environment runs a UTF-8 cluster; the one place it is less aggressive than the previous implementation is `ß`, which Postgres does not fold to `ss`, so "strasse" does not match "Straße". See [Why no column declares a collation](database.md#why-no-column-declares-a-collation).

Unknown query parameters are rejected rather than ignored, so a misspelled filter fails loudly instead of silently returning unfiltered results:

```shell
curl --fail 'http://localhost:7501/spots?borough=Brooklyn&name=library&limit=5'
```

## Errors

Every non-2xx response uses one envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request could not be validated.",
    "details": [
      {
        "field": "query.limit",
        "message": "Ensure this value is less than or equal to 100.",
        "type": "max_value"
      }
    ]
  }
}
```

`code` is stable and machine-readable; `message` is for people. `details` lists one entry per offending input and is empty when no single input is at fault.

| Status | `code` | Raised when |
|---|---|---|
| 404 | `not_found` | No spot has the requested identifier. |
| 405 | `method_not_allowed` | The route exists but the method does not. |
| 422 | `validation_error` | A parameter is missing, malformed, out of range, or unrecognized. |
| 500 | `internal_error` | An unhandled failure. The cause is logged, never returned. |
| 503 | `database_unavailable` | Postgres could not answer the query, or has never been migrated. |

## Filtering

Both `GET /spots` and `GET /spots/search` take the same filters: `neighborhood`,
`borough`, `category`, `university`, `free_public_wifi`, and `no_purchase_needed`. They combine with
AND, so supplying two narrows rather than widens, and on the search endpoint
they narrow the candidates *before* ranking. Filtering after ranking would drop
the best matches out of a page rather than out of the result set, and the
reported total would describe something the caller never sees.

`free_public_wifi` and `no_purchase_needed` each take `true` or `false`. False
is a filter in its own right -- places that do expect a purchase, which is every
café -- not the absence of one.

A present but empty parameter is a `422`, the same as an unrecognized one: a
filter whose value was lost should fail rather than quietly widen the search.

### `GET /spots/facets`

```json
{
  "boroughs": [{ "value": "Manhattan", "count": 151 }],
  "categories": [{ "value": "library", "count": 248 }],
  "universities": [{ "value": "New York University", "count": 12 }],
  "free_public_wifi": 465,
  "no_purchase_needed": 264
}
```

What the filters can be set to, with how many spots carry each value. A client
cannot derive this from the contract: `borough` is five fixed names, but the
category vocabulary belongs to the importer and the campuses are whatever the
snapshot contains, so a hard-coded list would silently stop matching when the
data changes. Counts are included because offering a value that matches nothing
is worse than not offering it.

`free_public_wifi` and `no_purchase_needed` are single numbers rather than lists
of values, because the controls they serve are checkboxes: the only useful count
is how many spots remain when each is ticked.

The endpoint takes every filter the listing endpoints take, plus `q`, all
optional, and no `limit` or `offset` -- a facet list is as long as the number of
distinct values, and paging it would mean a control that offers only some of
them. With nothing supplied it describes the whole snapshot.

**Each count reflects the request already in force, except for its own filter.**
A count is a promise about what picking that value returns, and counted over the
whole table every one of them stops being true the moment anything else is
narrowing the results: under `?borough=Bronx` the unfiltered category counts
would still offer a type the Bronx does not contain. Its own filter is left out
so that a chosen value does not hide the alternatives -- with `?borough=Bronx`
all five boroughs are still listed, so there is a way to switch, while
`categories`, `universities`, `free_public_wifi` and `no_purchase_needed` narrow
to the Bronx.

A client that filters should refetch this whenever the filters or the query
change, which is one request per interaction. Returning results and facets in
one response would avoid that; two requests is the cost of keeping ranking and
counting in Postgres.

## Searching

`GET /spots/search?q=` ranks spots instead of filtering them, in the same
envelope `GET /spots` returns. It takes `q`, the filters above, `limit` and
`offset`, rejects any other parameter, and orders results by relevance rather
than by name.

The difference matters at the search box. `GET /spots` answers "does this
match": `?name=libary` returns nothing, and so does `?name=NYPL`. `search`
answers "which of these is closest", so both find what the person meant.

### Two passes

Finding every word someone typed and surviving a misspelling pull in opposite
directions, so they are separate passes and the order is the design.

**Full text runs first.** The query goes through `websearch_to_tsquery` and
every word has to appear somewhere in the row, matched against four fields that
count for different amounts:

| Field | Weight | Why |
|---|---|---|
| `name` | highest | what the place is called is almost always what was meant |
| `university`, `operator` | second | which institution this is — the campus it sits by, and who runs it |
| `neighborhood` | third | where it is, not what it is |
| `address`, `borough`, `category` | lowest | a place *called* Washington beats the places *on* Washington Street |

`operator` is who runs the place, and it is the only field that connects a
branch to its library system: a branch is named after its neighbourhood —
*Howard Beach*, *Fresh Meadows*, *Glendale* — so nothing else in the record says
whether it is NYPL, BPL or QPL. Without it `qpl` found two spots; with it, 68.
It is null for cafés, whose licence names only the company holding it, and for
academic and special libraries it simply repeats the facility's own name.

`borough` and `category` are matched despite each having a filter of its own,
because a search box is where people type them first. Without them
`bronx public library` found three spots and put a Manhattan one first, and
`manhattan library` found five of the sixty-eight.

They cannot flood a result set, because every word still has to match:
`bobst library` returns the one library named Bobst, since only one row matches
both words. A bare `cafe` does grow to every café, which is what the word means.
The category needs no transformation either -- Postgres splits on the
underscore, so `public_library` indexes exactly as `public library` does.

Requiring every word is what keeps `library bobst` to the one library it
describes. Scoring the query against the best-matching run of words instead --
which is what the trigram pass does -- gave it 170 results, because "library"
alone matches every library in the city.

Weighting `university` is the other half. It is proximity rather than
affiliation, but it is the only field that connects a campus to the buildings
around it: in the current snapshot 14 spots relate to NYU and just 3 say so in
their name, so searching names alone missed 11 of them.

Because this pass is `websearch_to_tsquery`, it inherits that parser's syntax
for free: `"washington square"` in quotes must match as a phrase, and a leading
`-` excludes, so `library -bobst` is every library except that one. Neither can
raise a syntax error on something typed into a box.

**Trigrams run only if that found nothing.** A misspelling produces a word
Postgres has never indexed, so full text cannot match `libary` at all. The
fallback compares the query against the best-matching run of words in the name,
and the same lower-weighted against the neighborhood, dropping anything below a
relevance of 0.45.

That figure was measured rather than chosen: a one-character typo in a
seven-letter word scores 0.5, and unrelated words sit near 0.33. At 0.6
`libary` matches nothing, which is the failure the pass exists to prevent.

Running the passes the other way round would undo the first one -- a typo-
tolerant match on "library" would bury the exact hit for `library bobst` -- so
the fuzzy pass only ever runs when the precise one has already failed. Choosing
between them costs one `EXISTS`; the alternative is blending a rank that
measures *where* a word was found with a similarity that measures *how close*
it was, into one number nobody could reason about.

### Initialisms

An initialism is expanded before the query reaches Postgres, because no fuzzy
algorithm connects `NYPL` to `New York Public Library` -- they share almost no
trigrams. Every word is expanded, so `nyu library` becomes `New York University
library` and means it. The list is in `spots/search.py`.

**The expansion is a hint, not a replacement.** If it matches nothing, the
literal term gets a turn before the fuzzy pass does. `CUNY` is the case that
proved it necessary: it expands to `City University of New York`, which no
record contains -- the campuses are named `CUNY Hunter College` -- so the single
attempt failed and the query fell through to trigrams, where `New York Cit...`
is a close match for *New York City Bagel & Coffee House*. Typing CUNY returned
bagel shops. The fuzzy pass now also runs on what was typed rather than on the
expansion, so nothing is ever matched against words the search box substituted.

### As you type

A prefix scores highly and the full-text pass is indexed, so this endpoint also
serves search-as-you-type: `bob` ranks *Elmer Holmes Bobst Library* without
anything being submitted. The browser calls it on a debounced keystroke rather
than only on submit.

The relevance score is not in the response. It exists to order results, and
publishing it would be a number the contract has to keep stable for no one's
benefit.

## Planned routes

- `GET /health/ready`

The readiness route will report required dependency failures.
