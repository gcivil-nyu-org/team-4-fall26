<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { deleteListing, listOwnedListings } from './accounts';
	import { ApiError, type Fetcher } from './api';
	import type { StudySpot } from './contract';
	import type { Session, SessionScope } from './session.svelte';
	import { place, spotPath } from './spot';

	/** `fetcher` is replaceable so a test can answer the listing routes. */
	let { session, fetcher }: { session: Session; fetcher?: Fetcher } = $props();
	type Listings = { kind: 'loading' | 'error' } | { kind: 'ready'; items: StudySpot[] };
	/** At most one listing is being confirmed or deleted at a time. */
	type Removal = { kind: 'idle' } | { kind: 'confirming' | 'deleting'; id: string };
	let listings = $state<Listings>({ kind: 'loading' });
	let removal = $state<Removal>({ kind: 'idle' });
	/** The listing whose last delete failed, kept in the list with an error. */
	let failedId = $state<string | null>(null);
	let notice = $state('');
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
		if (!scope || removal.kind === 'deleting') return;
		removal = { kind: 'deleting', id: spot.id };
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
			if (session.isCurrent(scope)) removal = { kind: 'idle' };
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
		{#if listings.items.length === 0}
			<p>No listings yet.</p>
		{:else}
			<ul>
				{#each listings.items as spot (spot.id)}
					<li aria-label={spot.name}>
						<a href={resolve(`${spotPath(spot.id)}#reviews` as '/')}>
							<strong>{spot.name}</strong>
							<span>{place(spot)} · Read reviews</span>
						</a>
						{#if failedId === spot.id}
							<p role="alert" class="error">Could not delete this listing. Please try again.</p>
						{/if}
						{#if removal.kind !== 'idle' && removal.id === spot.id}
							<p class="confirm">
								Delete {spot.name}? This also deletes its reviews, the replies to them, and
								students’ saves of it, and cannot be undone.
							</p>
							<div class="actions">
								<button
									type="button"
									class="danger"
									disabled={removal.kind === 'deleting'}
									onclick={() => void remove(spot)}
								>
									{removal.kind === 'deleting' ? 'Deleting…' : 'Confirm delete'}
								</button>
								<button
									type="button"
									disabled={removal.kind === 'deleting'}
									onclick={() => (removal = { kind: 'idle' })}
								>
									Cancel
								</button>
							</div>
						{:else}
							<div class="actions">
								<button
									type="button"
									disabled={removal.kind === 'deleting'}
									onclick={() => {
										removal = { kind: 'confirming', id: spot.id };
										failedId = null;
										notice = '';
									}}
								>
									Delete
								</button>
							</div>
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
