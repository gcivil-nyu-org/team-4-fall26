import { describe, expect, it } from 'vitest';

import {
	COORDINATE_PROBLEMS,
	EMPTY_LISTING,
	formatCoordinates,
	parseCoordinates,
	problemsFrom,
	toDraft,
	type ListingFields
} from './listing';

describe('parseCoordinates', () => {
	it.each(['40.72590, -73.99460', '40.7259,-73.9946', '  40.7259   -73.9946 '])(
		'reads %j as latitude then longitude',
		(text) => {
			expect(parseCoordinates(text)).toEqual({
				kind: 'found',
				value: { latitude: 40.7259, longitude: -73.9946 }
			});
		}
	);

	it.each([
		['Tottenville, Staten Island', '40.5086, -74.2465'],
		['the north Bronx', '40.9126, -73.8784'],
		['Glen Oaks, Queens', '40.7466, -73.7004'],
		['Far Rockaway, Queens', '40.5958, -73.7550']
	])('accepts the edge of the city at %s', (_, text) => {
		expect(parseCoordinates(text).kind).toBe('found');
	});

	it.each([
		['latitude and longitude swapped', '-73.9946, 40.7259'],
		['a longitude missing its minus sign', '40.7259, 73.9946'],
		['somewhere else entirely', '51.5072, -0.1276']
	])('refuses %s as outside the city', (_, text) => {
		expect(parseCoordinates(text)).toEqual({ kind: 'outside' });
	});

	it.each(['40.7259', 'forty, minus seventy', '40.7259, -73.9946, 3', '40.7259; -73.9946'])(
		'refuses %j as malformed',
		(text) => {
			expect(parseCoordinates(text)).toEqual({ kind: 'malformed' });
		}
	);

	it('tells nothing apart from something unreadable', () => {
		expect(parseCoordinates('   ')).toEqual({ kind: 'empty' });
	});
});

describe('formatCoordinates', () => {
	it('writes them back in the form parseCoordinates reads', () => {
		const text = formatCoordinates({ latitude: 40.72591234, longitude: -73.99461234 });
		expect(text).toBe('40.725912, -73.994612');
		expect(parseCoordinates(text).kind).toBe('found');
	});
});

const FILLED: ListingFields = {
	...EMPTY_LISTING,
	name: '  Quiet Corner Cafe ',
	borough: 'Manhattan',
	coordinates: '40.7259, -73.9946'
};

describe('toDraft', () => {
	it('sends nothing for blank optional text, and null for not sure', () => {
		expect(toDraft({ ...FILLED, address: '  ', opening_hours: '' })).toEqual({
			kind: 'valid',
			draft: {
				name: 'Quiet Corner Cafe',
				category: 'cafe',
				address: null,
				neighborhood: null,
				borough: 'Manhattan',
				latitude: 40.7259,
				longitude: -73.9946,
				no_purchase_needed: false,
				indoor_seating: null,
				venue_wifi: null,
				opening_hours: null
			}
		});
	});

	it('keeps yes and no apart from not sure, and trims what was typed', () => {
		const checked = toDraft({
			...FILLED,
			address: ' 12 Bleecker Street ',
			indoor_seating: 'yes',
			venue_wifi: 'no',
			no_purchase_needed: true
		});

		expect(checked.kind === 'valid' && checked.draft).toMatchObject({
			address: '12 Bleecker Street',
			indoor_seating: true,
			venue_wifi: false,
			no_purchase_needed: true
		});
	});

	it('names every missing required field', () => {
		expect(toDraft(EMPTY_LISTING)).toEqual({
			kind: 'invalid',
			problems: {
				name: 'Enter the name of your space.',
				borough: 'Choose a borough.',
				coordinates: COORDINATE_PROBLEMS.empty
			}
		});
	});

	it('refuses coordinates outside the city', () => {
		expect(toDraft({ ...FILLED, coordinates: '40.7259, 73.9946' })).toEqual({
			kind: 'invalid',
			problems: { coordinates: COORDINATE_PROBLEMS.outside }
		});
	});
});

describe('problemsFrom', () => {
	it('places each API detail beside its control, and keeps the rest as general', () => {
		expect(
			problemsFrom([
				{ field: 'body.name', message: 'Too long.', type: 'max_length' },
				{ field: 'body.latitude', message: 'Too far north.', type: 'max_value' },
				{ field: 'body.longitude', message: 'Too far east.', type: 'max_value' },
				{ field: 'body.owner', message: 'This field cannot be set on a listing.', type: null },
				{ field: null, message: 'Something else.', type: null }
			])
		).toEqual({
			fields: { name: 'Too long.', coordinates: 'Too far north.' },
			general: ['This field cannot be set on a listing.', 'Something else.']
		});
	});
});
