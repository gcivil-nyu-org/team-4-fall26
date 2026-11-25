<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { fly, scale } from 'svelte/transition';
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
	/** The seat whose card is showing, or null when none is. */
	let previewing = $state<string | null>(null);
	let pointer = $state({ x: 0, y: 0 });
	let list = $state<HTMLElement | null>(null);

	const current = $derived(boroughs[selected]);

	/*
		Votes. Each seat starts with a count of its own -- made up, but the same
		on every visit, so the list does not reshuffle on reload. Each heart adds
		one more, like a clap, as many times as you like, and the list re-sorts
		the moment it lands. The starting counts sit close together so
		a few votes can carry a seat up. Your votes are kept in this browser
		only; there is no server tally yet.
	*/
	const VOTES_KEY = 'studyspot:seat-votes';
	let mine = $state<Record<string, number>>({});

	/** A stable number in [0, 1) from a seat's id. */
	function seeded(id: string): number {
		let hash = 2166136261;
		for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
		return (hash >>> 0) / 4294967296;
	}

	const votes = (seat: Seat) => 24 + Math.floor(seeded(seat.id) * 18) + (mine[seat.id] ?? 0);

	/** Most votes first; ties keep the nearest-train order they arrived in. */
	const ranked = $derived(
		[...(current?.seats ?? [])]
			.map((seat, order) => ({ seat, order, count: votes(seat) }))
			.sort((a, b) => b.count - a.count || a.order - b.order)
	);

	/*
		The heart is drawn like a video game's: pixels on a 9 x 8 grid, filled
		in red with a highlight once you have given any, and every press throws
		a "+1" up off it that fades as it rises.
	*/
	const HEART = [
		'.XX...XX.',
		'XXXX.XXXX',
		'XXXXXXXXX',
		'XXXXXXXXX',
		'.XXXXXXX.',
		'..XXXXX..',
		'...XXX...',
		'....X....'
	];
	const HEART_PIXELS = HEART.flatMap((row, y) =>
		[...row].flatMap((cell, x) => (cell === 'X' ? [{ x, y }] : []))
	);

	let pops = $state<{ id: number; seat: string; drift: number }[]>([]);
	let nextPop = 0;

	function vote(seat: Seat) {
		mine = { ...mine, [seat.id]: (mine[seat.id] ?? 0) + 1 };
		const pop = { id: nextPop++, seat: seat.id, drift: Math.round(Math.random() * 24 - 12) };
		pops = [...pops, pop];
		setTimeout(() => (pops = pops.filter((other) => other.id !== pop.id)), 700);
		try {
			localStorage.setItem(VOTES_KEY, JSON.stringify(mine));
		} catch {
			// Private windows and blocked storage: the vote still counts for this visit.
		}
	}

	onMount(() => {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(VOTES_KEY) ?? '{}');
			if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
				mine = Object.fromEntries(
					Object.entries(saved).filter(
						(entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] > 0
					)
				);
			}
		} catch {
			// Nothing saved, or storage unavailable: start without votes.
		}
	});

	const preview = $derived<Seat | null>(
		current?.seats.find((seat) => seat.id === previewing) ?? null
	);
	/** Where the previewed seat sits in the list, for its card colour. */
	const previewRank = $derived(ranked.findIndex(({ seat }) => seat.id === previewing));
	const tabIds = $derived(boroughs.map((group) => `seats-tab-${group.borough.replace(' ', '-')}`));

	function follow(event: PointerEvent) {
		if (!list || event.pointerType === 'touch') return;
		const bounds = list.getBoundingClientRect();
		pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	}

	/** Keyboard focus has no pointer, so the card sits beside the focused row. */
	function focusRow(id: string, row: HTMLElement) {
		if (!list) return;
		const bounds = list.getBoundingClientRect();
		const box = row.getBoundingClientRect();
		pointer = { x: bounds.width * 0.62, y: box.top - bounds.top + box.height / 2 };
		previewing = id;
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
			<h2 id="seats-title">The city's favourite spots</h2>
			<p class="rule">
				Five free third places per borough, each with Wi-Fi nearby and a step-free station close by.
				Heart the ones you keep going back to, and watch them climb.
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
				{#each ranked as { seat, count }, i (seat.id)}
					{@const given = mine[seat.id] ?? 0}
					<li class="row" animate:flip={{ duration: 450 }}>
						<span class="index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
						<a
							class="name"
							href={resolve(`/spots/${seat.id}` as '/')}
							onpointerenter={() => (previewing = seat.id)}
							onpointerleave={() => (previewing = null)}
							onfocus={(event) => focusRow(seat.id, event.currentTarget)}
							onblur={() => (previewing = null)}
						>
							<span class="roll">
								<span>{seat.name}</span>
								<span aria-hidden="true">{seat.name}</span>
							</span>
						</a>
						<button
							type="button"
							class="vote"
							onpointerenter={() => (previewing = null)}
							class:voted={given > 0}
							aria-label="Heart {seat.name}, {count} hearts"
							onclick={() => vote(seat)}
						>
							{#key count}
								<svg
									class="heart"
									viewBox="0 0 9 8"
									shape-rendering="crispEdges"
									aria-hidden="true"
									in:scale={{ start: 1.5, duration: 220 }}
								>
									{#each HEART_PIXELS as pixel (`${pixel.x},${pixel.y}`)}
										<rect x={pixel.x} y={pixel.y} width="1" height="1" />
									{/each}
									{#if given > 0}<rect class="shine" x="1" y="1" width="1" height="1" />{/if}
								</svg>
							{/key}
							<span class="count">
								{#key count}<span in:fly={{ y: 10, duration: 200 }}>×{count}</span>{/key}
							</span>
							{#each pops.filter((pop) => pop.seat === seat.id) as pop (pop.id)}
								<span class="pop" aria-hidden="true" style:--drift="{pop.drift}px">+1</span>
							{/each}
						</button>
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

			{#if preview}
				{@const [from, to] = CARD_COLOURS[Math.max(0, previewRank) % CARD_COLOURS.length]}
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
	.row:focus-visible .roll span,
	.name:focus-visible .roll span {
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

	.card-train .bullet:last-of-type {
		margin-right: 4px;
	}

	/* Only as wide as the name, so the card shows over the name and nowhere else. */
	.name {
		min-width: 0;
		max-width: 100%;
		justify-self: start;
		color: inherit;
	}

	.name:focus-visible {
		border-radius: 4px;
		outline: 2px solid var(--ink);
		outline-offset: 4px;
	}

	/* The vote: no button chrome, just a game's heart and its counter. */
	.vote {
		position: relative;
		display: inline-flex;
		min-width: 112px;
		height: 48px;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding: 0 4px;
		border: 0;
		background: transparent;
		color: var(--ink);
		/* Press Start 2P, renamed: its licence reserves the name for the unmodified font. */
		font-family: 'StudySpot Pixel', ui-monospace, monospace;
		font-size: 14px;
		cursor: pointer;
	}

	.vote:focus-visible {
		border-radius: 4px;
		outline: 2px solid var(--ink);
		outline-offset: 3px;
	}

	.heart {
		width: 27px;
		height: 24px;
		fill: #5c5850;
		transition:
			transform 160ms steps(3),
			fill 120ms steps(2);
	}

	.vote:hover .heart {
		transform: translateY(-2px);
	}

	.vote:active .heart {
		transform: scale(0.85);
	}

	.voted .heart {
		fill: #ff2e4d;
	}

	.heart .shine {
		fill: #ffd5dc;
	}

	/* "+1", thrown up off the heart, rising and fading in a few hard steps. */
	.pop {
		position: absolute;
		top: -6px;
		right: 52px;
		color: #ff2e4d;
		font-size: 12px;
		pointer-events: none;
		text-shadow: 2px 2px 0 #0d0d0b;
		animation: pop 700ms steps(7) forwards;
	}

	@keyframes pop {
		to {
			opacity: 0;
			transform: translate(var(--drift), -42px);
		}
	}

	/* One line tall, so the old number slides out as the new one slides in. */
	.count {
		display: inline-grid;
		overflow: hidden;
		height: 1.2em;
		line-height: 1.2;
	}

	.count > span {
		grid-area: 1 / 1;
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
		.vote,
		.heart,
		.pop,
		.card {
			transition: none;
		}
	}

	@media (max-width: 700px) {
		.row {
			grid-template-columns: 32px minmax(0, 1fr) auto;
		}

		.vote {
			min-width: 84px;
			height: 40px;
			gap: 8px;
			font-size: 11px;
		}

		.heart {
			width: 22px;
			height: 20px;
		}

		.meta {
			grid-column: 2;
			justify-items: start;
			text-align: left;
		}
	}
</style>
