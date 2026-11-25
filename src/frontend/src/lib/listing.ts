/**
 * The rules of the business listing form, apart from any component.
 *
 * Turning what an owner typed into a `ListingDraft`, and working out what an
 * edit changed, is pure, so it is tested here without rendering anything.
 */

import {
	LISTING_CATEGORY,
	type Borough,
	type ErrorDetail,
	type ListingChanges,
	type ListingDraft,
	type StudySpot
} from './contract';

/**
 * A generous box around the five boroughs, as south/north latitude and
 * west/east longitude. The city itself runs from about 40.50 to 40.92 and
 * -74.26 to -73.70; the margin keeps the edges of Staten Island, the Bronx and
 * eastern Queens well inside.
 *
 * It catches the mistakes the API would store without complaint -- latitude
 * and longitude swapped, or a longitude missing its minus sign -- not a
 * point a few streets off, which is why the form also says to check it.
 */
export const NYC_BOUNDS = { south: 40.45, north: 40.95, west: -74.3, east: -73.65 } as const;

/**
 * Where "Use my current location" asks for a position: a fresh, precise fix,
 * unlike "Near me", which is content with a coarse, cached one.
 */
export const PRECISE_LOCATE_OPTIONS: PositionOptions = {
	enableHighAccuracy: true,
	timeout: 15_000,
	maximumAge: 0
};

export type Coordinates = { latitude: number; longitude: number };

/** What the Coordinates box holds, read as numbers but not yet placed. */
export type ReadCoordinates =
	{ kind: 'found'; value: Coordinates } | { kind: 'empty' } | { kind: 'malformed' };

/** What the Coordinates box holds, checked to be in the city. */
export type ParsedCoordinates = ReadCoordinates | { kind: 'outside' };

/** Two decimal numbers separated by a comma, spaces, or both, as Google Maps copies them. */
const COORDINATES = /^(-?\d+(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d+(?:\.\d+)?)$/;

/** Read "latitude, longitude", as in `40.72590, -73.99460`, wherever it is. */
export function readCoordinates(text: string): ReadCoordinates {
	const trimmed = text.trim();
	if (trimmed === '') return { kind: 'empty' };
	const match = COORDINATES.exec(trimmed);
	if (match === null) return { kind: 'malformed' };
	return { kind: 'found', value: { latitude: Number(match[1]), longitude: Number(match[2]) } };
}

/** Read the coordinates and check they are in the city. */
export function parseCoordinates(text: string): ParsedCoordinates {
	const read = readCoordinates(text);
	return read.kind === 'found' && !isInNewYork(read.value) ? { kind: 'outside' } : read;
}

/** Equal to the six decimals the form shows, so a stored value matches its own display. */
function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
	return formatCoordinates(a) === formatCoordinates(b);
}

export function isInNewYork({ latitude, longitude }: Coordinates): boolean {
	return (
		latitude >= NYC_BOUNDS.south &&
		latitude <= NYC_BOUNDS.north &&
		longitude >= NYC_BOUNDS.west &&
		longitude <= NYC_BOUNDS.east
	);
}

/** Six decimal places, about ten centimetres: as precise as any phone fix. */
export function formatCoordinates({ latitude, longitude }: Coordinates): string {
	return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** A nullable fact as the form asks it: yes, no, or not sure (`null`). */
export type Answer = 'yes' | 'no' | 'unknown';

/** Exactly what the form's controls hold, before any checking. */
export type ListingFields = {
	name: string;
	address: string;
	neighborhood: string;
	borough: Borough | '';
	coordinates: string;
	no_purchase_needed: boolean;
	indoor_seating: Answer;
	venue_wifi: Answer;
	opening_hours: string;
};

/** The controls a problem can be shown beside. */
export type ListingField = keyof ListingFields;

export type FieldProblems = Partial<Record<ListingField, string>>;

export const EMPTY_LISTING: ListingFields = {
	name: '',
	address: '',
	neighborhood: '',
	borough: '',
	coordinates: '',
	no_purchase_needed: false,
	indoor_seating: 'unknown',
	venue_wifi: 'unknown',
	opening_hours: ''
};

export const COORDINATE_PROBLEMS = {
	empty: 'Enter the coordinates, or use your current location.',
	malformed: 'Enter coordinates as latitude, longitude, as in 40.7259, -73.9946.',
	outside: 'These coordinates are not in New York City.'
} as const;

export type Checked =
	{ kind: 'valid'; draft: ListingDraft } | { kind: 'invalid'; problems: FieldProblems };

/**
 * Check the form and build the request body, or say what is wrong beside each
 * control.
 *
 * `existing` is where an edited listing already is. Coordinates left at it
 * are not held to the city box: a listing stored before the box existed, or
 * through the API directly, must not block saving an unrelated change.
 */
export function toDraft(fields: ListingFields, existing?: Coordinates): Checked {
	const problems: FieldProblems = {};
	const name = fields.name.trim();
	if (name === '') problems.name = 'Enter the name of your space.';
	if (fields.borough === '') problems.borough = 'Choose a borough.';
	const read = readCoordinates(fields.coordinates);
	const coordinates: ParsedCoordinates =
		read.kind === 'found' &&
		!isInNewYork(read.value) &&
		!(existing !== undefined && sameCoordinates(read.value, existing))
			? { kind: 'outside' }
			: read;
	if (coordinates.kind !== 'found') problems.coordinates = COORDINATE_PROBLEMS[coordinates.kind];

	if (name === '' || fields.borough === '' || coordinates.kind !== 'found')
		return { kind: 'invalid', problems };

	return {
		kind: 'valid',
		draft: {
			name,
			category: LISTING_CATEGORY,
			address: optional(fields.address),
			neighborhood: optional(fields.neighborhood),
			borough: fields.borough,
			latitude: coordinates.value.latitude,
			longitude: coordinates.value.longitude,
			no_purchase_needed: fields.no_purchase_needed,
			indoor_seating: answered(fields.indoor_seating),
			venue_wifi: answered(fields.venue_wifi),
			opening_hours: optional(fields.opening_hours)
		}
	};
}

/** Trimmed text, or `null` for nothing: the API refuses `""`. */
function optional(text: string): string | null {
	const trimmed = text.trim();
	return trimmed === '' ? null : trimmed;
}

function answered(answer: Answer): boolean | null {
	switch (answer) {
		case 'yes':
			return true;
		case 'no':
			return false;
		case 'unknown':
			return null;
	}
}

function answerOf(value: boolean | null): Answer {
	if (value === null) return 'unknown';
	return value ? 'yes' : 'no';
}

/** A listing as the form shows it, to edit. */
export function fieldsFrom(spot: StudySpot): ListingFields {
	return {
		name: spot.name,
		address: spot.address ?? '',
		neighborhood: spot.neighborhood ?? '',
		borough: spot.borough,
		coordinates: formatCoordinates(spot),
		no_purchase_needed: spot.no_purchase_needed,
		indoor_seating: answerOf(spot.indoor_seating),
		venue_wifi: answerOf(spot.venue_wifi),
		opening_hours: spot.opening_hours ?? ''
	};
}

/** The fields `listingChanges` compares one by one; coordinates go as a pair. */
const COMPARED = [
	'name',
	'address',
	'neighborhood',
	'borough',
	'no_purchase_needed',
	'indoor_seating',
	'venue_wifi',
	'opening_hours'
] as const satisfies readonly (keyof ListingChanges)[];

function put<K extends keyof ListingChanges>(
	changes: ListingChanges,
	key: K,
	value: ListingChanges[K]
): void {
	changes[key] = value;
}

/**
 * What an edit changed, for `PATCH /listings/{id}`: empty when nothing did.
 *
 * `draft` is compared with the listing as the form first showed it, tidied
 * the way `toDraft` tidies, so retyping the same text or leaving the
 * coordinates at their six-decimal display counts as no change. Latitude and
 * longitude are sent together or not at all; the category never is.
 */
export function listingChanges(spot: StudySpot, draft: ListingDraft): ListingChanges {
	const shown = fieldsFrom(spot);
	const before: Required<ListingChanges> = {
		name: shown.name.trim(),
		address: optional(shown.address),
		neighborhood: optional(shown.neighborhood),
		borough: spot.borough,
		latitude: spot.latitude,
		longitude: spot.longitude,
		no_purchase_needed: shown.no_purchase_needed,
		indoor_seating: answered(shown.indoor_seating),
		venue_wifi: answered(shown.venue_wifi),
		opening_hours: optional(shown.opening_hours)
	};
	const changes: ListingChanges = {};
	for (const key of COMPARED) if (draft[key] !== before[key]) put(changes, key, draft[key]);
	if (!sameCoordinates(draft, before)) {
		changes.latitude = draft.latitude;
		changes.longitude = draft.longitude;
	}
	return changes;
}

/** The API's names for the fields, mapped to the control each is shown beside. */
const CONTROL_FOR: Partial<Record<string, ListingField>> = {
	name: 'name',
	address: 'address',
	neighborhood: 'neighborhood',
	borough: 'borough',
	latitude: 'coordinates',
	longitude: 'coordinates',
	no_purchase_needed: 'no_purchase_needed',
	indoor_seating: 'indoor_seating',
	venue_wifi: 'venue_wifi',
	opening_hours: 'opening_hours'
};

/**
 * Sort a validation error's details by control. A detail about a field the
 * form has no control for, or about the body as a whole, is kept as general.
 */
export function problemsFrom(details: readonly ErrorDetail[]): {
	fields: FieldProblems;
	general: string[];
} {
	const fields: FieldProblems = {};
	const general: string[] = [];
	for (const detail of details) {
		const name = detail.field?.replace(/^body\./, '');
		const control = name === undefined ? undefined : CONTROL_FOR[name];
		if (control === undefined) general.push(detail.message);
		// The first message for a control is enough; latitude and longitude share one.
		else fields[control] ??= detail.message;
	}
	return { fields, general };
}

/**
 * What became of a submitted draft, as the form's owner reports it. `saved`
 * means the owner is done with the form and closes it; a failure carries the
 * API's validation details, if any, for the form to place.
 */
export type SubmitResult =
	{ kind: 'saved' } | { kind: 'failed'; message: string; details: readonly ErrorDetail[] };
