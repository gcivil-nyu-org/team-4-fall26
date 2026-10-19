/**
 * The shared study-spot contract, as the browser sees it.
 *
 * These mirror `spots.models.StudySpot` and the response shapes in
 * `docs/source/api.md`. They are written out rather than generated because the
 * contract is small and changes need sign-off from every consumer; a generated
 * type would let a backend change land here silently.
 *
 * Nullability follows what NYC Open Data supplies: `address` and `neighborhood`
 * are genuinely absent for some records, and `university` is absent for every
 * record the importer does not take from a curated campus list.
 */

export const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'] as const;

export type Borough = (typeof BOROUGHS)[number];

export type StudySpot = {
	/** Stable identifier, prefixed with its source dataset, as in `facdb:a1b2c3`. */
	id: string;
	name: string;
	category: string;
	address: string | null;
	neighborhood: string | null;
	borough: Borough;
	latitude: number;
	longitude: number;
	/**
	 * The closest campus within 500 m, or the campus itself for a campus record.
	 * This is proximity and never affiliation, endorsement, or a claim of access.
	 *
	 * Always null for a cafe. A cafe is a third place in its own right, not
	 * somewhere reached through a campus.
	 */
	university: string | null;
	/**
	 * Who runs the place, where the city records it.
	 *
	 * For a public library branch this is its system — New York, Brooklyn or
	 * Queens Public Library — which nothing else in the record says, because
	 * branches are named after their neighbourhood. The three systems have
	 * separate membership, so it is worth showing.
	 *
	 * Null for cafés, whose licence names only the company holding it.
	 */
	operator: string | null;
	/**
	 * Whether a free public Wi-Fi hotspot the city publishes sits within 25 m.
	 *
	 * False means none is recorded, not that there is no Wi-Fi: a campus
	 * building's Wi-Fi needs the university's credentials, and the city has no
	 * reason to know about it.
	 */
	free_public_wifi: boolean;
	/**
	 * Whether sitting down here costs nothing.
	 *
	 * True of every library and of the campus buildings, false only of cafés,
	 * so it is not any one category. Derived by the API from `category` rather
	 * than computed here, so the rule has one definition rather than two.
	 *
	 * About money and not entry: a campus building is free and still wants the
	 * university's credentials.
	 */
	no_purchase_needed: boolean;
};

/** One value a filter can take, with how many spots carry it. */
export type Facet = {
	value: string;
	count: number;
};

/**
 * What `GET /spots/facets` reports.
 *
 * Every count reflects the filters and query already in force, minus the one
 * being counted: the boroughs list keeps all five while a borough is selected,
 * so there is still a way to switch, but its counts narrow under a category.
 *
 * `free_public_wifi` is a single number rather than a list because the control
 * is a checkbox: how many spots remain if it is ticked.
 */
export type Facets = {
	boroughs: Facet[];
	categories: Facet[];
	universities: Facet[];
	free_public_wifi: number;
	no_purchase_needed: number;
};

/**
 * The filters both endpoints accept. Every one is optional, and an omitted
 * filter means "do not narrow on this" rather than "match nothing".
 */
export type SpotFilters = {
	borough?: string;
	category?: string;
	university?: string;
	free_public_wifi?: boolean;
	no_purchase_needed?: boolean;
};

/** Where a page sits in the full result set. */
export type Pagination = {
	limit: number;
	offset: number;
	count: number;
	total: number;
	has_more: boolean;
};

export type SpotPage = {
	items: StudySpot[];
	pagination: Pagination;
};

/** One specific problem with a request. */
export type ErrorDetail = {
	field: string | null;
	message: string;
	type: string | null;
};

/** The envelope every non-2xx response uses. */
export type ErrorEnvelope = {
	error: {
		code: string;
		message: string;
		details: ErrorDetail[];
	};
};
