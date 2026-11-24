<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	/** `over` slides up across `under`, which holds still and sinks back. */
	let { under, over }: { under: Snippet; over: Snippet } = $props();

	let stack: HTMLElement;
	let lower: HTMLElement;
	let upper: HTMLElement;

	onMount(() => {
		let frame = 0;

		function update() {
			frame = 0;
			// Pinned by its bottom edge, so a section taller than the screen is
			// read to the end before anything covers it.
			stack.style.setProperty('--pin', `${Math.min(0, innerHeight - lower.offsetHeight)}px`);
			const arriving = upper.getBoundingClientRect().top;
			const covered = Math.min(1, Math.max(0, 1 - arriving / innerHeight));
			stack.style.setProperty('--covered', covered.toFixed(3));
		}

		function schedule() {
			if (!frame) frame = requestAnimationFrame(update);
		}

		const size = new ResizeObserver(schedule);
		size.observe(lower);
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

<div class="stack" bind:this={stack}>
	<div class="under" bind:this={lower}>
		<div class="sink">{@render under()}</div>
	</div>
	<div class="over" bind:this={upper}>{@render over()}</div>
</div>

<style>
	.under {
		position: sticky;
		top: var(--pin, 0px);
	}

	/* The covered section sinks back a little as the next one slides over it. */
	.sink {
		transform: scale(calc(1 - 0.05 * var(--covered, 0)));
		transform-origin: 50% 100%;
		filter: brightness(calc(1 - 0.5 * var(--covered, 0)));
	}

	.over {
		position: relative;
		z-index: 1;
		overflow: hidden;
		margin-inline: 12px;
		border-radius: 28px 28px 0 0;
		box-shadow: 0 -24px 60px rgb(0 0 0 / 35%);
	}

	@media (prefers-reduced-motion: reduce) {
		.sink {
			transform: none;
			filter: none;
		}
	}

	@media (max-width: 560px) {
		.over {
			margin-inline: 8px;
			border-radius: 20px 20px 0 0;
		}
	}
</style>
