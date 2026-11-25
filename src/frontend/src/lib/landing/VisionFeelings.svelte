<script lang="ts">
	import { onMount } from 'svelte';
	import { FEELINGS, imageUrl, sourceUrl, type Artwork } from './feelings';

	/** How long each feeling holds before the list moves on by itself. */
	const CYCLE_MS = 5000;

	let active = $state(0);
	// Hovering or focusing the list hands control to the reader for good.
	let chosen = $state(false);
	let list: HTMLElement;

	function choose(index: number) {
		chosen = true;
		active = index;
	}

	function credit(artwork: Artwork): string {
		return `${artwork.title}, ${artwork.artist}, ${artwork.date}`;
	}

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let visible = false;
		const seen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
		seen.observe(list);
		const timer = setInterval(() => {
			if (!chosen && visible && !motion.matches && !document.hidden) {
				active = (active + 1) % FEELINGS.length;
			}
		}, CYCLE_MS);
		return () => {
			clearInterval(timer);
			seen.disconnect();
		};
	});
</script>

{#snippet frame(artwork: Artwork, kind: string, caption?: string)}
	<figure class="frame {kind}">
		<img
			src={imageUrl(artwork)}
			alt="{artwork.title}, {artwork.artist}"
			loading="lazy"
			decoding="async"
		/>
		<figcaption>
			{#if caption}<span class="meaning">{caption}</span>{/if}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external image credit -->
			<a class="credit" href={sourceUrl(artwork)} rel="noopener" target="_blank"
				>{credit(artwork)}</a
			>
		</figcaption>
	</figure>
{/snippet}

<section class="vision" aria-labelledby="vision-title">
	<h2 id="vision-title" class="statement">
		The vision for <em>StudySpot</em> is to turn the whole city into a third place: open, calm, and shared,
		where anyone can find a seat and the people to study with.
	</h2>

	<div class="feelings">
		<div class="list" bind:this={list}>
			<p class="list-title">StudySpot feels like</p>
			<ul>
				{#each FEELINGS as feeling, i (feeling.name)}
					<li>
						<button
							type="button"
							class:active={i === active}
							aria-pressed={i === active}
							aria-controls="feeling-gallery"
							onpointerenter={() => choose(i)}
							onfocus={() => choose(i)}
							onclick={() => choose(i)}
						>
							<span class="thumb" aria-hidden="true">
								<img src={imageUrl(feeling.artworks[0], 250)} alt="" loading="lazy" />
							</span>
							{feeling.name}
						</button>
					</li>
				{/each}
			</ul>
		</div>

		<!--
			Every feeling's images are in the page at once and cross-fade, so
			switching never waits on a download. Only the active set is exposed.
		-->
		<div class="gallery" id="feeling-gallery">
			{#each FEELINGS as feeling, i (feeling.name)}
				<div class="set" class:active={i === active} inert={i !== active}>
					{@render frame(feeling.artworks[0], 'main', feeling.meaning)}
					{@render frame(feeling.artworks[1], 'upper')}
					{@render frame(feeling.artworks[2], 'lower')}
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	.vision {
		--night: #18190f;
		--faded: #d6d0c6;
		padding: clamp(96px, 14vw, 200px) 24px clamp(96px, 12vw, 160px);
		background: #faf5f2;
		color: var(--night);
	}

	/* Daylight's vision line: light serif, centred, a measure of ~20 words. */
	.statement {
		max-width: 20em;
		margin: 0 auto clamp(96px, 14vw, 180px);
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: clamp(2rem, 1.2rem + 2.6vw, 3.5rem);
		font-optical-sizing: auto;
		font-weight: 300;
		letter-spacing: -0.035em;
		line-height: 1.1;
		text-align: center;
		text-wrap: balance;
	}

	.statement em {
		font-style: italic;
	}

	.feelings {
		display: grid;
		width: min(1320px, 100%);
		grid-template-columns: minmax(0, 6fr) minmax(0, 6fr);
		gap: 32px;
		margin: 0 auto;
	}

	.list-title {
		margin: 0 0 8px;
		font-size: clamp(1.75rem, 1.2rem + 1.6vw, 3rem);
		font-weight: 500;
		letter-spacing: -0.035em;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Cosmos's list: big grey names, the current one black with its picture. */
	.list button {
		display: inline-flex;
		align-items: center;
		padding: 0;
		border: 0;
		background: none;
		color: var(--faded);
		font-size: clamp(2.2rem, 1rem + 3.4vw, 4.5rem);
		font-weight: 600;
		letter-spacing: -0.045em;
		line-height: 1.12;
		text-align: left;
		cursor: pointer;
		transition: color 220ms ease;
	}

	.list button.active {
		color: var(--night);
	}

	.thumb {
		display: inline-block;
		width: 0;
		height: 0.9em;
		flex: none;
		overflow: hidden;
		margin-right: 0;
		border-radius: 0.12em;
		transition:
			width 320ms ease,
			margin 320ms ease;
	}

	.active .thumb {
		width: 0.9em;
		margin-right: 0.22em;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.gallery {
		position: relative;
		min-height: 780px;
	}

	.set {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity 420ms ease;
		pointer-events: none;
	}

	.set.active {
		opacity: 1;
		pointer-events: auto;
	}

	.frame {
		position: absolute;
		margin: 0;
		transform: translateY(16px);
		transition: transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.active .frame {
		transform: none;
	}

	.active .upper {
		transition-delay: 70ms;
	}

	.active .lower {
		transition-delay: 140ms;
	}

	.frame img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 5;
		border-radius: 6px;
		background: #ebe4da;
		object-fit: cover;
	}

	.main {
		top: 12%;
		left: 0;
		width: 54%;
	}

	.upper {
		top: 0;
		right: 0;
		width: 38%;
	}

	.lower {
		right: 4%;
		bottom: 0;
		width: 34%;
	}

	figcaption {
		display: grid;
		gap: 8px;
		margin-top: 10px;
	}

	.meaning {
		color: #3a3930;
		font-size: 16px;
		line-height: 1.45;
	}

	.credit {
		color: #8a857a;
		font-size: 12px;
		line-height: 1.4;
	}

	.credit:hover {
		text-decoration: underline;
	}

	@media (prefers-reduced-motion: reduce) {
		.set,
		.frame,
		.thumb {
			transition: none;
		}
	}

	@media (max-width: 900px) {
		.feelings {
			grid-template-columns: 1fr;
		}

		.gallery {
			order: 1;
			min-height: 0;
			aspect-ratio: 4 / 5;
			margin-bottom: 120px;
		}
	}
</style>
