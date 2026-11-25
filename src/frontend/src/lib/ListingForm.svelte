<script lang="ts">
	import { BOROUGHS, type ListingDraft } from './contract';
	import {
		EMPTY_LISTING,
		PRECISE_LOCATE_OPTIONS,
		formatCoordinates,
		isInNewYork,
		problemsFrom,
		readCoordinates,
		toDraft,
		COORDINATE_PROBLEMS,
		type Answer,
		type FieldProblems,
		type ListingFields,
		type SubmitResult
	} from './listing';
	import { untrack } from 'svelte';
	import { locate, type Located } from './near';

	type Props = {
		/** Sends the draft; the form shows whatever problems come back. */
		onSubmit: (draft: ListingDraft) => Promise<SubmitResult>;
		onCancel: () => void;
		/** Replaceable so a test can answer without a real browser position. */
		findLocation?: () => Promise<Located>;
		/** What the controls start with: blank to add, the listing to edit. */
		initial?: ListingFields;
		/** Only the wording differs between adding and editing. */
		purpose?: 'add' | 'edit';
	};
	let {
		onSubmit,
		onCancel,
		findLocation = () => locate(navigator.geolocation, PRECISE_LOCATE_OPTIONS),
		initial = EMPTY_LISTING,
		purpose = 'add'
	}: Props = $props();

	const WORDING = {
		add: { title: 'Add a listing', submit: 'Add listing', busy: 'Adding…' },
		edit: { title: 'Edit listing', submit: 'Save changes', busy: 'Saving…' }
	} as const;
	const wording = $derived(WORDING[purpose]);

	const id = $props.id();
	// The form is opened afresh for each listing, so only the first `initial` counts.
	let fields = $state({ ...untrack(() => initial) });
	/** Where an edited listing already is, which the city check lets stand. */
	const existing = untrack(() => {
		const read = readCoordinates(initial.coordinates);
		return read.kind === 'found' ? read.value : undefined;
	});
	let problems = $state<FieldProblems>({});
	let general = $state<string[]>([]);
	let submitting = $state(false);
	let locating = $state(false);
	let locationNotice = $state('');

	const LOCATION_NOTICES = {
		denied: 'Location access is blocked. Paste the coordinates instead.',
		unavailable: 'Could not find your location. Try again, or paste the coordinates.',
		unsupported: 'This browser cannot share your location. Paste the coordinates instead.'
	} as const;

	const ANSWERS: { value: Answer; label: string }[] = [
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' },
		{ value: 'unknown', label: 'Not sure' }
	];
	const QUESTIONS = [
		{ key: 'indoor_seating', label: 'Indoor seating' },
		{ key: 'venue_wifi', label: 'Wi-Fi for visitors' }
	] as const;

	async function useCurrentLocation(): Promise<void> {
		if (locating) return;
		locating = true;
		locationNotice = '';
		try {
			const located = await findLocation();
			if (located.kind !== 'found') {
				locationNotice = LOCATION_NOTICES[located.kind];
				return;
			}
			// Shown in the box so the owner can see and correct it; checked
			// against the city like a pasted value, here and again on submit.
			fields.coordinates = formatCoordinates(located);
			problems = {
				...problems,
				coordinates: isInNewYork(located) ? undefined : COORDINATE_PROBLEMS.outside
			};
		} finally {
			locating = false;
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting) return;
		const checked = toDraft(fields, existing);
		if (checked.kind === 'invalid') {
			problems = checked.problems;
			general = [];
			return;
		}
		problems = {};
		general = [];
		submitting = true;
		try {
			const result = await onSubmit(checked.draft);
			if (result.kind === 'failed') {
				const sorted = problemsFrom(result.details);
				problems = sorted.fields;
				// Say something even when every detail found its control.
				general =
					sorted.general.length > 0 || Object.keys(sorted.fields).length > 0
						? sorted.general
						: [result.message];
			}
		} finally {
			submitting = false;
		}
	}
</script>

{#snippet problem(field: keyof FieldProblems)}
	{#if problems[field]}
		<p class="problem" id="{id}-{field}-problem">{problems[field]}</p>
	{/if}
{/snippet}

<form aria-labelledby="{id}-title" novalidate onsubmit={submit}>
	<h3 id="{id}-title">{wording.title}</h3>
	{#each general as message (message)}
		<p class="problem" role="alert">{message}</p>
	{/each}
	<fieldset disabled={submitting}>
		<label>
			<span>Name</span>
			<input
				bind:value={fields.name}
				autocomplete="organization"
				aria-invalid={problems.name ? 'true' : undefined}
				aria-describedby={problems.name ? `${id}-name-problem` : undefined}
			/>
		</label>
		{@render problem('name')}

		<p class="fixed">Category: Cafe</p>

		<label>
			<span>Address <small>(optional)</small></span>
			<input
				bind:value={fields.address}
				autocomplete="street-address"
				aria-invalid={problems.address ? 'true' : undefined}
				aria-describedby={problems.address ? `${id}-address-problem` : undefined}
			/>
		</label>
		{@render problem('address')}

		<label>
			<span>Neighborhood <small>(optional)</small></span>
			<input
				bind:value={fields.neighborhood}
				aria-invalid={problems.neighborhood ? 'true' : undefined}
				aria-describedby={problems.neighborhood ? `${id}-neighborhood-problem` : undefined}
			/>
		</label>
		{@render problem('neighborhood')}

		<label>
			<span>Borough</span>
			<select
				bind:value={fields.borough}
				aria-invalid={problems.borough ? 'true' : undefined}
				aria-describedby={problems.borough ? `${id}-borough-problem` : undefined}
			>
				<option value="" disabled>Choose a borough</option>
				{#each BOROUGHS as borough (borough)}
					<option value={borough}>{borough}</option>
				{/each}
			</select>
		</label>
		{@render problem('borough')}

		<label for="{id}-coordinates"><span>Coordinates</span></label>
		<div class="coordinates">
			<input
				id="{id}-coordinates"
				bind:value={fields.coordinates}
				placeholder="40.7259, -73.9946"
				aria-invalid={problems.coordinates ? 'true' : undefined}
				aria-describedby="{id}-coordinates-hint {id}-coordinates-check{problems.coordinates
					? ` ${id}-coordinates-problem`
					: ''}"
			/>
			<button type="button" disabled={locating} onclick={() => void useCurrentLocation()}>
				{locating ? 'Locating…' : 'Use my current location'}
			</button>
		</div>
		<p class="hint" id="{id}-coordinates-hint">
			In Google Maps, right-click your place and click the coordinates to copy them, then paste them
			here.
		</p>
		<p class="check-location" id="{id}-coordinates-check">Check the location before saving.</p>
		{#if locationNotice}
			<p class="notice" role="status">{locationNotice}</p>
		{/if}
		{@render problem('coordinates')}

		<label class="check">
			<input type="checkbox" bind:checked={fields.no_purchase_needed} />
			<span>No purchase needed to stay</span>
		</label>
		{@render problem('no_purchase_needed')}

		{#each QUESTIONS as question (question.key)}
			<fieldset class="answers">
				<legend>{question.label}</legend>
				{#each ANSWERS as answer (answer.value)}
					<label class="check">
						<input type="radio" value={answer.value} bind:group={fields[question.key]} />
						<span>{answer.label}</span>
					</label>
				{/each}
			</fieldset>
			{@render problem(question.key)}
		{/each}

		<label>
			<span>Opening hours <small>(optional)</small></span>
			<input
				bind:value={fields.opening_hours}
				placeholder="Mo-Fr 08:00-18:00; Sa-Su 09:00-17:00"
				aria-invalid={problems.opening_hours ? 'true' : undefined}
				aria-describedby={problems.opening_hours ? `${id}-opening_hours-problem` : undefined}
			/>
		</label>
		{@render problem('opening_hours')}

		<div class="actions">
			<button type="submit" class="primary">{submitting ? wording.busy : wording.submit}</button>
			<button type="button" onclick={onCancel}>Cancel</button>
		</div>
	</fieldset>
</form>

<style>
	form {
		display: grid;
		gap: 8px;
		margin-block: 12px 20px;
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 16px;
		background: #fff;
		text-align: left;
	}
	h3 {
		font-size: 1rem;
		font-weight: 700;
	}
	fieldset {
		display: grid;
		gap: 8px;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	label {
		display: grid;
		gap: 4px;
		font-size: 0.875rem;
		font-weight: 600;
	}
	small,
	.hint,
	.fixed,
	.notice {
		color: var(--color-muted);
		font-size: 0.8125rem;
		font-weight: 400;
	}
	input:not([type='checkbox'], [type='radio']),
	select {
		min-height: 44px;
		width: 100%;
		min-width: 0;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-weight: 400;
	}
	[aria-invalid='true'] {
		border-color: var(--color-brand-hover);
	}
	.coordinates {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.coordinates input {
		flex: 1 1 200px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		font-weight: 400;
	}
	.answers {
		display: flex;
		flex-wrap: wrap;
		gap: 0 16px;
	}
	legend {
		font-size: 0.875rem;
		font-weight: 600;
	}
	.check-location {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.problem {
		color: var(--color-brand-hover);
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 8px;
	}
	button {
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		color: var(--color-brand-hover);
		background: #fff;
		font-weight: 650;
		cursor: pointer;
	}
	button.primary {
		border-color: transparent;
		color: #fff;
		background: var(--color-brand-hover);
	}
	button:disabled {
		cursor: progress;
		opacity: 0.6;
	}
</style>
