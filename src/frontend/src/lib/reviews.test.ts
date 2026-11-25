import { describe, expect, it } from 'vitest';

import { ApiError, type Fetcher } from './api';
import type { Review } from './contract';
import { createReview } from './reviews';

const SPOT_ID = 'facdb:bobst';
const CREDENTIALS = { access: 'access-token', id: 'id-token' };

const REVIEW: Review = {
	id: 7,
	spot: SPOT_ID,
	author: { username: 'ada' },
	rating: 4,
	noise: 5,
	wifi: null,
	seating: null,
	outlets: null,
	body: 'Quiet upstairs.',
	created_at: '2026-11-18T12:00:00Z',
	updated_at: '2026-11-18T12:00:00Z'
};

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('createReview', () => {
	it('posts the review with the credentials and returns what was stored', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
			calls.push({ url: String(input), init });
			return json(REVIEW, 201);
		}) as Fetcher;

		const review = await createReview(
			CREDENTIALS,
			SPOT_ID,
			{ rating: 4, noise: 5, body: 'Quiet upstairs.' },
			fetcher
		);

		expect(review).toEqual(REVIEW);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`/api/spots/${encodeURIComponent(SPOT_ID)}/reviews`);
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers).toMatchObject({
			authorization: 'Bearer access-token',
			'x-id-token': 'id-token',
			'content-type': 'application/json'
		});
		expect(JSON.parse(String(calls[0].init.body))).toEqual({
			rating: 4,
			noise: 5,
			body: 'Quiet upstairs.'
		});
	});

	it("passes on the API's error code, status and field details", async () => {
		const details = [{ field: 'body.rating', message: 'Must be 1 to 5.', type: 'max_value' }];
		const fetcher = (async () =>
			json(
				{ error: { code: 'validation_error', message: 'Invalid.', details } },
				422
			)) as unknown as Fetcher;

		const failure = createReview(CREDENTIALS, SPOT_ID, { rating: 9 }, fetcher);

		await expect(failure).rejects.toBeInstanceOf(ApiError);
		await expect(failure).rejects.toMatchObject({
			code: 'validation_error',
			status: 422,
			details
		});
	});

	it('reports an unreachable API as a network error', async () => {
		const fetcher = (async () => {
			throw new TypeError('Failed to fetch');
		}) as unknown as Fetcher;

		await expect(createReview(CREDENTIALS, SPOT_ID, { rating: 3 }, fetcher)).rejects.toMatchObject({
			code: 'network_error',
			status: 0
		});
	});

	it('refuses a success reply that is not a review of this spot', async () => {
		const fetcher = (async () =>
			json({ ...REVIEW, spot: 'facdb:other' }, 201)) as unknown as Fetcher;

		await expect(createReview(CREDENTIALS, SPOT_ID, { rating: 3 }, fetcher)).rejects.toMatchObject({
			code: 'invalid_response'
		});
	});
});
