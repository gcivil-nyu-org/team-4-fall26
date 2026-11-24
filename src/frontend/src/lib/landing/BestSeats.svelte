<script lang="ts">
	import { resolve } from '$app/paths';
	import type { BoroughSeats, Seat } from '$lib/server/snapshot';
	import { place, readableCategory } from '$lib/spot';
	import { orderByTrunk, routeColour, routeTextColour, walkMinutes } from '$lib/subway';

	let { boroughs }: { boroughs: readonly BoroughSeats[] } = $props();

	/** Invite-card colours, one per row, so neighbouring cards never match. */
	const CARD_COLOURS = [
		['#ff5f6d', '#ffc371'],
		['#7f7fd5', '#91eae4'],
		['#f953c6', '#b91d73'],
		['#43cea2', '#185a9d'],
		['#f7971e', '#ffd200']
	] as const;

	let selected = $state(0);
	/** The row whose card is showing, or null when none is. */
	let previewing = $state<number | null>(null);
	let pointer = $state({ x: 0, y: 0 });
	let list = $state<HTMLElement | null>(null);

	const current = $derived(boroughs[selected]);
	const preview = $derived<Seat | null>(
		previewing === null ? null : (current?.seats[previewing] ?? null)
	);
	const tabIds = $derived(boroughs.map((group) => `seats-tab-${group.borough.replace(' ', '-')}`));

	function follow(event: PointerEvent) {
		if (!list || event.pointerType === 'touch') return;
		const bounds = list.getBoundingClientRect();
		pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	/** Keyboard focus has no pointer, so the card sits beside the focused row. */
	function focusRow(index: number, row: HTMLElement) {
		if (!list) return;
		const bounds = list.getBoundingClientRect();
		const box = row.getBoundingClientRect();
		pointer = { x: bounds.width * 0.62, y: box.top - bounds.top + box.height / 2 };
		previewing = index;
	}

	function choose(index: number) {
		selected = index;
		previewing = null;
	}

	/** Left and right move between boroughs, as tabs do. */
	function tabKeys(event: KeyboardEvent) {
		const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		choose((selected + step + boroughs.length) % boroughs.length);
		document.getElementById(tabIds[selected])?.focus();
	}
</script>

{#snippet bullets(seat: Seat)}
	{#each orderByTrunk(seat.subway_routes.split(' ')) as route (route)}
		<span class="bullet" style:background={routeColour(route)} style:color={routeTextColour(route)}
			>{route}</span
		>
	{/each}
{/snippet}

{#if boroughs.length > 0}
	<section class="seats" aria-labelledby="seats-title">
		<header>
			<h2 id="seats-title">The best seats in your city</h2>
			<p class="rule">
				Free to sit, a Wi-Fi hotspot nearby, and a step-free station close by. Five per borough,
				nearest train first.
			</p>
		</header>

		<div class="tabs" role="tablist" aria-label="Borough">
			{#each boroughs as group, i (group.borough)}
				<button
					id={tabIds[i]}
					type="button"
					role="tab"
					aria-selected={i === selected}
					aria-controls="seats-panel"
					tabindex={i === selected ? 0 : -1}
					onclick={() => choose(i)}
					onkeydown={tabKeys}
				>
					{group.borough}
				</button>
			{/each}
			<a class="everywhere" href="{resolve('/')}?view=map">Everywhere</a>
		</div>

		<div
			id="seats-panel"
			class="panel"
			role="tabpanel"
			tabindex="-1"
			aria-labelledby={tabIds[selected]}
			bind:this={list}
			onpointermove={follow}
			onpointerleave={() => (previewing = null)}
		>
			<ol>
				{#each current?.seats ?? [] as seat, i (seat.id)}
					<li>
						<a
							class="row"
							href={resolve(`/spots/${seat.id}` as '/')}
							onpointerenter={() => (previewing = i)}
							onfocus={(event) => focusRow(i, event.currentTarget)}
							onblur={() => (previewing = null)}
						>
							<span class="index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
							<span class="roll">
								<span>{seat.name}</span>
								<span aria-hidden="true">{seat.name}</span>
							</span>
							<span class="meta">
								<span>{seat.neighborhood ?? seat.borough}</span>
								<span class="train">
									{@render bullets(seat)}
									{walkMinutes(seat.subway_metres)} min walk
								</span>
							</span>
						</a>
					</li>
				{/each}
				<li>
					<a class="row all" href="{resolve('/')}?view=map">
						<span class="index" aria-hidden="true">→</span>
						<span class="roll">
							<span>Everywhere</span>
							<span aria-hidden="true">Everywhere</span>
						</span>
						<span class="meta">See every spot on the map</span>
					</a>
				</li>
			</ol>

			{#if preview && previewing !== null}
				{@const [from, to] = CARD_COLOURS[previewing % CARD_COLOURS.length]}
				<div
					class="card"
					aria-hidden="true"
					style:--x="{pointer.x}px"
					style:--y="{pointer.y}px"
					style:background="linear-gradient(150deg, {from}, {to})"
				>
					<span class="label">{readableCategory(preview.category)}</span>
					<p class="card-name">{preview.name}</p>
					<p class="card-place">{place(preview)}</p>
					<div class="card-foot">
						<p class="card-train">
							{@render bullets(preview)}
							{preview.subway_station}
						</p>
						<p class="chips">
							<span>{walkMinutes(preview.subway_metres)} min walk</span>
							<span>Step-free</span>
							<span>Wi-Fi nearby</span>
							<span>Free to sit</span>
						</p>
					</div>
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	.seats {
		--ink: #f6f1e9;
		--dim: #8f897e;
		--rule: rgb(246 241 233 / 18%);
		padding: clamp(96px, 12vw, 160px) clamp(16px, 4vw, 48px) clamp(80px, 10vw, 140px);
		background: #0d0d0b;
		color: var(--ink);
	}

	header {
		margin-bottom: 36px;
	}

	/* Partiful's headline: heavy, upper case, packed tight. */
	h2 {
		max-width: 11em;
		margin: 0 0 18px;
		font-size: clamp(2.75rem, 1.2rem + 5vw, 6.5rem);
		font-weight: 900;
		letter-spacing: -0.045em;
		line-height: 0.88;
		text-transform: uppercase;
	}

	.rule {
		max-width: 34em;
		margin: 0;
		color: #bdb6aa;
		font-size: 18px;
		line-height: 1.5;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 28px;
	}

	.tabs button,
	.everywhere {
		padding: 10px 18px;
		border: 1px solid var(--rule);
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 180ms ease,
			color 180ms ease;
	}

	.tabs button[aria-selected='true'] {
		border-color: var(--ink);
		background: var(--ink);
		color: #0d0d0b;
	}

	.tabs button:hover,
	.everywhere:hover {
		border-color: var(--ink);
	}

	.panel {
		position: relative;
	}

	ol {
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--rule);
		list-style: none;
	}

	/* Featured-work rows: a number, a huge name, the facts. */
	.row {
		display: grid;
		align-items: center;
		grid-template-columns: 56px minmax(0, 1fr) auto;
		gap: 16px;
		padding: 18px 0;
		border-top: 1px solid var(--rule);
	}

	.index {
		color: var(--dim);
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}

	/* The name rolls up to reveal its copy. */
	.roll {
		display: grid;
		overflow: hidden;
		height: 1.12em;
		/* Fixed rows, so the hidden copy can't be squeezed up into view. */
		grid-template-rows: 100% 100%;
		font-size: clamp(1.9rem, 0.9rem + 3.4vw, 4.75rem);
		font-weight: 500;
		letter-spacing: -0.045em;
		line-height: 1.12;
	}

	.roll span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: transform 480ms cubic-bezier(0.7, 0, 0.2, 1);
	}

	.row:hover .roll span,
	.row:focus-visible .roll span {
		transform: translateY(-100%);
	}

	.meta {
		display: grid;
		justify-items: end;
		gap: 6px;
		color: var(--dim);
		font-size: 14px;
		text-align: right;
	}

	.train,
	.card-train {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.bullet {
		display: inline-grid;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		font-size: 11px;
		font-weight: 700;
		place-items: center;
	}

	.train .bullet:last-of-type,
	.card-train .bullet:last-of-type {
		margin-right: 4px;
	}

	.all .roll {
		color: var(--dim);
	}

	/* The invite card, held at a slight angle beside the pointer. */
	.card {
		position: absolute;
		z-index: 2;
		top: 0;
		left: 0;
		display: flex;
		width: 290px;
		flex-direction: column;
		padding: 20px;
		border-radius: 22px;
		aspect-ratio: 4 / 5;
		box-shadow: 0 24px 60px rgb(0 0 0 / 45%);
		color: #14120e;
		pointer-events: none;
		transform: translate(calc(var(--x) + 28px), calc(var(--y) - 50%)) rotate(-4deg);
		transition: transform 140ms ease-out;
	}

	.label {
		align-self: flex-start;
		padding: 5px 10px;
		border-radius: 999px;
		background: rgb(255 255 255 / 55%);
		font-size: 12px;
		font-weight: 700;
	}

	.card-name {
		margin: 18px 0 6px;
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: 34px;
		font-style: italic;
		letter-spacing: -0.03em;
		line-height: 1;
	}

	.card-place {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		opacity: 0.75;
	}

	.card-foot {
		display: grid;
		gap: 10px;
		margin-top: auto;
	}

	.card-train {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
	}

	.chips span {
		padding: 4px 9px;
		border-radius: 999px;
		background: rgb(20 18 14 / 85%);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}

	/* No pointer to follow on touch screens, so no card either. */
	@media (hover: none) {
		.card {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.roll span,
		.card {
			transition: none;
		}
	}

	@media (max-width: 700px) {
		.row {
			grid-template-columns: 32px minmax(0, 1fr);
		}

		.meta {
			grid-column: 2;
			justify-items: start;
			text-align: left;
		}
	}
</style>
