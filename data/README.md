# Study-spot data

This directory is the small boundary between NYC Open Data and StudySpot:

```text
NYC Open Data -> ingest.py -> spots.json
```

- `ingest.py` downloads NYC Open Data and normalizes it into the shared contract.
- `spots.json` is the canonical generated dataset consumed by the application.
- `test_ingest.py` tests the mapping.
- `fixtures/` is a trimmed copy of what the upstream datasets return, so the tests and
  `--fixtures` need no network.

Regenerating the snapshot is how the data changes:

```shell
just ingest
just load-data
```

`spots.json` stays in version control, so a checkout can load the serving table and run the API
without reaching NYC Open Data. Nothing writes to it at runtime. Database migrations, local
database files, and search indexes do not belong here; the backend's `load_spots` management
command copies this snapshot into the Postgres serving table, replacing its contents in one
transaction.

A spot contains `id`, `name`, `category`, `address`, `neighborhood`, `borough`, `latitude`, and
`longitude`, plus `university`. A field outside that set makes the loader fail rather than
disappear silently, and the importer checks its own output against the same set first, because
its errors name the record and the loader's arrive at deployment time.

## Where the records come from

The city's [Facilities Database][facdb] (FacDB, Socrata `ji82-xba5`), which is what the `facdb:`
identifier prefix refers to. Two subsets of it are places a student might read in — the
`LIBRARIES` facility group and the `COLLEGES OR UNIVERSITIES` subgroup — which is 390 public,
academic, and institutional libraries and campuses across the five boroughs.

Cafés come from [Dining Out NYC][dining] (`fpeh-f7ci`), the city's register of outdoor-dining
licences and what the `dining:` prefix refers to. Only `Issued` `Sidewalk` licences: the register
also carries applications that were never granted, and a café that does not exist is worse than
one the snapshot omits, while a `Roadway` licence is a dining structure in a parking lane rather
than somewhere to sit with a laptop. That is about 1,650 storefronts.

Neighborhood names come from the [2020 Neighborhood Tabulation Areas][nta] (`9nt8-h7nd`), because
both registers publish the NTA code and not its name — which is the reason cafés could join this
snapshot at all, without a point-in-polygon test against the boundary geometry.

Requests identify themselves and page politely. `NYC_OPEN_DATA_APP_TOKEN` raises the rate limit
from the shared anonymous pool to a personal one; the importer runs without it, and the token is
read from the environment so it never reaches version control.

FacDB itself lists no cafés, and never will: it is a register of facilities the city *operates*,
while a café is a business the city *licenses*. Looking only there is what made the `cafe`
category look sourceless for so long.

The health department's restaurant inspection results remain the wrong answer. That is an
inspection log rather than a directory of open businesses: it keeps establishments that closed
years ago and carries no 2020 NTA, so publishing it as study spots would assert more than the
data supports.

What a licence does and does not say is worth stating. It says the business was granted the right
to put tables on the sidewalk, which is good evidence the place exists and has seating. It says
nothing about hours, Wi-Fi, power, noise, or whether anyone may sit with a laptop and one coffee
for three hours. The contract has no field for any of that and the application promises none.

## `operator` is who runs it

FacDB's `opname`. For the 226 public branches it is the system — 91 New York Public Library, 68
Brooklyn, 67 Queens — and it is the only field that says so: a branch is named after its
neighbourhood, so *Howard Beach* and *Fresh Meadows* carry nothing else to connect them to Queens
Public Library. The three systems have separate membership, which makes it worth publishing and
not only searching.

It is not title-cased. Upstream already capitalises this field, unlike `facname`, so passing it
through the title-caser would leave *Nyu Tamiment Library* exactly as wrong as it arrives. For
academic and special libraries it repeats the facility's own name, where it adds nothing and does
no harm. Cafés have none: Dining Out records the company holding the licence, which is
*CGM-LLNR LLC* where the trading name is *JEAN'S*.

## Identifiers

A café identifier is `dining:` and a digest of the name and address, as in
`dining:f56fccab0d4bb1ba`. Dining Out publishes no row identifier that survives a re-licensing,
so identity has to be derived, and name plus address is what distinguishes one storefront from
another and stays put between runs. One storefront holding two licences is therefore one spot.

A facility identifier is the source prefix and FacDB's own `uid`, as in
`facdb:eec118768e15a5e03d3354abda7b00da`. The digest is upstream's, derived from the source
record, and the importer treats it as the record's identity rather than computing one of its own.

That choice is about churn. `load_spots` replaces the whole table rather than upserting, so an
identifier derived from a record's *contents* — its name, address, or coordinates — would change
every time the city fixed a typo or re-geocoded a building, and every row would silently come
back as a different spot with the old one deleted. Deriving it from identity alone means
re-running the importer against unchanged upstream data writes a byte-identical snapshot, and a
renamed facility is an update to one row. The prefix keeps a second source from colliding with
FacDB if its keys ever look the same.

## Categories

`cafe`, `public_library`, `special_library`, `academic_library` and `university_building` are the published vocabulary. The model leaves `category` a free string on purpose, so the vocabulary lives in
`ingest.py`. The FacDB categories are keyed on its most specific facility type; `cafe` is not
keyed on anything, because a sidewalk licence says the place serves food outdoors and not what
kind of place it is, so there is nothing finer to map. A type nobody has mapped fails the import rather than
landing in a near-enough bucket: inventing a category would publish a guess as data, and mapping
it to the closest existing one would bury the fact that FacDB changed.

`public_library` and `special_library` are separate because the difference is the one a reader
cares about. A branch of NYPL, BPL or QPL is somewhere anyone can walk into. A special library is
an institutional collection — a club's, a society's, a hospital's — and many are open by
appointment or to members only, so publishing them as public would claim access the data does not
support. That is the same overclaim `free_public_wifi` and `university` are each worded to avoid.

The institution records in FacDB's higher-education subgroup are read but never published. An
administrative point for "Daemen University-Brooklyn Branch" is a registration rather than a room,
and campus access is restricted in any case; they exist here only to anchor the `university`
label. The campus study space the snapshot does publish is the curated NYU list.

None of this is a guarantee of entry. The contract has no field for access and the application
promises none: these are candidate locations, not guarantees of Wi-Fi, outlets, seating,
quietness, or entry.

## Absent values

`address`, `neighborhood`, and `university` are genuinely absent for some records: FacDB has no
street address for three dozen library branches, and an older extract predates the 2020 NTA
column. They are written as `null`, never as an empty string — the contract distinguishes the two
and the API returns `null`.

## `university` is proximity

It names the closest campus within 500 metres, or the campus itself for a campus record, and is
`null` when no campus is that close. The campus list is curated — it is the higher-education
subset of FacDB named above, the same records the importer publishes as `university` spots — and
the field is never guessed from a facility's name, its operator, or anything else.

**Cafés never carry one.** A café is a third place in its own right, not somewhere you reach
through a campus: a library beside a campus is plausibly *its* library, while the café on the
same corner is just a café. Leaving the field set would also have been unreliable in a way no
parameter fixes. FacDB stores one point per institution whatever its size, so Columbia's entire
Morningside campus is a single coordinate and its nearest café is 181 metres away, while a school
occupying one floor has one at 67 metres. Narrowing the radius therefore drops the universities
students attend before it drops the vocational schools nobody is looking for, and `factype`,
`capacity` and `optype` cannot tell the two apart either — Columbia and the NY School of Interior
Design are both `4-YEAR INDEPENDENT`, and every campus record has a capacity of `0`.

A named campus is not an affiliation, an endorsement, or a claim that anyone may walk in. One
hundred and sixty-nine metres is what the data says about "125th Street Library" and "Touro
University - Harlem", and it says nothing more than that.

[dining]: https://data.cityofnewyork.us/resource/fpeh-f7ci
[facdb]: https://data.cityofnewyork.us/City-Government/Facilities-Database/ji82-xba5
[nta]: https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd
