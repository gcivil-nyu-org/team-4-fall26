<script lang="ts">
	import { resolve } from '$app/paths';
	import { ApiError, type Fetcher } from './api';
	import type { Review, ReviewInput } from './contract';
	import { createReview } from './reviews';
	import { session as sharedSession, type Session, type SessionScope } from './session.svelte';

	let {
		spotId,
		session = sharedSession,
		fetcher,
		oncreated
	}: {
		spotId: string;
		session?: Session;
		fetcher?: Fetcher;
		/** Called with the review exactly as the API stored it. */
		oncreated?: (review: Review) => void;
	} = $props();

	/** The optional scores, in the order the list shows them. */
	const OPTIONAL = [
		['noise', 'Quiet', '5 = very quiet'],
		['wifi', 'Wi-Fi', '5 = excellent'],
		['seating', 'Seating', '5 = easy to find a seat'],
		['outlets', 'Outlets', '5 = easy to find an outlet']
	] as const;
	type Optional = (typeof OPTIONAL)[number][0];
	type Field = 'rating' | Optional | 'body';
	const FIELDS: readonly Field[] = ['rating', ...OPTIONAL.map(([field]) => field), 'body'];
	const MAX_BODY = 2000;
	const SCORE_VALUES = ['1', '2', '3', '4', '5'] as const;

	// A select's value is a string; '' means nothing chosen.
	let rating = $state('');
	let optional = $state<Record<Optional, string>>({
		noise: '',
		wifi: '',
		seating: '',
		outlets: ''
	});
	let body = $state('');

	let submitting = $state(false);
	let error = $state('');
	let fieldErrors = $state<Partial<Record<Field, string>>>({});
	let loginError = $state('');

	/**
	 * How the last submission ended, for the person who made it. Keeping the
	 * subject means someone else logging in on this tab sees a fresh form, not
	 * the previous person's "already reviewed".
	 */
	let outcome = $state<{ subject: string; kind: 'posted' | 'already-reviewed' } | null>(null);

	const origin = $derived(`/spots/${spotId}`);
	const isStudent = $derived(
		session.status === 'signed-in' && session.account?.account_type === 'student'
	);
	const unfinished = $derived(
		session.status === 'signed-in' && session.account?.account_type === null
	);
	const settled = $derived(
		outcome !== null && outcome.subject === session.subject ? outcome.kind : null
	);

	function input(): ReviewInput {
		const review: ReviewInput = { rating: Number(rating) };
		for (const [field] of OPTIONAL) {
			if (optional[field] !== '') review[field] = Number(optional[field]);
		}
		if (body.trim() !== '') review.body = body;
		return review;
	}

	/** Field errors from a 422, keyed by our field names; `body.rating` → `rating`. */
	function byField(error: ApiError): Partial<Record<Field, string>> {
		const found: Partial<Record<Field, string>> = {};
		for (const detail of error.details) {
			const name = detail.field?.replace(/^body\./, '');
			const field = FIELDS.find((candidate) => candidate === name);
			if (field && !found[field]) found[field] = detail.message;
		}
		return found;
	}

	function fail(caught: unknown, scope: SessionScope): void {
		if (!(caught instanceof ApiError)) {
			error = 'Could not post your review. Please try again.';
			return;
		}
		switch (caught.status) {
			case 401:
				// The form gives way to the log-in prompt once the session drops.
				session.rejectCredentials(scope);
				return;
			case 403:
				error = 'Only student accounts can write reviews.';
				// The account may have changed elsewhere; let the session catch up.
				void session.refresh();
				return;
			case 409:
				outcome = { subject: scope.subject, kind: 'already-reviewed' };
				return;
			case 422: {
				fieldErrors = byField(caught);
				error =
					Object.keys(fieldErrors).length > 0
						? 'Please fix the highlighted fields.'
						: caught.message;
				return;
			}
			default:
				error = caught.message;
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const scope = session.scope;
		if (!scope || submitting || rating === '') return;
		submitting = true;
		error = '';
		fieldErrors = {};
		try {
			const credentials = await session.credentialsFor(scope);
			if (!session.isCurrent(scope)) return;
			const review = await createReview(credentials, spotId, input(), fetcher);
			if (!session.isCurrent(scope)) return;
			outcome = { subject: scope.subject, kind: 'posted' };
			oncreated?.(review);
		} catch (caught) {
			if (session.isCurrent(scope)) fail(caught, scope);
		} finally {
			submitting = false;
		}
	}

	async function login(): Promise<void> {
		loginError = '';
		try {
			await session.logIn(origin);
		} catch {
			loginError = 'Could not open login. Please try again.';
		}
	}
</script>

{#if session.status === 'signed-out'}
	<div class="prompt">
		<p>Log in as a student to write a review.</p>
		<button type="button" onclick={login}>Log in</button>
		{#if loginError}<p class="error" role="alert">{loginError}</p>{/if}
	</div>
{:else if unfinished}
	<div class="prompt">
		<a href={resolve(`/account?returnTo=${encodeURIComponent(origin)}`)}
			>Finish sign-up to write a review</a
		>
	</div>
{:else if isStudent}
	{#if settled === 'posted'}
		<p class="done" role="status">Thanks — your review is posted.</p>
	{:else if settled === 'already-reviewed'}
		<p class="done" role="status">You have already reviewed this spot.</p>
	{:else}
		<form aria-labelledby="review-form-title" onsubmit={submit} novalidate>
			<h3 id="review-form-title">Write a review</h3>

			<div class="scores">
				<label>
					<span>Overall <span class="hint">required</span></span>
					<select
						bind:value={rating}
						required
						aria-invalid={fieldErrors.rating ? true : undefined}
						aria-describedby={fieldErrors.rating ? 'review-rating-error' : undefined}
					>
						<option value="">Choose…</option>
						{#each SCORE_VALUES as value (value)}<option {value}>{value}</option>{/each}
					</select>
					{#if fieldErrors.rating}
						<span class="field-error" id="review-rating-error">{fieldErrors.rating}</span>
					{/if}
				</label>

				{#each OPTIONAL as [field, label, hint] (field)}
					<label>
						<span>{label} <span class="hint">{hint}</span></span>
						<select
							bind:value={optional[field]}
							aria-invalid={fieldErrors[field] ? true : undefined}
							aria-describedby={fieldErrors[field] ? `review-${field}-error` : undefined}
						>
							<option value="">No answer</option>
							{#each SCORE_VALUES as value (value)}<option {value}>{value}</option>{/each}
						</select>
						{#if fieldErrors[field]}
							<span class="field-error" id="review-{field}-error">{fieldErrors[field]}</span>
						{/if}
					</label>
				{/each}
			</div>

			<label class="comment">
				<span>Comment <span class="hint">optional</span></span>
				<textarea
					bind:value={body}
					maxlength={MAX_BODY}
					rows="4"
					aria-invalid={fieldErrors.body ? true : undefined}
					aria-describedby="review-body-count{fieldErrors.body ? ' review-body-error' : ''}"
				></textarea>
				<span class="count" id="review-body-count">{body.length} / {MAX_BODY}</span>
				{#if fieldErrors.body}
					<span class="field-error" id="review-body-error">{fieldErrors.body}</span>
				{/if}
			</label>

			{#if error}<p class="error" role="alert">{error}</p>{/if}

			<button type="submit" disabled={rating === '' || submitting}>
				{submitting ? 'Posting…' : 'Post review'}
			</button>
		</form>
	{/if}
{/if}

<style>
	.prompt,
	form,
	.done {
		margin: 0 0 16px;
		padding: 16px 20px;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: #f7f1eb;
	}

	p {
		margin: 0;
		font-size: 14px;
	}

	.prompt p {
		margin-bottom: 10px;
	}

	h3 {
		margin: 0 0 12px;
		font-size: 15px;
		font-weight: 700;
	}

	.scores {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 12px;
	}

	label {
		display: grid;
		gap: 4px;
		font-size: 13px;
		font-weight: 650;
	}

	.hint,
	.count {
		color: var(--color-muted);
		font-weight: 500;
	}

	.comment {
		margin-top: 12px;
	}

	select,
	textarea {
		min-height: 44px;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		color: var(--color-text);
		background: white;
		font: inherit;
		font-weight: 500;
	}

	textarea {
		resize: vertical;
		font-size: 15px;
		line-height: 1.5;
	}

	[aria-invalid='true'] {
		border-color: var(--color-brand-hover);
	}

	.field-error,
	.error {
		color: var(--color-brand-hover);
		font-size: 13px;
		font-weight: 500;
	}

	.error {
		margin-top: 12px;
	}

	button,
	a {
		display: inline-flex;
		min-height: 44px;
		align-items: center;
		padding: 0 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		color: var(--color-text);
		background: white;
		font-size: 13px;
		font-weight: 650;
		text-decoration: none;
		cursor: pointer;
	}

	button[type='submit'] {
		margin-top: 12px;
	}

	button:hover:not(:disabled),
	a:hover {
		border-color: var(--color-text);
	}

	button:disabled {
		color: var(--color-muted);
		cursor: not-allowed;
	}

	button:focus-visible,
	a:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		outline: 3px solid var(--color-brand-hover);
		outline-offset: 3px;
	}
</style>
