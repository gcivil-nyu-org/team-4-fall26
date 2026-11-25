/**
 * Writing reviews, which carries an access token.
 *
 * Kept apart from `api.ts`, whose spot routes never send one. Reading reviews
 * is public and stays there as `listReviews`.
 */

import { ApiError, isErrorEnvelope, type Fetcher } from './api';
import type { Credentials } from './accounts';
import type { Review, ReviewInput } from './contract';

/**
 * Post the signed-in student's review of `spotId` and return it as stored.
 *
 * Every failure is an `ApiError`: `network_error` (status 0) when the API could
 * not be reached, the API's own code and field details for an error envelope,
 * and `invalid_response` for a reply that is not a review of this spot.
 */
export async function createReview(
	credentials: Credentials,
	spotId: string,
	input: ReviewInput,
	fetcher: Fetcher = globalThis.fetch
): Promise<Review> {
	const headers: Record<string, string> = {
		accept: 'application/json',
		'content-type': 'application/json',
		authorization: `Bearer ${credentials.access}`
	};
	if (credentials.id) headers['x-id-token'] = credentials.id;

	let response: Response;
	try {
		response = await fetcher(`/api/spots/${encodeURIComponent(spotId)}/reviews`, {
			method: 'POST',
			headers,
			body: JSON.stringify(input),
			cache: 'no-store'
		});
	} catch {
		throw new ApiError(
			'network_error',
			'Could not reach StudySpot. Check your connection and try again.',
			0
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = null;
	}

	if (!response.ok) {
		if (isErrorEnvelope(body)) {
			throw new ApiError(
				body.error.code,
				body.error.message,
				response.status,
				body.error.details ?? []
			);
		}
		throw new ApiError('error', `The API returned ${response.status}.`, response.status);
	}

	const review = body as Partial<Review> | null;
	if (
		response.status !== 201 ||
		typeof review !== 'object' ||
		review === null ||
		!Number.isInteger(review.id) ||
		review.spot !== spotId
	) {
		throw new ApiError(
			'invalid_response',
			'StudySpot did not confirm the review. Please try again.',
			response.status
		);
	}
	return review as Review;
}
