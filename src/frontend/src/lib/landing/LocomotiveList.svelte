<script lang="ts" module>
	/** How one row is named, split, linked and pictured. */
	export type Row = {
		key: string;
		/** Already resolved by the caller. */
		href: string;
		/** The full name, for screen readers and the link. */
		name: string;
		/** Where the picture opens: the text before it, and after it. */
		before: string;
		after: string;
		/** The picture that opens in the gap. */
		image: string;
	};

	/** Split after the first word, as Locomotive does: "The / Drake Hotel". */
	export function splitName(name: string): { before: string; after: string } {
		const space = name.indexOf(' ');
		return space === -1
			? { before: name, after: '' }
			: { before: name.slice(0, space), after: name.slice(space + 1) };
	}

	/** Each word's own letters in a random order (Fisher–Yates), spaces kept. */
	export function shuffleWords(text: string): string {
		return text
			.split(' ')
			.map((word) => {
				const letters = [...word];
				for (let i = letters.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[letters[i], letters[j]] = [letters[j], letters[i]];
				}
				return letters.join('');
			})
			.join(' ');
	}
</script>

<script lang="ts" generics="T">
	import { pauseOffscreen } from '$lib/offscreen';

	type Props = {
		items: readonly T[];
		row: (item: T) => Row;
		/** A last row with stars either side, as Locomotive's "All Work". */
		cta?: Row;
	};

	let { items, row, cta }: Props = $props();

	/*
		Locomotive's hover shuffle, step for step: on entering a row, every word
		is reshuffled four times across a quarter second (one step each 62.5ms),
		and the real text returns as the last step lands -- so three scrambles
		show, then the name. Leaving cancels it and restores the text at once.
		The screen-reader heading never changes.
	*/
	const SHUFFLE_SECONDS = 0.25;
	const SHUFFLE_STEPS = 4;
	const running = new WeakMap<HTMLElement, number[]>();

	function parts(item: HTMLElement): HTMLElement[] {
		return [...item.querySelectorAll<HTMLElement>('[data-shuffle]')].filter(
			(part) => part.dataset.shuffle
		);
	}

	function restore(item: HTMLElement) {
		for (const timer of running.get(item) ?? []) clearTimeout(timer);
		running.delete(item);
		for (const part of parts(item)) part.textContent = part.dataset.shuffle ?? '';
	}

	function shuffle(item: HTMLElement) {
		restore(item);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const step = (SHUFFLE_SECONDS / SHUFFLE_STEPS) * 1000;
		const timers: number[] = [];
		for (let i = 0; i < SHUFFLE_STEPS - 1; i++) {
			timers.push(
				window.setTimeout(() => {
					for (const part of parts(item)) part.textContent = shuffleWords(part.textContent ?? '');
				}, step * i)
			);
		}
		timers.push(window.setTimeout(() => restore(item), step * (SHUFFLE_STEPS - 1)));
		running.set(item, timers);
	}
</script>

{#snippet line(entry: Row, isCta: boolean)}
	<li
		class="item"
		class:cta={isCta}
		onpointerenter={(event) => shuffle(event.currentTarget)}
		onpointerleave={(event) => restore(event.currentTarget)}
		onfocusin={(event) => shuffle(event.currentTarget)}
		onfocusout={(event) => restore(event.currentTarget)}
	>
		<h3 class="sr-only">{entry.name}</h3>
		<div class="title" aria-hidden="true">
			<span data-shuffle={entry.before}>{entry.before}</span>
			<span class="visual" style:background-image="url({JSON.stringify(entry.image)})"></span>
			<span data-shuffle={entry.after}>{entry.after}</span>
		</div>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolved paths -->
		<a class="link" href={entry.href}>{entry.name}</a>
	</li>
{/snippet}

<ul class="list" {@attach pauseOffscreen}>
	{#each items as item (row(item).key)}
		{@render line(row(item), false)}
	{/each}
	{#if cta}{@render line(cta, true)}{/if}
</ul>

<style>
	/*
		Locomotive's "Featured work", measure for measure. Colours and the
		title size come from the section: --ink and --title-size.
	*/
	.list {
		--border: var(--rule-width, 2px) solid var(--ink, #000);
		--enter: 0.45s;
		--leave: 0.2s;
		--easing: cubic-bezier(0.23, 1, 0.32, 1);
		margin: 0;
		padding: 0;
		border-bottom: var(--border);
		color: var(--ink, #000);
		list-style: none;
	}

	.item {
		position: relative;
		display: flex;
		padding: 20px 0;
		border-top: var(--border);
	}

	.title {
		display: flex;
		flex-grow: 1;
		justify-content: center;
		font-family: 'Instrument Serif', ui-serif, Georgia, serif;
		font-size: var(--title-size, 7.6389vw);
		line-height: 1;
		text-align: center;
	}

	.title > span:not(.visual) {
		display: inline-block;
		transform: translateY(0.1em);
	}

	.title > span:first-child:not(:empty) {
		padding-right: 0.1em;
	}

	.title > span:last-child:not(:empty) {
		padding-left: 0.1em;
	}

	/* The picture opens between the words: nothing wide, then 1.5em. */
	.visual {
		position: relative;
		display: inline-block;
		overflow: hidden;
		width: 0;
		flex: none;
		background-position: center;
		background-size: cover;
		vertical-align: bottom;
		pointer-events: none;
		transition: width var(--leave) var(--easing);
	}

	.visual::before {
		display: block;
		padding-bottom: 1em;
		content: '';
	}

	.item:hover .visual,
	.item:focus-within .visual {
		width: 1.5em;
		transition-duration: var(--enter);
	}

	/* The whole row is the link; its text is for screen readers. */
	.link {
		position: absolute;
		inset: 0;
		font-size: 0;
	}

	.link:focus-visible {
		outline: 2px solid var(--ink, #000);
		outline-offset: -6px;
	}

	/* The last row flashes a star either side, as "All Work" does. */
	.cta .title::before,
	.cta .title::after {
		align-self: center;
		font-size: 50%;
		content: '✳';
		animation: flash 2s linear infinite;
	}

	.cta:focus-within .title::before,
	.cta:focus-within .title::after {
		content: '(+)';
		animation: none;
	}

	/* Out of view the stars stop flashing; see pauseOffscreen. A blink is
		exactly what someone asking for less motion does not want. */
	.list:global([data-offscreen]) .title::before,
	.list:global([data-offscreen]) .title::after {
		animation-play-state: paused;
	}

	@media (prefers-reduced-motion: reduce) {
		.cta .title::before,
		.cta .title::after {
			animation: none;
		}
	}

	@keyframes flash {
		50% {
			opacity: 0;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.visual {
			transition: none;
		}

		.cta .title::before,
		.cta .title::after {
			animation: none;
		}
	}

	@media (max-width: 1024px) {
		.list {
			--rule-width: 1px;
		}
	}

	@media (max-width: 699px) {
		.item {
			padding: 10px 0;
		}

		.title {
			font-size: 40px;
		}

		.visual {
			display: none;
		}
	}
</style>
