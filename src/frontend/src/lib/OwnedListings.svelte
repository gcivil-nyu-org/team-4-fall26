<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { createListing, deleteListing, listOwnedListings, updateListing } from './accounts';
	import { ApiError, type Fetcher } from './api';
	import type { ListingDraft, StudySpot } from './contract';
	import ListingForm from './ListingForm.svelte';
	import { fieldsFrom, listingChanges, type SubmitResult } from './listing';
	import type { Session, SessionScope } from './session.svelte';
	import { place, spotPath } from './spot';

	/** `fetcher` is replaceable so a test can answer the listing routes. */
	let { session, fetcher }: { session: Session; fetcher?: Fetcher } = $props();
	type Listings = { kind: 'loading' | 'error' } | { kind: 'ready'; items: StudySpot[] };
	/** At most one listing is being edited, confirmed or deleted at a time. */
	type Action = { kind: 'idle' } | { kind: 'editing' | 'confirming' | 'deleting'; id: string };
	let listings = $state<Listings>({ kind: 'loading' });
	let action = $state<Action>({ kind: 'idle' });
	/** The listing whose last delete failed, kept in the list with an error. */
	let failedId = $state<string | null>(null);
	let notice = $state('');
	let adding = $state(false);
	let request = 0;
	$effect(() => {
		const scope = session.scope;
		if (scope) untrack(() => void load(scope));
		return () => {
			request += 1;
		};
	});

	async function load(scope: SessionScope): Promise<void> {
		const sequence = ++request;
		listings = { kind: 'loading' };
		try {
			const credentials = await session.credentialsFor(scope);
			if (sequence !== request || !session.isCurrent(scope)) return;
			const { items } = await listOwnedListings(credentials, fetcher);
			if (sequence === request && session.isCurrent(scope)) listings = { kind: 'ready', items };
		} catch (error) {
			if (sequence !== request || !session.isCurrent(scope)) return;
			if (error instanceof ApiError && error.status === 401) session.rejectCredentials(scope);
			else listings = { kind: 'error' };
		}
	}

	function drop(id: string, message: string): void {
		if (listings.kind === 'ready')
			listings = { kind: 'ready', items: listings.items.filter((spot) => spot.id !== id) };
		notice = message;
	}

	async function remove(spot: StudySpot): Promise<void> {
		const scope = session.scope;
		if (!scope || action.kind === 'deleting') return;
		action = { kind: 'deleting', id: spot.id };
		failedId = null;
		notice = '';
		try {
			const credentials = await session.credentialsFor(scope);
			if (!session.isCurrent(scope)) return;
			await deleteListing(credentials, spot.id, fetcher);
			if (session.isCurrent(scope)) drop(spot.id, `Deleted ${spot.name}.`);
		} catch (error) {
			if (!session.isCurrent(scope)) return;
			// A 404 means the server has no such listing of ours any more, so it
			// leaves the list the same way a successful delete does.
			if (error instanceof ApiError && error.status === 404) drop(spot.id, 'Already deleted.');
			else if (error instanceof ApiError && error.status === 401) session.rejectCredentials(scope);
			else failedId = spot.id;
		} finally {
			if (session.isCurrent(scope)) action = { kind: 'idle' };
		}
	}

	/**
	 * Where a new listing goes: before the first one whose name sorts after it,
	 * as `GET /listings` orders them, so the list reads the same after a reload.
	 */
	function inserted(items: StudySpot[], spot: StudySpot): StudySpot[] {
		const at = items.findIndex((item) => item.name.localeCompare(spot.name) > 0);
		return at === -1 ? [...items, spot] : [...items.slice(0, at), spot, ...items.slice(at)];
	}

	const CREATE_FAILED: SubmitResult = {
		kind: 'failed',
		message: 'Could not add this listing. Please try again.',
		details: []
	};

	async function create(draft: ListingDraft): Promise<SubmitResult> {
		const scope = session.scope;
		if (!scope) return CREATE_FAILED;
		try {
			const credentials = await session.credentialsFor(scope);
			if (!session.isCurrent(scope)) return CREATE_FAILED;
			const spot = await createListing(credentials, draft, fetcher);
			if (!session.isCurrent(scope)) return CREATE_FAILED;
			if (listings.kind === 'ready')
				listings = { kind: 'ready', items: inserted(listings.items, spot) };
			adding = false;
			notice = `Added ${spot.name}.`;
			return { kind: 'saved' };
		} catch (error) {
			return refusal(error, scope, CREATE_FAILED);
		}
	}

	/**
	 * What a failed create or save tells the form: the API's own words for a
	 * refusal it explains -- invalid fields, or an account that may not manage
	 * listings -- and `fallback` for anything else.
	 */
	function refusal(error: unknown, scope: SessionScope, fallback: SubmitResult): SubmitResult {
		if (!(error instanceof ApiError)) return fallback;
		// Signing out replaces this whole section, form and all.
		if (error.status === 401) session.rejectCredentials(scope);
		if (error.status === 422 || error.status === 403)
			return { kind: 'failed', message: error.message, details: error.details };
		return fallback;
	}

	const SAVE_FAILED: SubmitResult = {
		kind: 'failed',
		message: 'Could not save your changes. Please try again.',
		details: []
	};

	async function save(spot: StudySpot, draft: ListingDraft): Promise<SubmitResult> {
		const changes = listingChanges(spot, draft);
		if (Object.keys(changes).length === 0) {
			action = { kind: 'idle' };
			notice = 'No changes to save.';
			return { kind: 'saved' };
		}
		const scope = session.scope;
		if (!scope) return SAVE_FAILED;
		try {
			const credentials = await session.credentialsFor(scope);
			if (!session.isCurrent(scope)) return SAVE_FAILED;
			const updated = await updateListing(credentials, spot.id, changes, fetcher);
			if (!session.isCurrent(scope)) return SAVE_FAILED;
			// Taken out and put back, since a new name can move it in the list.
			if (listings.kind === 'ready') {
				const others = listings.items.filter((item) => item.id !== spot.id);
				listings = { kind: 'ready', items: inserted(others, updated) };
			}
			action = { kind: 'idle' };
			notice = `Saved ${updated.name}.`;
			return { kind: 'saved' };
		} catch (error) {
			// As when deleting: the server has no such listing of ours any more.
			if (error instanceof ApiError && error.status === 404) {
				action = { kind: 'idle' };
				drop(spot.id, 'Already deleted.');
				return { kind: 'saved' };
			}
			return refusal(error, scope, SAVE_FAILED);
		}
	}
</script>

<section aria-labelledby="owned-listings-title">
	<h2 id="owned-listings-title">Your listings</h2>
	{#if notice}
		<p role="status">{notice}</p>
	{/if}
	{#if listings.kind === 'loading'}
		<p role="status">Loading your listings…</p>
	{:else if listings.kind === 'error'}
		<p role="alert">Could not load your listings.</p>
		<button
			type="button"
			onclick={() => {
				const scope = session.scope;
				if (scope) void load(scope);
			}}
		>
			Try again
		</button>
	{:else if listings.kind === 'ready'}
		{#if adding}
			<ListingForm onSubmit={create} onCancel={() => (adding = false)} />
		{:else}
			<button
				type="button"
				disabled={action.kind === 'deleting'}
				onclick={() => {
					adding = true;
					action = { kind: 'idle' };
					notice = '';
				}}
			>
				Add a listing
			</button>
		{/if}
		{#if listings.items.length === 0}
			<p>No listings yet.</p>
		{:else}
			<ul>
				{#each listings.items as spot (spot.id)}
					<li aria-label={spot.name}>
						{#if action.kind === 'editing' && action.id === spot.id}
							<ListingForm
								purpose="edit"
								initial={fieldsFrom(spot)}
								onSubmit={(draft) => save(spot, draft)}
								onCancel={() => (action = { kind: 'idle' })}
							/>
						{:else}
							<a href={resolve(`${spotPath(spot.id)}#reviews` as '/')}>
								<strong>{spot.name}</strong>
								<span>{place(spot)} · Read reviews</span>
							</a>
							{#if failedId === spot.id}
								<p role="alert" class="error">Could not delete this listing. Please try again.</p>
							{/if}
							{#if (action.kind === 'confirming' || action.kind === 'deleting') && action.id === spot.id}
								<p class="confirm">
									Delete {spot.name}? This also deletes its reviews, the replies to them, and
									students’ saves of it, and cannot be undone.
								</p>
								<div class="actions">
									<button
										type="button"
										class="danger"
										disabled={action.kind === 'deleting'}
										onclick={() => void remove(spot)}
									>
										{action.kind === 'deleting' ? 'Deleting…' : 'Confirm delete'}
									</button>
									<button
										type="button"
										disabled={action.kind === 'deleting'}
										onclick={() => (action = { kind: 'idle' })}
									>
										Cancel
									</button>
								</div>
							{:else}
								<div class="actions">
									<button
										type="button"
										disabled={action.kind === 'deleting'}
										onclick={() => {
											action = { kind: 'confirming', id: spot.id };
											failedId = null;
											notice = '';
										}}
									>
										Delete
									</button>
									<button
										type="button"
										disabled={action.kind === 'deleting'}
										onclick={() => {
											action = { kind: 'editing', id: spot.id };
											adding = false;
											failedId = null;
											notice = '';
										}}
									>
										Edit
									</button>
								</div>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	section {
		margin-block: 28px;
	}
	h2 {
		margin-bottom: 8px;
		font-size: 1.125rem;
		font-weight: 700;
	}
	p,
	span {
		color: var(--color-muted);
		font-size: 0.875rem;
	}
	li {
		padding-block-end: 12px;
		border-block-start: 1px solid var(--color-border);
	}
	a {
		display: grid;
		gap: 2px;
		padding-block: 12px;
		color: var(--color-brand-hover);
		overflow-wrap: anywhere;
	}
	a:hover strong,
	button:hover:enabled {
		text-decoration: underline;
	}
	button {
		min-height: 44px;
		color: var(--color-brand-hover);
		font-weight: 650;
		cursor: pointer;
	}
	button:disabled {
		cursor: progress;
		opacity: 0.6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 16px;
	}
	.danger {
		text-decoration: underline;
	}
	.confirm {
		color: var(--color-text);
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--color-brand-hover);
		font-weight: 600;
	}
</style>
