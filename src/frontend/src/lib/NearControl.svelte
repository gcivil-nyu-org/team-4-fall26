<script lang="ts">
	import type { Near } from './contract';
	import type { NeighborhoodGroup } from './near';

	type Props = {
		neighborhoods: NeighborhoodGroup[];
		/** The point results are ordered from, or null for the usual order. */
		near: Near | null;
		onNeighborhood: (name: string) => void;
		onClear: () => void;
	};

	let { neighborhoods, near, onNeighborhood, onClear }: Props = $props();
</script>

<div class="near" role="group" aria-label="Sort by distance">
	<div class="near-row">
		<label class="field">
			<span>Near neighborhood</span>
			<!--
				Grouped by borough because 207 names in one list is a scroll, and
				the borough is how people already narrow a place in this city.
			-->
			<select
				value={near?.kind === 'neighborhood' ? near.name : ''}
				onchange={(event) => {
					const name = event.currentTarget.value;
					if (name === '') onClear();
					else onNeighborhood(name);
				}}
			>
				<option value="">Choose…</option>
				{#each neighborhoods as group (group.borough)}
					<optgroup label={group.borough}>
						{#each group.neighborhoods as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>
	</div>

	{#if near}
		<p class="sorted">
			<!--
				A neighborhood is ordered from the middle of its spots, which the
				server works out; "from" rather than "in" because spots elsewhere
				are still listed, only further down.
			-->
			Nearest first from {near.kind === 'point' ? 'your location' : near.name}.
			<button type="button" class="clear" onclick={onClear}>Stop sorting by distance</button>
		</p>
	{/if}
</div>

<style>
	.near {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.near-row {
		display: grid;
	}

	.clear:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--ln-brand-hover, #7170ff);
		outline-offset: 2px;
	}

	.field {
		display: flex;
		min-width: 0;
		min-height: 56px;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 9px 14px;
		border: 1px solid var(--ln-border, rgb(255 255 255 / 8%));
		border-radius: 10px;
		background: var(--ln-surface, #141516);
	}

	.field > span {
		color: var(--ln-muted, #8a8f98);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.2;
	}

	select {
		width: 100%;
		min-width: 0;
		min-height: 26px;
		padding: 0 20px 0 0;
		border: 0;
		background-color: transparent;
		color: var(--ln-text, #f7f8f8);
		font-size: 14px;
		font-weight: 500;
		color-scheme: dark;
	}

	.sorted {
		margin: 0;
		padding: 0 6px;
		color: var(--ln-muted, #8a8f98);
		font-size: 13px;
		line-height: 1.5;
	}

	.clear {
		min-height: 32px;
		padding: 0 6px;
		border: 0;
		background: transparent;
		color: var(--ln-brand-hover, #7170ff);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.clear:hover {
		text-decoration: underline;
	}
</style>
