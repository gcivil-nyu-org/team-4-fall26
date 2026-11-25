<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { SPIRAL_PICTURES as PICTURES } from './spiral-pictures';

	/*
		Partiful's closing "Spiral CTA": pictures stream along a spiral into the
		button. The maths and settings are theirs -- the spiral's shape, how
		pictures grow along it, the fade at either end, and how a stage that is
		not 1440 wide shrinks the spiral and lengthens it to fill the space.
		Ours adds two things: stirring the pointer around the button swirls the
		pictures along with it, and a picture under the pointer lifts out.
	*/

	type Shape = {
		turns: number;
		/** Outer radius, as a percentage of the reference size. */
		endRadius: number;
		/** Where the spiral starts, in degrees. */
		rotation: number;
		horizontal: number;
		vertical: number;
		referenceHeight: number;
		/** A picture's side in pixels before scaling, and its random range. */
		base: number;
		min: number;
		max: number;
		/** Scale at the centre and at the outer end. */
		startScale: number;
		endScale: number;
		/** Pictures along one reference-sized spiral. */
		count: number;
		/** The stage width the spiral is drawn for at full size. */
		referenceWidth: number;
	};

	const WIDE: Shape = {
		turns: 3.4,
		endRadius: 104,
		rotation: 134,
		horizontal: 1.03,
		vertical: 1,
		referenceHeight: 600,
		base: 39,
		min: 0.68,
		max: 1.27,
		startScale: 0.05,
		endScale: 2.85,
		count: 102,
		referenceWidth: 1440
	};

	const NARROW: Shape = {
		turns: 3,
		endRadius: 86,
		rotation: 130,
		horizontal: 0.96,
		vertical: 0.95,
		referenceHeight: 689,
		base: 37,
		min: 0.91,
		max: 1.27,
		startScale: 0.05,
		endScale: 3,
		count: 78,
		// Partiful draws phones against 1440 too, which packs hundreds of
		// tiny pictures in; against 720 they stay big enough to recognise.
		referenceWidth: 720
	};

	/** Partiful caps the spiral's reference size at this many pixels. */
	const MOST_SIZE = 1440;
	const NARROW_BELOW = 810;
	/** Where along the path the stream starts. */
	const START = 0.23;
	/** One full pass of the spiral every 115 seconds, so pictures visibly travel in. */
	const DRIFT_PER_MS = 1 / 115000;
	/** Fade in and out over the first and last 1% of the path. */
	const FADE = 0.01;
	/** A cap on pictures, since a tall phone screen asks for hundreds. */
	const MOST_COPIES = 360;
	/** How much a stir carries over: 1 moves the pictures exactly with the pointer. */
	const STIR = 1.4;
	/** The share of a stir still to come that is spent per 60fps frame. */
	const SETTLE = 0.1;

	let copies = $state(0);
	let section: HTMLElement;
	const items: HTMLElement[] = [];

	const fraction = (value: number) => ((value % 1) + 1) % 1;
	const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
	const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
	const smooth = (value: number) => {
		const t = clamp(value);
		return t * t * (3 - 2 * t);
	};
	const wrap = (value: number, size: number) => ((value % size) + size) % size;
	/** The same random number for the same picture every time. */
	const random = (index: number, salt: number) =>
		fraction(Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453);

	/** How much smaller than the reference the spiral is drawn. */
	function shrink(width: number, height: number, shape: Shape) {
		return width >= shape.referenceWidth
			? 1
			: Math.max(0.001, Math.min(1, width / shape.referenceWidth, height / shape.referenceHeight));
	}

	/** How far past one reference spiral the path must run to fill the stage. */
	function extent(width: number, height: number, shape: Shape) {
		if (width >= shape.referenceWidth)
			return Math.max(1, width / shape.referenceWidth, height / shape.referenceHeight);
		const scale = shrink(width, height, shape);
		return (
			Math.max(
				1,
				width / (shape.referenceWidth * scale),
				height / (shape.referenceHeight * scale)
			) +
			1 / Math.max(1, shape.turns)
		);
	}

	/** Pictures are spaced evenly in time, so the path's far end gets the square root. */
	const reach = (length: number) => (length <= 1 ? length : Math.sqrt(2 * length - 1));

	onMount(() => {
		let width = 0;
		let height = 0;
		let shape = WIDE;
		let progress = START;
		let stirring = 0;
		let lastAngle: number | null = null;
		let visible = true;
		let frame = 0;
		let last = 0;

		function measure() {
			width = section.clientWidth;
			height = section.clientHeight;
			shape = width < NARROW_BELOW ? NARROW : WIDE;
			const length = extent(width, height, shape);
			copies = Math.min(
				MOST_COPIES,
				length <= 1 ? shape.count : Math.ceil(shape.count * (1 + (length * length - 1) / 2))
			);
		}

		function point(along: number, end: number, scale: number) {
			const t = clamp(along, 0, end);
			const angle = (shape.rotation * Math.PI) / 180 + t * shape.turns * Math.PI * 2;
			const size = Math.min(MOST_SIZE, shape.referenceHeight);
			const radius = (t * shape.endRadius) / 100;
			return {
				x: Math.cos(angle) * radius * Math.min(MOST_SIZE, size * 1.3) * shape.horizontal * scale,
				y:
					Math.sin(angle) *
					radius *
					Math.min(shape.referenceHeight, size * 1.55) *
					shape.vertical *
					scale
			};
		}

		function draw() {
			items.length = copies;
			const scale = shrink(width, height, shape);
			const period = Math.max(1, copies / shape.count);
			const length = extent(width, height, shape);
			const end = length <= 1 ? length : reach(period);

			items.forEach((item, index) => {
				if (!item) return;
				const along = reach(wrap(progress + index / shape.count, period));
				if (along >= end) {
					item.style.opacity = '0';
					return;
				}
				const { x, y } = point(along, end, scale);
				const size =
					scale *
					mix(shape.min, shape.max, random(index, 3)) *
					mix(shape.startScale, shape.endScale, clamp(along));
				const margin = shape.base * size * Math.SQRT1_2 + 2;
				const shown = Math.abs(x) <= width / 2 + margin && Math.abs(y) <= height / 2 + margin;
				item.style.visibility = shown ? 'visible' : 'hidden';
				if (!shown) return;
				// Each picture leans along the path, the way it is travelling.
				const before = point(Math.max(0, along - 0.0015), end, scale);
				const after = point(Math.min(end, along + 0.0015), end, scale);
				const lean = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
				item.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%) rotate(${lean}deg) scale(${size})`;
				item.style.opacity = String(smooth(along / FADE) * smooth((end - along) / FADE));
			});
		}

		function tick(now: number) {
			const elapsed = last ? Math.min(64, now - last) : 16.67;
			last = now;
			// The stream runs inward, into the button.
			progress -= elapsed * DRIFT_PER_MS;
			const spent = stirring * (1 - Math.pow(1 - SETTLE, elapsed / 16.67));
			progress += spent;
			stirring -= spent;
			// Off screen the stream keeps flowing; it just isn't drawn.
			if (visible) draw();
			frame = requestAnimationFrame(tick);
		}

		/* Turning the pointer around the centre turns the spiral the same way. */
		function stir(event: PointerEvent) {
			const bounds = section.getBoundingClientRect();
			const dx = event.clientX - bounds.left - bounds.width / 2;
			const dy = event.clientY - bounds.top - bounds.height / 2;
			// Near the centre the angle swings wildly for tiny movements.
			if (Math.hypot(dx, dy) < 48) {
				lastAngle = null;
				return;
			}
			const angle = Math.atan2(dy, dx);
			if (lastAngle !== null) {
				const turn = wrap(angle - lastAngle + Math.PI, Math.PI * 2) - Math.PI;
				stirring += (turn / (shape.turns * Math.PI * 2)) * STIR;
			}
			lastAngle = angle;
		}

		function forget() {
			lastAngle = null;
		}

		const size = new ResizeObserver(() => {
			measure();
			// Wait a frame so any new pictures exist before placing them.
			requestAnimationFrame(draw);
		});
		const seen = new IntersectionObserver(
			([entry]) => {
				visible = entry?.isIntersecting ?? true;
			},
			{ rootMargin: '300px 0px' }
		);

		measure();
		size.observe(section);
		seen.observe(section);
		frame = requestAnimationFrame(tick);
		section.addEventListener('pointermove', stir);
		section.addEventListener('pointerleave', forget);
		section.addEventListener('pointercancel', forget);
		return () => {
			cancelAnimationFrame(frame);
			size.disconnect();
			seen.disconnect();
			section.removeEventListener('pointermove', stir);
			section.removeEventListener('pointerleave', forget);
			section.removeEventListener('pointercancel', forget);
		};
	});
</script>

<section class="spiral" aria-label="Find your spot" bind:this={section}>
	<div class="layer" aria-hidden="true">
		{#each { length: copies }, index (index)}
			<div class="item" bind:this={items[index]}>
				<img
					class="picture"
					src={PICTURES[index % PICTURES.length]}
					alt=""
					loading="lazy"
					decoding="async"
					draggable="false"
				/>
			</div>
		{/each}
	</div>

	<div class="centre">
		<a class="button" href="{resolve('/')}?view=map">Find your spot</a>
		<p>Your study group<br />will thank you</p>
	</div>
</section>

<style>
	.spiral {
		position: relative;
		overflow: hidden;
		/* The whole screen below the header, so the card before is fully covered. */
		height: max(700px, calc(100svh - 80px));
		background: #f8f6f1;
		color: #111;
		/* Sideways swipes stir the pictures; up and down still scroll the page. */
		touch-action: pan-y;
	}

	.layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	/*
		The pictures dissolve into the paper towards the bottom edge, so the
		section runs into the clouds below without a line where it is cut off.
	*/
	.spiral::after {
		position: absolute;
		z-index: 1;
		right: 0;
		bottom: 0;
		left: 0;
		height: 240px;
		background: linear-gradient(
			180deg,
			rgb(248 246 241 / 0%),
			rgb(248 246 241 / 85%) 55%,
			#f8f6f1 80%
		);
		content: '';
		pointer-events: none;
	}

	.item {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 39px;
		height: 39px;
		opacity: 0;
		visibility: hidden;
		pointer-events: auto;
		will-change: transform, opacity;
	}

	.item:hover {
		z-index: 1;
	}

	.picture {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition:
			transform 0.45s cubic-bezier(0.23, 1, 0.32, 1),
			box-shadow 0.45s cubic-bezier(0.23, 1, 0.32, 1);
		user-select: none;
	}

	/* A picture under the pointer lifts out of the stream and straightens. */
	.item:hover .picture {
		box-shadow: 0 6px 18px rgb(0 0 0 / 30%);
		transform: scale(1.6);
	}

	.centre {
		position: absolute;
		z-index: 2;
		top: 50%;
		left: 50%;
		display: grid;
		justify-items: center;
		gap: 22px;
		transform: translate(-50%, -50%);
		text-align: center;
	}

	.button {
		padding: 30px 56px;
		border-radius: 111px;
		background: #111;
		color: #fff;
		font-size: 48px;
		font-weight: 900;
		letter-spacing: -0.04em;
		line-height: 1;
		text-transform: uppercase;
		white-space: nowrap;
		transition: transform 0.3s cubic-bezier(0.23, 1, 0.32, 1);
	}

	.button:hover {
		transform: scale(1.04);
	}

	.button:focus-visible {
		outline: 3px solid #111;
		outline-offset: 4px;
	}

	/* A backing, so the line reads wherever the stream happens to be. */
	.centre p {
		margin: 0;
		padding: 6px 14px;
		border-radius: 14px;
		background: rgb(248 246 241 / 85%);
		color: #555;
		font-size: 17px;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}

	@media (max-width: 809px) {
		.spiral {
			height: max(640px, calc(100svh - 72px));
		}

		.item {
			width: 37px;
			height: 37px;
		}

		.button {
			padding: 22px 36px;
			font-size: 32px;
		}
	}
</style>
