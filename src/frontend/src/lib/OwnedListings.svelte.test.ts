/**
 * A business deleting its listings from the account page.
 *
 * The session is a real one wired to a fake Auth0 client; the listing routes
 * are answered by a fake fetcher, so no request reaches a real API.
 */

import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import OwnedListings from './OwnedListings.svelte';
import type { Account, StudySpot } from './contract';
import { Session, type AuthClient } from './session.svelte';

const CONFIG = { enabled: true, domain: 'x.auth0.com', client_id: 'spa', audience: 'api' };
const ACCOUNT: Account = {
	email: 'owner@grumpy.com',
	email_verified: true,
	username: '',
	account_type: 'business',
	business_name: 'Grumpy Coffee',
	created_at: '2026-10-27T12:00:00Z'
};
const SPOT: StudySpot = {
	id: 'listing:grumpy',
	name: 'Grumpy Coffee',
	category: 'cafe',
	address: null,
	neighborhood: null,
	borough: 'Manhattan',
	latitude: 40.7,
	longitude: -74,
	university: null,
	operator: null,
	free_public_wifi: false,
	no_purchase_needed: false,
	subway_station: null,
	subway_routes: null,
	subway_metres: null,
	subway_step_free: null,
	nearby_spots: 0,
	outdoor_seating: false,
	indoor_seating: null,
	venue_wifi: null,
	opening_hours: null
};
const OTHER: StudySpot = { ...SPOT, id: 'listing:other', name: 'Other Cafe' };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** An API error envelope with `status`, as the backend sends it. */
function failure(status: number): Response {
	return json({ error: { code: 'error', message: 'Refused.' } }, status);
}

/**
 * A signed-in business session, and the listing routes it talks to.
 *
 * `onDelete` answers each `DELETE /listings/{id}`; every request the listing
 * routes see is recorded as `METHOD path`.
 */
async function setup(onDelete: () => Promise<Response> | Response) {
	const client = {
		checkSession: async () => {},
		isAuthenticated: async () => true,
		getTokenSilently: async () => `header.${btoa(JSON.stringify({ sub: 'auth0|owner' }))}.sig`,
		getIdTokenClaims: async () => ({ __raw: 'id-token' }),
		loginWithRedirect: async () => {},
		handleRedirectCallback: async () => ({}),
		logout: async () => {}
	} as unknown as AuthClient;
	const sessionFetcher = (async (input: RequestInfo | URL) =>
		String(input) === '/api/auth/config' ? json(CONFIG) : json(ACCOUNT)) as typeof fetch;
	const session = new Session({
		fetcher: sessionFetcher,
		createClient: async () => client,
		storage: null
	});
	await session.start();

	const requests: string[] = [];
	const headers: Headers[] = [];
	const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const method = init.method ?? 'GET';
		requests.push(`${method} ${String(input)}`);
		headers.push(new Headers(init.headers));
		if (method === 'DELETE') return onDelete();
		return json({ items: [SPOT, OTHER] });
	}) as typeof fetch;

	render(OwnedListings, { session, fetcher });
	await expect.element(page.getByRole('link', { name: /Grumpy Coffee/ })).toBeVisible();
	return { session, requests, headers };
}

const item = (name: string) => page.getByRole('listitem', { name });

describe('deleting a listing', () => {
	it('asks first, saying what else goes, and Cancel sends nothing', async () => {
		const { requests } = await setup(() => new Response(null, { status: 204 }));

		await item('Grumpy Coffee').getByRole('button', { name: 'Delete' }).click();

		await expect
			.element(page.getByText(/^Delete Grumpy Coffee\?/))
			.toHaveTextContent(
				'Delete Grumpy Coffee? This also deletes its reviews, the replies to them, and students’ saves of it, and cannot be undone.'
			);
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect.element(item('Grumpy Coffee')).toBeVisible();
		await expect.element(page.getByText(/^Delete Grumpy Coffee\?/)).not.toBeInTheDocument();
		expect(requests).toEqual(['GET /api/listings']);
	});

	it('removes it once the API confirms, and cannot be sent twice', async () => {
		const answer = Promise.withResolvers<Response>();
		const { requests, headers } = await setup(() => answer.promise);

		await item('Grumpy Coffee').getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Confirm delete' }).click();

		const busy = page.getByRole('button', { name: 'Deleting…' });
		await expect.element(busy).toBeDisabled();
		await expect.element(item('Other Cafe').getByRole('button', { name: 'Delete' })).toBeDisabled();
		await busy.click({ force: true });

		answer.resolve(new Response(null, { status: 204 }));

		await expect.element(page.getByRole('status')).toHaveTextContent('Deleted Grumpy Coffee.');
		await expect.element(item('Grumpy Coffee')).not.toBeInTheDocument();
		await expect.element(item('Other Cafe')).toBeVisible();
		expect(requests).toEqual(['GET /api/listings', 'DELETE /api/listings/listing%3Agrumpy']);
		expect(headers[1].get('authorization')).toMatch(/^Bearer /);
	});

	it('drops a listing the API says is already gone', async () => {
		await setup(() => failure(404));

		await item('Grumpy Coffee').getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Confirm delete' }).click();

		await expect.element(page.getByRole('status')).toHaveTextContent('Already deleted.');
		await expect.element(item('Grumpy Coffee')).not.toBeInTheDocument();
	});

	it.each([
		['a server error', () => failure(500)],
		[
			'a network failure',
			() => {
				throw new TypeError('offline');
			}
		]
	])('keeps the list as it was after %s', async (_, answer) => {
		await setup(answer);

		await item('Grumpy Coffee').getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Confirm delete' }).click();

		await expect
			.element(item('Grumpy Coffee').getByRole('alert'))
			.toHaveTextContent('Could not delete this listing. Please try again.');
		await expect.element(item('Other Cafe')).toBeVisible();
		await expect
			.element(item('Grumpy Coffee').getByRole('button', { name: 'Delete' }))
			.toBeEnabled();
	});

	it('signs out when the API refuses the credentials', async () => {
		const { session } = await setup(() => failure(401));

		await item('Grumpy Coffee').getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Confirm delete' }).click();

		await expect.poll(() => session.status).toBe('signed-out');
	});
});
