<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	/**
	 * A deck of flashcards: every section is a card, and each one slides up
	 * over the one before, which holds still and sinks back into the deck.
	 */
	let { cards }: { cards: readonly Snippet[] } = $props();

	let deck: HTMLElement;
	const holders: HTMLElement[] = [];

	onMount(() => {
		let frame = 0;

		function update() {
			frame = 0;
			// Below a sticky header, if the page has one, rather than under it.
			const top = parseFloat(getComputedStyle(deck).getPropertyValue('--deck-top')) || 0;
			holders.forEach((holder, i) => {
				// Pinned by its bottom edge, so a card taller than the screen is
				// read to the end before the next one covers it.
				holder.style.setProperty('--pin', `${Math.min(top, innerHeight - holder.offsetHeight)}px`);
				const next = holders[i + 1];
				const arriving = next ? next.getBoundingClientRect().top : innerHeight;
				const covered = Math.min(1, Math.max(0, 1 - arriving / innerHeight));
				holder.style.setProperty('--covered', covered.toFixed(3));
			});
		}

		function schedule() {
			if (!frame) frame = requestAnimationFrame(update);
		}

		const size = new ResizeObserver(schedule);
		for (const holder of holders) size.observe(holder);
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		update();
		return () => {
			cancelAnimationFrame(frame);
			size.disconnect();
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
		};
	});
</script>

<div class="deck" bind:this={deck}>
	{#each cards as card, i (i)}
		<div class="holder" bind:this={holders[i]} style:--lean={i % 2 ? 1 : -1}>
			<div class="card">{@render card()}</div>
		</div>
	{/each}
</div>

<style>
	.holder {
		position: sticky;
		top: var(--pin, 0px);
	}

	.holder + .holder {
		margin-top: 12px;
	}

	/*
		Each card sits inset with rounded corners, like a flashcard on a table.
		Covered, it sinks back: smaller, darker, and turned a degree or so,
		alternating sides so the deck looks stacked by hand.
	*/
	.card {
		/* Clipped rather than hidden, so sticky parts inside a card still stick. */
		overflow: clip;
		margin-inline: 12px;
		border-radius: 28px;
		box-shadow: 0 -18px 50px rgb(0 0 0 / 35%);
		filter: brightness(calc(1 - 0.45 * var(--covered, 0)));
		transform: scale(calc(1 - 0.06 * var(--covered, 0)))
			rotate(calc(var(--lean) * 1.4deg * var(--covered, 0)));
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
