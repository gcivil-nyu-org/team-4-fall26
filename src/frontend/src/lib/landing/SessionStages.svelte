<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import AsciiScene from './AsciiScene.svelte';
	import type { Mood } from './ascii-scene';

	type StageId = 'before' | 'during' | 'after';
	type Stage = {
		id: StageId;
		label: string;
		title: string;
		body: string;
		cta: string;
		href: '/communities' | '/board';
		mood: Mood;
		seed: number;
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
			seed: 4
		},
		{
			id: 'during',
			label: 'In the session',
			title: 'Keep everyone in sync',
			body: 'Channels, threads and private messages keep the group together. Run a quick poll on where to meet, share notes and files, and pin what matters.',
			cta: 'Open your chats',
			href: '/communities',
			mood: 'day',
			seed: 9
		},
		{
			id: 'after',
			label: 'After the session',
			title: 'Pass the good spots on',
			body: 'Post what you found to the Board. Tag the spot, the subject and the university, so the next student knows where to go.',
			cta: 'Visit the Board',
			href: '/board',
			mood: 'dusk',
			seed: 2
		}
	];

	const articles: HTMLElement[] = [];
	// Which stage is under the middle of the screen, and how far through it.
	let active = $state(0);
	let fill = $state(0);

	onMount(() => {
		let frame = 0;

		function update() {
			frame = 0;
			const middle = innerHeight / 2;
			let current = 0;
			for (const [i, article] of articles.entries()) {
				if (article.getBoundingClientRect().top <= middle) current = i;
			}
			const box = articles[current].getBoundingClientRect();
			active = current;
			fill = Math.min(1, Math.max(0, (middle - box.top) / box.height));
		}

		function schedule() {
			if (!frame) frame = requestAnimationFrame(update);
		}

		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		update();
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
		};
	});
</script>

{#snippet windowBar(title: string)}
	<div class="window-bar" aria-hidden="true"><i></i><i></i><i></i></div>
	<p class="window-title">{title}</p>
{/snippet}

{#snippet communities()}
	{@render windowBar('Communities')}
	<ul class="rows">
		<li>
			<span class="avatar" style:--hue="12">O</span>
			<span class="row-text">
				<strong>Orgo Night Owls</strong>
				<small>New York University · Organic Chemistry · 18 members</small>
			</span>
			<span class="chip primary">Join</span>
		</li>
		<li>
			<span class="avatar" style:--hue="215">B</span>
			<span class="row-text">
				<strong>Butler Late Shift</strong>
				<small>Columbia University · 42 members</small>
			</span>
			<span class="chip">Joined</span>
		</li>
		<li>
			<span class="avatar" style:--hue="140">W</span>
			<span class="row-text">
				<strong>Thesis Writers Club</strong>
				<small>The New School · 9 members</small>
			</span>
			<span class="chip primary">Join</span>
		</li>
	</ul>
{/snippet}

{#snippet chat()}
	{@render windowBar('# tonight')}
	<div class="messages">
		<p class="message">
			<span class="avatar small" style:--hue="12">M</span>
			<span><strong>Maya</strong> anyone up for a session after 6?</span>
		</p>
		<p class="message">
			<span class="avatar small" style:--hue="260">T</span>
			<span><strong>Theo</strong> yes! saving two seats by the windows</span>
		</p>
		<div class="poll">
			<p class="poll-title">Where tonight?</p>
			<p class="poll-option" style:--share="62%">
				<span>Stephen A. Schwarzman Building</span><span>5</span>
			</p>
			<p class="poll-option" style:--share="38%">
				<span>Think Coffee · Greenwich Village</span><span>3</span>
			</p>
		</div>
		<p class="composer">Message #tonight</p>
	</div>
{/snippet}

{#snippet board()}
	{@render windowBar('Board')}
	<article class="post">
		<p class="post-title">Quiet tables after 4pm</p>
		<p class="post-body">
			Tried the Schwarzman Building for a long session this week. Calm once the afternoon rush
			clears.
		</p>
		<p class="tags">
			<span class="chip">Stephen A. Schwarzman Building</span>
			<span class="chip">Organic Chemistry</span>
			<span class="chip">New York University</span>
		</p>
		<p class="post-meta">Maya · 12 comments</p>
	</article>
{/snippet}

<section class="sessions" aria-labelledby="sessions-title">
	<div class="layout">
		<h2 id="sessions-title" class="heading">
			StudySpot helps you before, during and after your study sessions.
		</h2>

		<nav class="steps" aria-label="Study session stages">
			{#each stages as stage, i (stage.id)}
				<a
					href="#stage-{stage.id}"
					class:active={i === active}
					aria-current={i === active ? 'step' : undefined}
					style:--fill={i === active ? fill : 0}
				>
					{stage.label}
				</a>
			{/each}
		</nav>

		<div class="stages">
			{#each stages as stage, i (stage.id)}
				<article id="stage-{stage.id}" class="stage" bind:this={articles[i]}>
					<p class="stage-label">{stage.label}</p>
					<h3>{stage.title}</h3>
					<p class="stage-body">{stage.body}</p>
					<a class="cta" data-sveltekit-reload href={resolve(stage.href)}>{stage.cta} →</a>

					<div class="scene">
						<AsciiScene mood={stage.mood} seed={stage.seed} />
						<div class="window" aria-hidden="true">
							{#if stage.id === 'before'}
								{@render communities()}
							{:else if stage.id === 'during'}
								{@render chat()}
							{:else}
								{@render board()}
							{/if}
						</div>
					</div>
				</article>
			{/each}
		</div>
	</div>
</section>

<style>
	.sessions {
		--night: #18190f;
		--paper: #faf5f2;
		--window: #f6f4ee;
		--muted: #7c786c;
		padding: clamp(96px, 14vw, 180px) 24px clamp(96px, 12vw, 160px);
		background: var(--paper);
		color: var(--night);
	}

	.layout {
		display: grid;
		width: min(1200px, 100%);
		grid-template-columns: minmax(160px, 1fr) minmax(0, 1fr);
		column-gap: 48px;
		margin: 0 auto;
	}

	.heading {
		grid-column: 2;
		max-width: 12em;
		margin: 0 0 clamp(80px, 12vw, 160px);
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: clamp(2.5rem, 1.6rem + 2.6vw, 4rem);
		font-optical-sizing: auto;
		font-weight: 300;
		letter-spacing: -0.04em;
		line-height: 1;
		text-wrap: balance;
	}

	.steps {
		position: sticky;
		top: 120px;
		display: flex;
		width: 180px;
		flex-direction: column;
		align-self: start;
	}

	.steps a {
		position: relative;
		padding: 12px 0;
		border-bottom: 1px solid #e4ded6;
		color: var(--muted);
		font-size: 14px;
		transition: color 200ms ease;
	}

	.steps a.active {
		color: var(--night);
	}

	/* Granola's underline: grows with progress through the stage. */
	.steps a::after {
		position: absolute;
		bottom: -1px;
		left: 0;
		width: 100%;
		height: 2px;
		background: var(--night);
		content: '';
		transform: scaleX(var(--fill));
		transform-origin: left;
	}

	.stages {
		display: flex;
		flex-direction: column;
		gap: clamp(96px, 14vw, 180px);
	}

	.stage-label {
		display: none;
		margin: 0 0 8px;
		color: var(--muted);
		font-size: 13px;
	}

	h3 {
		margin: 0 0 12px;
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: clamp(1.6rem, 1.3rem + 0.8vw, 2rem);
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}

	.stage-body {
		max-width: 30em;
		margin: 0 0 14px;
		color: #3a3930;
		font-size: 17px;
		line-height: 1.5;
	}

	.cta {
		display: inline-block;
		margin-bottom: 28px;
		color: #b50935;
		font-size: 15px;
		font-weight: 600;
	}

	.cta:hover {
		text-decoration: underline;
	}

	.scene {
		position: relative;
		overflow: hidden;
		border-radius: 20px;
		aspect-ratio: 1;
		background: #ddd;
	}

	/*
		An app window on the painting, running off its right and bottom edges.
		Low enough that the skyline above it stays the picture.
	*/
	.window {
		position: absolute;
		top: 44%;
		left: 8%;
		width: 100%;
		height: 100%;
		padding: 18px 28px;
		border-radius: 18px;
		background: var(--window);
		box-shadow: 0 18px 50px rgb(24 25 15 / 22%);
		font-size: 14px;
	}

	.window-bar {
		display: flex;
		gap: 8px;
		margin-bottom: 16px;
	}

	.window-bar i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #d6d3cb;
	}

	.window-title {
		margin: 0 0 14px;
		font-family: Newsreader, ui-serif, Georgia, serif;
		font-size: clamp(1.5rem, 1.2rem + 0.8vw, 2rem);
		font-weight: 400;
		letter-spacing: -0.02em;
	}

	.rows {
		display: grid;
		max-width: 88%;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rows li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		border-radius: 14px;
		background: white;
	}

	.avatar {
		display: grid;
		width: 36px;
		height: 36px;
		flex: none;
		border-radius: 10px;
		background: hsl(var(--hue) 55% 88%);
		color: hsl(var(--hue) 45% 30%);
		font-weight: 700;
		place-items: center;
	}

	.avatar.small {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-size: 12px;
	}

	.row-text {
		display: grid;
		min-width: 0;
		flex: 1;
	}

	.row-text small {
		overflow: hidden;
		color: var(--muted);
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip {
		display: inline-block;
		padding: 5px 11px;
		border: 1px solid #dcd8ce;
		border-radius: 999px;
		color: #4b4a40;
		font-size: 12px;
		white-space: nowrap;
	}

	.chip.primary {
		border-color: transparent;
		background: #d90b3e;
		color: white;
	}

	.messages {
		display: grid;
		max-width: 86%;
		gap: 12px;
	}

	.message {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
	}

	.message strong {
		margin-right: 6px;
	}

	.poll {
		padding: 14px;
		border-radius: 14px;
		background: white;
	}

	.poll-title {
		margin: 0 0 10px;
		font-weight: 600;
	}

	.poll-option {
		display: flex;
		justify-content: space-between;
		margin: 6px 0 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: linear-gradient(to right, #fde2e8 var(--share), #f3f1ec var(--share));
		font-size: 13px;
	}

	.composer {
		margin: 4px 0 0;
		padding: 12px 14px;
		border: 1px solid #dcd8ce;
		border-radius: 12px;
		color: #a3a093;
	}

	.post {
		max-width: 86%;
		padding: 18px;
		border-radius: 14px;
		background: white;
	}

	.post-title {
		margin: 0 0 6px;
		font-size: 16px;
		font-weight: 650;
	}

	.post-body {
		margin: 0 0 14px;
		color: #4b4a40;
		line-height: 1.5;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 14px;
	}

	.post-meta {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
	}

	@media (max-width: 900px) {
		.layout {
			display: block;
		}

		.steps {
			display: none;
		}

		.stage-label {
			display: block;
		}
	}

	@media (max-width: 560px) {
		.sessions {
			padding-inline: 16px;
		}

		.scene {
			aspect-ratio: 4 / 5;
		}

		.window {
			top: 40%;
			left: 6%;
			padding: 14px 18px;
		}
	}
</style>
