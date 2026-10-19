<script lang="ts">
	import type { StudySpot } from './contract';

	type Props = {
		spots: StudySpot[];
		total: number;
		hasMore: boolean;
		loadingMore?: boolean;
		onShowMore?: () => void;
	};

	let { spots, total, hasMore, loadingMore = false, onShowMore }: Props = $props();

	/**
	 * The importer's vocabulary is snake_case (`academic_library`), because the
	 * category belongs to the data rather than to the interface. Presenting it
	 * is this component's job, not the API's.
	 */
	function readableCategory(category: string): string {
		const words = category.replace(/_/g, ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}

	/**
	 * Neighborhood is absent for some records and borough never is, so the two
	 * are joined only when both exist rather than leaving a stray separator.
	 */
	function place(spot: StudySpot): string {
		return spot.neighborhood ? `${spot.neighborhood}, ${spot.borough}` : spot.borough;
	}
</script>

<section aria-label="Search results">
	<p class="count">
		{#if total === spots.length}
			{total} {total === 1 ? 'place' : 'places'}
		{:else}
			Showing {spots.length} of {total} places
		{/if}
	</p>

	<ul>
		{#each spots as spot (spot.id)}
			<li>
				<h3>{spot.name}</h3>
				<p class="meta">
					<span class="category">{readableCategory(spot.category)}</span>
					<span aria-hidden="true">·</span>
					<span>{place(spot)}</span>
				</p>
				{#if spot.address}
					<p class="address">{spot.address}</p>
				{/if}
				{#if spot.operator && spot.operator !== spot.name}
					<!--
						Who runs it, which for a library branch is its system. Worth
						showing because the three systems have separate membership,
						and a branch's own name never says which one it belongs to.

						Hidden when it merely repeats the name, which is what FacDB
						stores for the academic and special libraries.
					-->
					<p class="operator">{spot.operator}</p>
				{/if}
				{#if spot.university}
					<!-- Proximity, never affiliation: see the contract. -->
					<p class="campus">Near {spot.university}</p>
				{/if}
				{#if spot.no_purchase_needed || spot.free_public_wifi}
					<!--
						Both are shown only when true, and for the same reason: the
						absence of one is not evidence of its opposite. A false
						free_public_wifi means no hotspot the city publishes sits
						within 25 m, which is not the same as no Wi-Fi, and saying
						"no Wi-Fi" would assert more than the data supports.
					-->
					<p class="badges">
						{#if spot.no_purchase_needed}
							<!--
								Money, not entry. A campus building costs nothing and
								still wants the university's credentials, which is why
								this does not say "open to all".
							-->
							<span class="badge">
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M3.5 12.3V5.2a1.7 1.7 0 0 1 1.7-1.7h7.1l8.2 8.2-8.8 8.8-8.2-8.2Z" />
									<circle cx="8" cy="8" r="1.1" />
								</svg>
								No purchase needed
							</span>
						{/if}
						{#if spot.free_public_wifi}
							<span class="badge">
								<svg viewBox="0 0 24 24" aria-hidden="true">
									<path d="M5 12.5a10 10 0 0 1 14 0" />
									<path d="M8.5 16a5 5 0 0 1 7 0" />
									<circle cx="12" cy="19.5" r="1" />
								</svg>
								Free public Wi-Fi
							</span>
						{/if}
					</p>
				{/if}
			</li>
		{/each}
	</ul>

	{#if hasMore}
		<button type="button" onclick={() => onShowMore?.()} disabled={loadingMore}>
			{loadingMore ? 'Loading…' : 'Show more'}
		</button>
	{/if}
</section>

<style>
	section {
		width: min(1180px, 100%);
		margin: 0 auto;
		padding: 40px 0 72px;
		text-align: left;
	}

	.count {
		margin: 0 0 20px;
		color: var(--color-muted);
		font-size: 14px;
		font-weight: 600;
	}

	ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 16px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 18px;
		background: white;
	}

	h3 {
		margin: 0 0 8px;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.3;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin: 0;
		color: var(--color-muted);
		font-size: 13px;
	}

	.category {
		color: var(--color-brand-hover);
		font-weight: 650;
	}

	.address,
	.operator,
	.campus {
		margin: 10px 0 0;
		color: var(--color-muted);
		font-size: 13px;
		line-height: 1.5;
	}

	.campus {
		font-style: italic;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin: 10px 0 0;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--color-brand-hover);
		font-size: 13px;
		font-weight: 650;
	}

	.badge svg {
		width: 15px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	button {
		display: block;
		min-height: 48px;
		margin: 28px auto 0;
		padding: 0 28px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: white;
		font-size: 15px;
		font-weight: 650;
		cursor: pointer;
		transition: border-color 160ms ease;
	}

	button:hover:not(:disabled) {
		border-color: var(--color-text);
	}

	button:disabled {
		color: var(--color-muted);
		cursor: progress;
	}

	@media (max-width: 560px) {
		ul {
			grid-template-columns: 1fr;
		}
	}
</style>
