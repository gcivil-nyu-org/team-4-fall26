<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	/**
	 * A deck of flashcards: every section is a card, and each one slides up
	 * over the one before, which holds still and sinks back into the deck.
	 */
	let { cards }: { cards: readonly Snippet[] } = $props();

	let deck: HTMLElement;
	const holders: HTMLElement[] = [];
	const cardElements: HTMLElement[] = [];

	/*
		Scroll work stays within the frame budget by touching as little as it can.
		Every position is read before anything is written, so the browser lays out
		once per frame rather than once per card. And the sinking is written as
		each card's own transform and filter rather than as a custom property:
		a custom property is inherited, so changing one restyled everything inside
		every card -- the phone, the spiral, the lists -- about 6 s of style work
		in a 4 s scroll. Where each card pins only changes with its size, so that
		is measured on resize, not on scroll.
	*/
	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let frame = 0;

		function pin() {
			// Below a sticky header, if the page has one, rather than under it.
			const top = parseFloat(getComputedStyle(deck).getPropertyValue('--deck-top')) || 0;
			const heights = holders.map((holder) => holder.offsetHeight);
			holders.forEach((holder, i) => {
				// Pinned by its bottom edge, so a card taller than the screen is
				// read to the end before the next one covers it.
				holder.style.top = `${Math.min(top, innerHeight - heights[i])}px`;
			});
		}

		// Positions are read in the scroll event, before any frame callback has
		// written to the page, and written in the next frame.
		let arriving: number[] = [];

		function measure() {
			arriving = holders.map((_, i) =>
				i + 1 < holders.length ? holders[i + 1].getBoundingClientRect().top : innerHeight
			);
		}

		function sink() {
			frame = 0;
			if (motion.matches) return;
			cardElements.forEach((card, i) => {
				const covered = Number(Math.min(1, Math.max(0, 1 - arriving[i] / innerHeight)).toFixed(3));
				const lean = i % 2 ? 1 : -1;
				card.style.transform = `scale(${1 - 0.06 * covered}) rotate(${lean * 1.4 * covered}deg)`;
				card.style.filter = `brightness(${1 - 0.45 * covered})`;
			});
		}

		function scrolled() {
			measure();
			if (!frame) frame = requestAnimationFrame(sink);
		}

		function resized() {
			pin();
			scrolled();
		}

		// Under reduced motion the stylesheet holds every card flat; inline
		// styles would override it, so they are cleared.
		function motionChanged() {
			for (const card of cardElements) {
				card.style.transform = '';
				card.style.filter = '';
			}
			scrolled();
		}

		const size = new ResizeObserver(resized);
		for (const holder of holders) size.observe(holder);
		addEventListener('scroll', scrolled, { passive: true });
		addEventListener('resize', resized);
		motion.addEventListener('change', motionChanged);
		pin();
		measure();
		sink();
		return () => {
			cancelAnimationFrame(frame);
			size.disconnect();
			removeEventListener('scroll', scrolled);
			removeEventListener('resize', resized);
			motion.removeEventListener('change', motionChanged);
		};
	});
</script>

<div class="deck" bind:this={deck}>
	{#each cards as card, i (i)}
		<div class="holder" bind:this={holders[i]}>
			<div class="card" bind:this={cardElements[i]}>{@render card()}</div>
		</div>
	{/each}
</div>

<style>
	/* Each holder's `top` is set from script; see `pin()`. */
	.holder {
		position: sticky;
		top: 0;
	}

	.holder + .holder {
		margin-top: 12px;
	}

	/*
		Each card sits inset with rounded corners, like a flashcard on a table.
		Covered, it sinks back: smaller, darker, and turned a degree or so,
		alternating sides so the deck looks stacked by hand. Script sets that
		per card as it is covered (`sink()`); the transform and filter here are
		the uncovered state, which is what renders before it runs.
	*/
	.card {
		/* Clipped rather than hidden, so sticky parts inside a card still stick. */
		overflow: clip;
		margin-inline: 12px;
		border-radius: 28px;
		box-shadow: 0 -18px 50px rgb(0 0 0 / 35%);
		filter: brightness(1);
		transform: scale(1) rotate(0deg);
		transform-origin: 50% 100%;
	}

	/* The last card runs straight into whatever follows: no inset, no lower corners. */
	.holder:last-child .card {
		margin-inline: 0;
		border-radius: 28px 28px 0 0;
		box-shadow: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			filter: none;
			transform: none;
		}
	}

	@media (max-width: 560px) {
		.holder + .holder {
			margin-top: 8px;
		}

		.card {
			margin-inline: 8px;
			border-radius: 20px;
		}

		.holder:last-child .card {
			margin-inline: 0;
			border-radius: 20px 20px 0 0;
		}
	}
</style>
