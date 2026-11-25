<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import AsciiScene from './AsciiScene.svelte';
	import type { Mood } from './ascii-scene';

	type StageId = 'before' | 'during' | 'after';
	type Suit = 'moon' | 'sun' | 'star';
	type Stage = {
		id: StageId;
		label: string;
		title: string;
		body: string;
		cta: string;
		href: '/communities' | '/board';
		mood: Mood;
		seed: number;
		/** The card's corner index: its rank, and a suit drawn from its time of day. */
		rank: string;
		suit: Suit;
		red: boolean;
	};

	const stages: readonly Stage[] = [
		{
			id: 'before',
			label: 'Before the session',
			title: 'Find your study group',
			body: 'Browse public communities by school and course, or start your own in seconds. No account needed: join as a guest and bring friends in with an invite link.',
			cta: 'Browse communities',
			href: '/communities',
			mood: 'dawn',
			seed: 4,
			rank: 'A',
			suit: 'moon',
			red: false
		},
		{
			id: 'during',
			label: 'In the session',
			title: 'Keep everyone in sync',
			body: 'Channels, threads and private messages keep the group together. Run a quick poll on where to meet, share notes and files, and pin what matters.',
			cta: 'Open your chats',
			href: '/communities',
			mood: 'day',
			seed: 9,
			rank: '2',
			suit: 'sun',
			red: true
		},
		{
			id: 'after',
			label: 'After the session',
			title: 'Pass the good spots on',
			body: 'Post what you found to the Board. Tag the spot, the subject and the university, so the next student knows where to go.',
			cta: 'Visit the Board',
			href: '/board',
			mood: 'dusk',
			seed: 2,
			rank: '3',
			suit: 'star',
			red: false
		}
	];

	/*
		The suits, drawn as solid shapes on a 24 x 24 grid so they stay crisp at
		any size: a crescent cut from a disc, a sun with eight pointed rays, and
		a five-pointed star.
	*/
	const point = (r: number, degrees: number, x = 12, y = 12) => {
		const a = ((degrees - 90) * Math.PI) / 180;
		return `${(x + Math.cos(a) * r).toFixed(2)},${(y + Math.sin(a) * r).toFixed(2)}`;
	};
	const SUN_RAYS = Array.from({ length: 8 }, (_, i) =>
		[point(6.4, i * 45 - 9), point(11.5, i * 45), point(6.4, i * 45 + 9)].join(' ')
	);
	const STAR = Array.from({ length: 10 }, (_, i) => point(i % 2 ? 4.6 : 11, i * 36)).join(' ');

	/*
		A hand of playing cards. They wait stacked face down in the middle, and
		when the section comes into view they are dealt out into a fan, each
		turning face up as it lands. Once dealt they settle, so hovering one
		lifts it at once rather than after the deal's stagger.
	*/
	let section: HTMLElement;
	let dealt = $state(false);
	let settled = $state(false);

	/** A held card tilts towards the pointer, and the light on it follows. */
	function tilt(event: PointerEvent) {
		if (!settled || event.pointerType !== 'mouse') return;
		const card = event.currentTarget as HTMLElement;
		const bounds = card.getBoundingClientRect();
		const x = (event.clientX - bounds.left) / bounds.width;
		const y = (event.clientY - bounds.top) / bounds.height;
		card.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(2)}deg`);
		card.style.setProperty('--rx', `${((0.5 - y) * 16).toFixed(2)}deg`);
		card.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
		card.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
	}

	function untilt(event: PointerEvent) {
		const card = event.currentTarget as HTMLElement;
		for (const name of ['--rx', '--ry', '--gx', '--gy']) card.style.removeProperty(name);
	}

	onMount(() => {
		let timer = 0;
		const deal = () => {
			dealt = true;
			timer = window.setTimeout(() => (settled = true), 1600);
		};
		const watch = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				watch.disconnect();
				deal();
			},
			{ threshold: 0.3 }
		);
		watch.observe(section);
		return () => {
			watch.disconnect();
			clearTimeout(timer);
		};
	});
</script>

{#snippet corner(stage: Stage, position: 'top' | 'bottom')}
	<span class="index {position}" aria-hidden="true">
		<span class="rank">{stage.rank}</span>
		<svg class="suit" viewBox="0 0 24 24">
			{#if stage.suit === 'moon'}
				<!-- The crescent: a disc with an offset disc masked out of it. -->
				<mask id="moon-{stage.id}-{position}">
					<rect width="24" height="24" fill="#fff" />
					<circle cx="16.6" cy="8.4" r="8" fill="#000" />
				</mask>
				<circle cx="12" cy="12" r="10" mask="url(#moon-{stage.id}-{position})" />
			{:else if stage.suit === 'sun'}
				<circle cx="12" cy="12" r="5" />
				{#each SUN_RAYS as ray, i (i)}<polygon points={ray} />{/each}
			{:else}
				<polygon points={STAR} />
			{/if}
		</svg>
	</span>
{/snippet}

<section class="sessions" aria-labelledby="sessions-title" bind:this={section}>
	<h2 id="sessions-title" class="heading">
		StudySpot helps you before, during and after your study sessions.
	</h2>

	<ol class="hand" class:dealt class:settled>
		{#each stages as stage, i (stage.id)}
			<li
				class="card"
				class:red={stage.red}
				style:--i={i}
				style:--side={i - 1}
				onpointermove={tilt}
				onpointerleave={untilt}
			>
				<div class="flip">
					<article class="face front" aria-labelledby="stage-{stage.id}">
						{@render corner(stage, 'top')}
						<div class="frame">
							<p class="label">{stage.label}</p>
							<h3 id="stage-{stage.id}">{stage.title}</h3>
							<div class="picture" aria-hidden="true">
								<AsciiScene mood={stage.mood} seed={stage.seed} />
							</div>
							<p class="body">{stage.body}</p>
							<a class="cta" data-sveltekit-reload href={resolve(stage.href)}>{stage.cta} →</a>
						</div>
						{@render corner(stage, 'bottom')}
					</article>
					<div class="face back" aria-hidden="true">
						<span class="monogram">S</span>
					</div>
				</div>
			</li>
		{/each}
	</ol>
</section>

<style>
	.sessions {
		--night: #18190f;
		--paper: #faf5f2;
		--card: #fffdf8;
		--red: #b50935;
		--muted: #7c786c;
		--width: 340px;
		/* How far apart neighbouring cards sit in the fan. */
		--step: calc(var(--width) - 36px);
		padding: clamp(96px, 12vw, 160px) 24px clamp(110px, 13vw, 180px);
		overflow: hidden;
		background: var(--paper);
		color: var(--night);
	}

	.heading {
		max-width: 14em;
		margin: 0 auto clamp(56px, 8vw, 96px);
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: clamp(2.5rem, 1.6rem + 2.6vw, 4rem);
		font-optical-sizing: auto;
		font-weight: 300;
		letter-spacing: -0.04em;
		line-height: 1;
		text-align: center;
		text-wrap: balance;
	}

	/* The hand: three cards fanned from a point below their centres. */
	.hand {
		display: flex;
		justify-content: center;
		margin: 0;
		padding: 0;
		list-style: none;
		perspective: 1800px;
	}

	.card {
		--suit: var(--night);
		position: relative;
		width: var(--width);
		flex: none;
		margin: 0 -18px;
		aspect-ratio: 5 / 7;
		/* Waiting in a pile in the middle, face down. */
		transform: translate(calc(var(--side) * var(--step) * -1), 60px)
			rotate(calc(var(--side) * 2deg));
		transform-origin: 50% 120%;
		transition: transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i) * 140ms);
	}

	.card.red {
		--suit: var(--red);
	}

	/* Dealt: fanned, the outer cards turned out and dropped a little. */
	.dealt .card {
		transform: translateY(calc(var(--side) * var(--side) * 22px)) rotate(calc(var(--side) * 9deg));
	}

	.settled .card {
		transition-delay: 0s;
		transition-duration: 450ms;
	}

	/* Picked out of the hand: up, straight, and in front of the others. */
	.settled .card:is(:hover, :focus-within) {
		z-index: 2;
		transform: translateY(-34px) rotate(0) scale(1.04);
	}

	.flip {
		position: relative;
		height: 100%;
		transform: rotateY(180deg);
		transform-style: preserve-3d;
		transition: transform 700ms cubic-bezier(0.3, 0.7, 0.2, 1) calc(var(--i) * 140ms + 380ms);
	}

	/* Face up; once settled, a held card leans towards the pointer. */
	.dealt .flip {
		transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
	}

	.settled .flip {
		transition-delay: 0s;
		transition-duration: 180ms;
	}

	/* Plain white stock, a hairline edge, a soft shadow on the table. */
	.face {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border: 1px solid #e3ded5;
		border-radius: 16px;
		background: #fff;
		backface-visibility: hidden;
		box-shadow:
			0 18px 36px rgb(24 25 15 / 12%),
			0 2px 6px rgb(24 25 15 / 8%);
	}

	/* A faint sheen that follows the pointer while the card is held. */
	.front::after {
		position: absolute;
		background: radial-gradient(
			circle at var(--gx, 50%) var(--gy, 0%),
			rgb(255 255 255 / 55%),
			transparent 50%
		);
		content: '';
		inset: 0;
		opacity: 0;
		pointer-events: none;
		transition: opacity 250ms ease;
	}

	.settled .card:hover .front::after {
		opacity: 1;
	}

	/* The corner index: rank over suit, repeated upside down. */
	.index {
		position: absolute;
		display: grid;
		width: 24px;
		justify-items: center;
		color: var(--suit);
		line-height: 1;
	}

	.index.top {
		top: 16px;
		left: 14px;
	}

	.index.bottom {
		right: 14px;
		bottom: 16px;
		transform: rotate(180deg);
	}

	.rank {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.03em;
	}

	.suit {
		width: 16px;
		height: 16px;
		margin-top: 4px;
		fill: currentColor;
		shape-rendering: geometricPrecision;
	}

	.frame {
		position: absolute;
		display: flex;
		flex-direction: column;
		padding: 0;
		inset: 52px 48px 52px;
		text-align: left;
	}

	.label {
		margin: 0 0 8px;
		color: var(--muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h3 {
		margin: 0 0 16px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.picture {
		position: relative;
		overflow: hidden;
		flex: none;
		border-radius: 8px;
		margin-bottom: 14px;
		aspect-ratio: 2 / 1;
		background: #eee;
	}

	.body {
		margin: 0;
		color: #55534b;
		font-size: 13px;
		line-height: 1.5;
	}

	.cta {
		margin-top: auto;
		color: var(--night);
		font-size: 13px;
		font-weight: 600;
	}

	.cta:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.cta:focus-visible {
		border-radius: 3px;
		outline: 2px solid var(--night);
		outline-offset: 3px;
	}

	/* The back: one flat colour, a white rule inside the edge, a small mark. */
	.back {
		display: grid;
		border: 0;
		background: var(--red);
		place-items: center;
		transform: rotateY(180deg);
	}

	.back::before {
		position: absolute;
		border: 1.5px solid rgb(255 255 255 / 85%);
		border-radius: 10px;
		content: '';
		inset: 12px;
	}

	.monogram {
		color: #fff;
		font-size: 44px;
		font-weight: 700;
		letter-spacing: -0.04em;
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.flip,
		.front::after {
			transition: none;
		}
	}

	/* Too narrow to fan: the cards are laid down one under the other. */
	@media (max-width: 1000px) {
		.hand {
			flex-direction: column;
			align-items: center;
			gap: 24px;
		}

		.card {
			width: min(var(--width), 100%);
			margin: 0;
			transform: translateY(60px);
		}

		.dealt .card {
			transform: rotate(calc(var(--side) * 2deg));
		}
	}
</style>
