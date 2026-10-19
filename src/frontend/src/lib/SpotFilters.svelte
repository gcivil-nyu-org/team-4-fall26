<script lang="ts">
	import type { Facets, SpotFilters } from './contract';

	type Props = {
		facets: Facets | null;
		filters: SpotFilters;
		onChange: (filters: SpotFilters) => void;
	};

	let { facets, filters, onChange }: Props = $props();

	let active = $derived(
		Object.values(filters).filter((value) => value !== undefined && value !== '').length
	);

	/**
	 * The importer's vocabulary is snake_case, because the category belongs to
	 * the data. Presenting it is this component's job.
	 */
	function readable(value: string): string {
		const words = value.replace(/_/g, ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	}

	function set(change: Partial<SpotFilters>): void {
		const next = { ...filters, ...change };

		// An empty select or a cleared input means "no filter". Sent as an empty
		// string both endpoints answer 422, so the key is dropped instead.
		for (const key of Object.keys(next) as (keyof SpotFilters)[]) {
			if (next[key] === undefined || next[key] === '') delete next[key];
		}

		onChange(next);
	}
</script>

<div class="filters" role="group" aria-label="Filter results">
	<label>
		<span>Borough</span>
		<select
			value={filters.borough ?? ''}
			onchange={(event) => set({ borough: event.currentTarget.value })}
		>
			<option value="">Any</option>
			{#each facets?.boroughs ?? [] as facet (facet.value)}
				<option value={facet.value}>{facet.value} ({facet.count})</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Type</span>
		<select
			value={filters.category ?? ''}
			onchange={(event) => set({ category: event.currentTarget.value })}
		>
			<option value="">Any</option>
			{#each facets?.categories ?? [] as facet (facet.value)}
				<option value={facet.value}>{readable(facet.value)} ({facet.count})</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Campus</span>
		<!--
			A list rather than a select: there are 126 campuses, which is a
			scroll in a dropdown and a type-ahead in a datalist.
		-->
		<input
			list="campus-options"
			value={filters.university ?? ''}
			placeholder="Any"
			autocomplete="off"
			onchange={(event) => set({ university: event.currentTarget.value })}
		/>
		<datalist id="campus-options">
			{#each facets?.universities ?? [] as facet (facet.value)}
				<option value={facet.value}>{facet.count}</option>
			{/each}
		</datalist>
	</label>

	<label class="toggle">
		<input
			type="checkbox"
			checked={filters.free_public_wifi === true}
			onchange={(event) => set({ free_public_wifi: event.currentTarget.checked || undefined })}
		/>
		<!--
			"Free public Wi-Fi" rather than "has Wi-Fi": the data says a hotspot
			the city publishes is within 25 m, which a campus building's
			credentialled network is not.

			The count is how many of the currently matching spots have it, so it
			answers "is this worth ticking" before you tick it.
		-->
		<span>
			Free public Wi-Fi
			{#if facets}
				<span class="count">({facets.free_public_wifi})</span>
			{/if}
		</span>
	</label>

	<label class="toggle">
		<input
			type="checkbox"
			checked={filters.no_purchase_needed === true}
			onchange={(event) => set({ no_purchase_needed: event.currentTarget.checked || undefined })}
		/>
		<!--
			The question a student actually asks, and not any one type: it is
			true of every library and of the campus buildings, false only of
			cafés. About money rather than entry.
		-->
		<span>
			No purchase needed
			{#if facets}
				<span class="count">({facets.no_purchase_needed})</span>
			{/if}
		</span>
	</label>

	{#if active > 0}
		<button type="button" onclick={() => onChange({})}>
			Clear {active}
			{active === 1 ? 'filter' : 'filters'}
		</button>
	{/if}
</div>

<style>
	.filters {
		display: flex;
		width: min(1180px, 100%);
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 12px;
		margin: 0 auto;
		padding: 20px 0 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		font-weight: 700;
	}

	select,
	input[list] {
		min-width: 168px;
		min-height: 42px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: white;
		font-size: 14px;
	}

	.toggle {
		flex-direction: row;
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 0 14px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: white;
		cursor: pointer;
	}

	.toggle .count {
		color: var(--color-muted);
		font-weight: 600;
	}

	.toggle input {
		width: 16px;
		height: 16px;
		accent-color: var(--color-brand);
		cursor: pointer;
	}

	button {
		min-height: 42px;
		padding: 0 16px;
		border: 0;
		border-radius: 12px;
		color: var(--color-brand-hover);
		background: transparent;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
	}

	button:hover {
		text-decoration: underline;
	}

	@media (max-width: 560px) {
		.filters {
			gap: 10px;
		}

		label,
		select,
		input[list] {
			width: 100%;
			min-width: 0;
		}
	}
</style>
