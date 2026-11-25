/**
 * The committed snapshot, read at build time.
 *
 * Detail pages are prerendered, so every one of them exists as real HTML in S3
 * before anyone asks for it. That is only possible because the identifiers are
 * known in advance: `data/spots.json` is in version control and is the source
 * the serving table is loaded from, so building from it cannot disagree with
 * the API about which spots exist.
 *
 * It also means a detail page needs no request at all — no API call, no
 * loading state, no empty first paint. The cost is that regenerating the
 * snapshot requires a frontend build as well as a reload, which `just
 * aws-frontend` and `just aws-load` already do separately.
 *
 * Server-only by its folder: `$lib/server` is never bundled into the browser,
 * so the whole snapshot does not travel to every visitor.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BOROUGHS, type Borough, type StudySpot } from '$lib/contract';
import type { NeighborhoodGroup } from '$lib/near';

/**
 * Walk up from the working directory until `data/spots.json` appears.
 *
 * Not resolved from `import.meta.url`: during prerendering this module runs
 * from `.svelte-kit/output/server/`, which is a different depth from the source
 * tree, so a fixed number of `..` segments is right in one context and wrong in
 * the other. The working directory is `src/frontend` for `vite build`, `vite
 * dev` and vitest alike, but walking up costs nothing and survives being run
 * from the repository root too.
 */
function findSnapshot(): string {
	let directory = process.cwd();
	for (;;) {
		const candidate = join(directory, 'data', 'spots.json');
		if (existsSync(candidate)) return candidate;

		const parent = dirname(directory);
		if (parent === directory) {
			throw new Error(
				`No data/spots.json above ${process.cwd()}; run the build from the repository.`
			);
		}
		directory = parent;
	}
}

let cached: StudySpot[] | null = null;

/** Every spot in the committed snapshot. */
export function allSpots(): StudySpot[] {
	// Read once: prerendering 3,772 pages would otherwise parse it 3,772 times.
	if (cached === null) {
		cached = JSON.parse(readFileSync(findSnapshot(), 'utf-8')) as StudySpot[];
	}
	return cached;
}

/**
 * Every neighborhood that has a spot, grouped by borough, for the Near
 * neighborhood picker.
 *
 * Boroughs in the contract's order and names alphabetical within each, so the
 * list reads the same on every build. Taken from the same snapshot the API is
 * loaded from, so every name is one `near_neighborhood` accepts. A borough with
 * no named neighborhood is left out rather than shown as an empty group.
 */
export function neighborhoodsByBorough(): NeighborhoodGroup[] {
	const names = new Map<string, Set<string>>();
	for (const spot of allSpots()) {
		if (spot.neighborhood === null) continue;
		const group = names.get(spot.borough) ?? new Set<string>();
		group.add(spot.neighborhood);
		names.set(spot.borough, group);
	}

	return BOROUGHS.flatMap((borough) => {
		const group = names.get(borough);
		return group ? [{ borough, neighborhoods: [...group].sort((a, b) => a.localeCompare(b)) }] : [];
	});
}

/** What the homepage's "best seats" list shows for one spot, train included. */
export type Seat = Pick<StudySpot, 'id' | 'name' | 'category' | 'neighborhood' | 'borough'> & {
	subway_station: string;
	subway_routes: string;
	subway_metres: number;
};

export type BoroughSeats = { borough: Borough; seats: Seat[] };

/**
 * The easiest seats in each borough, nearest train first.
 *
 * "Best" is a rule the page states rather than anyone's taste: free to sit, a
 * city Wi-Fi hotspot within 25 m, and a step-free station. One seat per
 * station, because branches that share a building -- a library and its
 * learning center -- would otherwise fill the list with one address. Keyed by
 * station and lines together, since "125 St" names several stations.
 */
export function bestSeats(perBorough = 5): BoroughSeats[] {
	return BOROUGHS.map((borough) => {
		const candidates = allSpots().flatMap((spot): Seat[] => {
			const { subway_station: station, subway_routes: routes, subway_metres: metres } = spot;
			const qualifies =
				spot.borough === borough &&
				spot.no_purchase_needed &&
				spot.free_public_wifi &&
				spot.subway_step_free === 'full';
			if (!qualifies || station === null || routes === null || metres === null) return [];
			const { id, name, category, neighborhood } = spot;
			return [
				{
					id,
					name,
					category,
					neighborhood,
					borough,
					subway_station: station,
					subway_routes: routes,
					subway_metres: metres
				}
			];
		});
		candidates.sort((a, b) => a.subway_metres - b.subway_metres || a.name.localeCompare(b.name));

		const stations = new Set<string>();
		const seats: Seat[] = [];
		for (const seat of candidates) {
			const station = `${seat.subway_station}|${seat.subway_routes}`;
			if (stations.has(station)) continue;
			stations.add(station);
			seats.push(seat);
			if (seats.length === perBorough) break;
		}
		return { borough, seats };
	});
}

/** One spot by identifier, or `undefined` when the snapshot has no such row. */
export function spotById(id: string): StudySpot | undefined {
	return allSpots().find((spot) => spot.id === id);
}

type Point = { latitude: number; longitude: number };

/** Metres between two points on the earth, by the haversine formula. */
function metresBetween(a: Point, b: Point): number {
	const EARTH_RADIUS_METRES = 6_371_000;
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

	const lat1 = toRadians(a.latitude);
	const lat2 = toRadians(b.latitude);
	const deltaLat = lat2 - lat1;
	const deltaLon = toRadians(b.longitude - a.longitude);

	const arc =
		Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
	return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(arc));
}

export type Nearby = { spot: StudySpot; metres: number };

/**
 * The closest other spots, nearest first.
 *
 * Computed here rather than served, because the coordinates are in the
 * snapshot and the page is built from it: asking the API for this would mean a
 * proximity endpoint that exists only for a page that already knows the answer.
 */
export function nearbySpots(spot: StudySpot, limit = 4, within = 800): Nearby[] {
	return allSpots()
		.filter((other) => other.id !== spot.id)
		.map((other) => ({ spot: other, metres: metresBetween(spot, other) }))
		.filter((candidate) => candidate.metres <= within)
		.sort((a, b) => a.metres - b.metres || a.spot.name.localeCompare(b.spot.name))
		.slice(0, limit);
}
