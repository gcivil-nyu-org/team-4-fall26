/**
 * The review form in each state a session can be in.
 *
 * The session is a real one wired to a fake Auth0 client, so the request the
 * form sends is the one the API would really get.
 */

import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ReviewForm from './ReviewForm.svelte';
import type { Account, Review } from './contract';
import { Session, type AuthClient } from './session.svelte';

const SPOT_ID = 'facdb:bobst';
const CONFIG = { enabled: true, domain: 'x.auth0.com', client_id: 'spa', audience: 'api' };

const STUDENT: Account = {
	email: 'ada@nyu.edu',
	email_verified: true,
	username: 'ada',
	account_type: 'student',
	business_name: '',
	created_at: '2026-10-27T12:00:00Z'
};

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function stored(body: Record<string, unknown>): Review {
	return {
		id: 7,
		spot: SPOT_ID,
		author: { username: 'ada' },
		noise: null,
		wifi: null,
		seating: null,
		outlets: null,
		body: '',
		created_at: '2026-11-18T12:00:00Z',
		updated_at: '2026-11-18T12:00:00Z',
		...body
	} as Review;
}

function failure(status: number, code: string, details: unknown[] = []): Response {
	return json({ error: { code, message: `The API said ${code}.`, details } }, status);
}

/**
 * A started session for `account`, or a signed-out one without.
 *
 * `onPost` answers each review POST in turn; by default it stores the review.
 */
async function started(
	account?: Account,
	onPost: (body: Record<string, unknown>) => Response | Promise<Response> = (body) =>
		json(stored(body), 201)
) {
	const posts: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
		[];
	const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = String(input);
		if (url === '/api/auth/config') return json(CONFIG);
		if (url === '/api/account') return json(account);
		const body = JSON.parse(String(init.body));
		posts.push({ url, headers: init.headers as Record<string, string>, body });
		return onPost(body);
	}) as typeof globalThis.fetch;

	const logIns: unknown[] = [];
	const client = {
		checkSession: async () => {},
		isAuthenticated: async () => account !== undefined,
		getTokenSilently: async () => `header.${btoa(JSON.stringify({ sub: 'auth0|ada' }))}.signature`,
		getIdTokenClaims: async () => ({ __raw: 'id-token' }),
		loginWithRedirect: async (argument: unknown) => void logIns.push(argument),
		handleRedirectCallback: async () => ({}),
		logout: async () => {}
	} as unknown as AuthClient;

	const session = new Session({ fetcher, createClient: async () => client, storage: null });
	await session.start();
	return { session, fetcher, posts, logIns };
}

const heading = () => page.getByRole('heading', { name: 'Write a review' });
const submit = () => page.getByRole('button', { name: 'Post review' });

describe('who sees the form', () => {
	it('asks someone signed out to log in, and brings them back here', async () => {
		const { session, logIns } = await started();
		render(ReviewForm, { spotId: SPOT_ID, session });

		await expect.element(page.getByText('Log in as a student to write a review.')).toBeVisible();
		await expect.element(heading()).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Log in' }).click();
		expect(logIns).toEqual([
			expect.objectContaining({ appState: { returnTo: `/spots/${SPOT_ID}` } })
		]);
	});

	it('sends someone who has not finished sign-up to finish it', async () => {
		const { session } = await started({ ...STUDENT, account_type: null });
		render(ReviewForm, { spotId: SPOT_ID, session });

		await expect
			.element(page.getByRole('link', { name: 'Finish sign-up to write a review' }))
			.toHaveAttribute('href', expect.stringContaining('/account?returnTo='));
		await expect.element(heading()).not.toBeInTheDocument();
	});

	it('shows a business account nothing', async () => {
		const { session } = await started({
			...STUDENT,
			account_type: 'business',
			business_name: 'Cafe Ada'
		});
		const view = await render(ReviewForm, { spotId: SPOT_ID, session });

		await expect.element(heading()).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
		expect(view.container.textContent?.trim()).toBe('');
	});

	it('shows nothing while accounts are switched off', async () => {
		const session = new Session({
			fetcher: (async () => json({ enabled: false })) as typeof globalThis.fetch,
			storage: null
		});
		await session.start();
		const view = await render(ReviewForm, { spotId: SPOT_ID, session });

		expect(session.status).toBe('disabled');
		expect(view.container.textContent?.trim()).toBe('');
	});
});

describe('posting a review', () => {
	it('sends every score and the comment, then thanks the student', async () => {
		const { session, fetcher, posts } = await started(STUDENT);
		const created: Review[] = [];
		render(ReviewForm, {
			spotId: SPOT_ID,
			session,
			fetcher,
			oncreated: (review: Review) => created.push(review)
		});

		await expect.element(submit()).toBeDisabled();
		await page.getByLabelText(/^Overall/).selectOptions('4');
		await page.getByLabelText(/^Quiet/).selectOptions('5');
		await page.getByLabelText(/^Wi-Fi/).selectOptions('3');
		await page.getByLabelText(/^Seating/).selectOptions('2');
		await page.getByLabelText(/^Outlets/).selectOptions('1');
		await page.getByLabelText(/^Comment/).fill('Quiet upstairs.');
		await expect.element(page.getByText('15 / 2000')).toBeVisible();
		await submit().click();

		await expect.element(page.getByText('Thanks — your review is posted.')).toBeVisible();
		await expect.element(heading()).not.toBeInTheDocument();
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toBe(`/api/spots/${encodeURIComponent(SPOT_ID)}/reviews`);
		expect(posts[0].headers.authorization).toMatch(/^Bearer /);
		expect(posts[0].body).toEqual({
			rating: 4,
			noise: 5,
			wifi: 3,
			seating: 2,
			outlets: 1,
			body: 'Quiet upstairs.'
		});
		expect(created.map(({ id }) => id)).toEqual([7]);
	});

	it('leaves out every score and the comment the student skipped', async () => {
		const { session, fetcher, posts } = await started(STUDENT);
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('5');
		await page.getByLabelText(/^Comment/).fill('   ');
		await submit().click();

		await expect.element(page.getByText('Thanks — your review is posted.')).toBeVisible();
		expect(posts.map(({ body }) => body)).toEqual([{ rating: 5 }]);
	});

	it('says so when the student has already reviewed the spot', async () => {
		const { session, fetcher } = await started(STUDENT, () => failure(409, 'conflict'));
		const created: Review[] = [];
		render(ReviewForm, {
			spotId: SPOT_ID,
			session,
			fetcher,
			oncreated: (review: Review) => created.push(review)
		});

		await page.getByLabelText(/^Overall/).selectOptions('3');
		await submit().click();

		await expect.element(page.getByText('You have already reviewed this spot.')).toBeVisible();
		await expect.element(heading()).not.toBeInTheDocument();
		expect(created).toEqual([]);
	});

	it('marks the fields the API rejected and keeps what was typed', async () => {
		const { session, fetcher } = await started(STUDENT, () =>
			failure(422, 'validation_error', [
				{ field: 'body.body', message: 'Ensure this field has no more than 2000 characters.' }
			])
		);
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('3');
		await page.getByLabelText(/^Comment/).fill('Kept.');
		await submit().click();

		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Please fix the highlighted fields.');
		await expect
			.element(page.getByText('Ensure this field has no more than 2000 characters.'))
			.toBeVisible();
		await expect.element(page.getByLabelText(/^Comment/)).toHaveValue('Kept.');
		await expect.element(page.getByLabelText(/^Comment/)).toHaveAttribute('aria-invalid', 'true');
		await expect.element(page.getByLabelText(/^Overall/)).toHaveValue('3');
	});

	it('tells a non-student account it cannot review', async () => {
		const { session, fetcher } = await started(STUDENT, () => failure(403, 'forbidden'));
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('3');
		await submit().click();

		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Only student accounts can write reviews.');
	});

	it('keeps the review after a network failure so it can be sent again', async () => {
		let attempts = 0;
		const { session, fetcher, posts } = await started(STUDENT, (body) => {
			attempts += 1;
			if (attempts === 1) throw new TypeError('Failed to fetch');
			return json(stored(body), 201);
		});
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('2');
		await submit().click();

		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Could not reach StudySpot. Check your connection and try again.');
		await expect.element(page.getByLabelText(/^Overall/)).toHaveValue('2');

		await submit().click();
		await expect.element(page.getByText('Thanks — your review is posted.')).toBeVisible();
		expect(posts.map(({ body }) => body)).toEqual([{ rating: 2 }, { rating: 2 }]);
	});

	it('cannot be sent twice while the first is on its way', async () => {
		let reply: (response: Response) => void = () => {};
		const { session, fetcher, posts } = await started(
			STUDENT,
			() => new Promise<Response>((resolve) => (reply = resolve))
		);
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('4');
		await submit().click();

		const posting = page.getByRole('button', { name: 'Posting…' });
		await expect.element(posting).toBeDisabled();
		expect(posts).toHaveLength(1);

		reply(json(stored({ rating: 4 }), 201));
		await expect.element(page.getByText('Thanks — your review is posted.')).toBeVisible();
	});

	it('falls back to the log-in prompt when the token is refused', async () => {
		const { session, fetcher } = await started(STUDENT, () => failure(401, 'unauthorized'));
		render(ReviewForm, { spotId: SPOT_ID, session, fetcher });

		await page.getByLabelText(/^Overall/).selectOptions('4');
		await submit().click();

		await expect.element(page.getByText('Log in as a student to write a review.')).toBeVisible();
		expect(session.status).toBe('signed-out');
	});
});
