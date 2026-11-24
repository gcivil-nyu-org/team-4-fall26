<script lang="ts">
	import { onMount } from 'svelte';

	type Word = { chars: string[]; start: number; italic: boolean };
	type Line = { text: string; words: Word[]; count: number };

	/** Split a sentence into words of characters, each with its index in the line. */
	function split(text: string, italic: ReadonlySet<string> = new Set()): Line {
		const parts = text.split(' ');
		const words: Word[] = [];
		let start = 0;
		for (const [i, word] of parts.entries()) {
			// The space rides on the word's last character, so a line can only
			// break between words.
			const chars = [...word];
			if (i < parts.length - 1) chars[chars.length - 1] += ' ';
			words.push({ chars, start, italic: italic.has(word) });
			start += chars.length;
		}
		return { text, words, count: start };
	}

	const refusal = split(
		'We refuse to accept a future where studying means crowded libraries, overpriced lattes, and hunting for an outlet.'
	);
	const introduction = split(
		'Introducing StudySpot — a calmer, more human way to find your place in the city.',
		new Set(['StudySpot'])
	);

	// Off until mounted, so the prerendered page and reduced motion both get
	// fully legible cards. The page starts Locomotive Scroll under the same
	// condition, and Locomotive is what writes `--progress` on the section.
	let animated = $state(false);

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		const sync = () => (animated = !motion.matches);
		motion.addEventListener('change', sync);
		sync();
		return () => motion.removeEventListener('change', sync);
	});
</script>

{#snippet letters(line: Line)}
	<span class="sr-only">{line.text}</span>
	<span aria-hidden="true">
		{#each line.words as word (word.start)}
			<span class="word" class:italic={word.italic}>
				{#each word.chars as char, i (i)}
					<span class="char" style:--i={word.start + i}>{char}</span>
				{/each}
			</span>
		{/each}
	</span>
{/snippet}

<!--
	Two full-screen cards that stick to the top in turn, so the second slides
	up over the first. Locomotive measures this section, not the cards: it
	caches positions, and a stuck card's position is not where it sits.
-->
<section
	class="statements"
	class:animated
	aria-labelledby="intro-title"
	data-scroll
	data-scroll-css-progress
>
	<div class="card refusal">
		<div class="surface">
			<p class="line" style:--count={refusal.count}>{@render letters(refusal)}</p>
		</div>
	</div>
	<div class="card introduction">
		<div class="surface">
			<h2 id="intro-title" class="line" style:--count={introduction.count}>
				{@render letters(introduction)}
			</h2>
		</div>
	</div>
	<!-- Holds the last card on screen for half a screen before it scrolls away. -->
	<div class="hold" aria-hidden="true"></div>
</section>

<style>
	.statements {
		/*
			The section is two screens of cards plus a half-screen hold, and
			Locomotive's progress runs from its top meeting the viewport bottom to
			its bottom leaving the viewport top: 3.5 screens. `--u` turns that
			back into screens scrolled since the section reached the top, so
			every phase below reads in screens: -1 entering, 0 the first card
			stuck, 1 the second card stuck.
		*/
		--u: calc(var(--progress, 1) * 3.5 - 1);
		--gutter: 12px;
		position: relative;
	}

	.card {
		position: sticky;
		top: 0;
		height: 100vh;
		height: 100svh;
		padding: var(--gutter);
		background: #1d170d;
	}

	.surface {
		display: grid;
		height: 100%;
		padding: 24px;
		overflow: hidden;
		border-radius: 24px;
		place-items: center;
	}

	.refusal .surface {
		background: #faf5f2;
		color: #18190f;
	}

	.introduction .surface {
		background: #d90b3e;
		color: #fff8ed;
	}

	.hold {
		height: 50vh;
		height: 50svh;
	}

	.line {
		max-width: 18em;
		margin: 0;
		font-family: Newsreader, ui-serif, Georgia, Cambria, 'Times New Roman', serif;
		font-size: clamp(2.5rem, 1.2rem + 3.4vw, 4.5rem);
		font-optical-sizing: auto;
		font-weight: 300;
		letter-spacing: -0.05em;
		line-height: 1;
		text-align: center;
		text-wrap: balance;
		perspective: 900px;
	}

	.introduction .line {
		max-width: 15em;
	}

	.word {
		display: inline-block;
		white-space: nowrap;
	}

	.italic {
		font-style: italic;
	}

	.char {
		display: inline-block;
		white-space: pre;
	}

	/* Each card's phases, all as 0..1 of the section's scroll. */
	.animated .refusal {
		--reveal: clamp(0, calc((var(--u) + 0.7) / 0.7), 1);
		--covered: clamp(0, var(--u), 1);
	}

	.animated .introduction {
		--entered: clamp(0, var(--u), 1);
		--reveal: clamp(0, calc((var(--u) - 0.35) / 0.75), 1);
	}

	/* The covered card sinks back a little as the next one slides over it. */
	.animated .refusal .surface {
		transform: scale(calc(1 - 0.06 * var(--covered)));
		filter: brightness(calc(1 - 0.45 * var(--covered)));
	}

	/*
		Parallax, as on A24's slides: the words move slower than their card,
		lagging behind it on the way in and drifting up on the way out.
	*/
	.animated .refusal .line {
		transform: translateY(calc(var(--covered) * -12vh));
	}

	.animated .introduction .line {
		transform: translateY(calc((1 - var(--entered)) * -35vh));
	}

	/*
		A soft front eight characters wide travelling along the line, so the
		words light up in reading order rather than all at once.
	*/
	.animated .char {
		--local: clamp(0, calc((var(--reveal) * (var(--count) + 8) - var(--i)) / 8), 1);
		opacity: calc(0.1 + 0.9 * var(--local));
		transform: translateY(calc((1 - var(--local)) * 0.3em))
			rotateX(calc((1 - var(--local)) * -70deg));
		transform-origin: 50% 100%;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (max-width: 560px) {
		.statements {
			--gutter: 8px;
		}

		.surface {
			border-radius: 18px;
		}
	}
</style>
