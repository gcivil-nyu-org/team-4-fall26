<script lang="ts">
	import { onMount } from 'svelte';
	import { createCanvasSearchBackgroundRenderer } from './search-background-canvas';
	import type { Point, Stroke } from './search-background-canvas';

	let canvas: HTMLCanvasElement;
	let ready = $state(false);
	let playing = $state(true);
	let toggleMotion = $state<(() => void) | undefined>();

	onMount(() => {
		const painter = createCanvasSearchBackgroundRenderer(canvas);
		if (!painter) return;

		const renderer = painter;
		let pointer: { raw: Point; visible: Point } | undefined;
		let lastPointer: typeof pointer;
		let frame = 0;
		let lastDraw = 0;
		let time = 0;
		let inView = true;

		function draw(delta: number) {
			let stroke: Stroke | undefined;
			if (pointer && lastPointer) {
				const dx = pointer.raw.x - lastPointer.raw.x;
				const dy = pointer.raw.y - lastPointer.raw.y;
				const distance = Math.hypot(dx, dy);
				if (distance > 0) {
					const projectedDistance = Math.hypot(
						pointer.visible.x - lastPointer.visible.x,
						pointer.visible.y - lastPointer.visible.y
					);
					stroke = {
						from: projectedDistance < 180 ? lastPointer.visible : pointer.visible,
						to: pointer.visible,
						direction: { x: dx / distance, y: dy / distance },
						strength: Math.min(1, distance / 24 + 0.4)
					};
				}
			}
			lastPointer = pointer;
			renderer.draw(time, delta, stroke);
		}

		function tick(now: number) {
			const delta = now - lastDraw;
			if (!lastDraw || delta >= 1000 / 30 - 1) {
				const seconds = lastDraw ? Math.min(delta, 160) / 1000 : 0;
				lastDraw = now;
				time += seconds;
				draw(seconds);
			}
			frame = requestAnimationFrame(tick);
		}

		function syncAnimation() {
			cancelAnimationFrame(frame);
			frame = 0;
			lastDraw = 0;
			leave();
			renderer.clearWake();
			renderer.draw(time, 0);
			if (playing && inView && !document.hidden) frame = requestAnimationFrame(tick);
		}

		function resize() {
			const { width, height } = canvas.getBoundingClientRect();
			renderer.resize(width, height, Math.min(devicePixelRatio || 1, 1.5));
			lastPointer = undefined;
			renderer.draw(time, 0);
		}

		function move(event: PointerEvent) {
			if (!playing || !inView || event.pointerType === 'touch') return;
			const bounds = canvas.getBoundingClientRect();
			const x = event.clientX - bounds.left;
			const y = event.clientY - bounds.top;
			if (x < 0 || x > bounds.width || y < 0 || y > bounds.height) {
				leave();
				return;
			}
			// Nothing covers the background any more, so the wake follows the pointer.
			const point = { x, y: bounds.height - y };
			pointer = { raw: point, visible: point };
		}

		function leave() {
			pointer = undefined;
			lastPointer = undefined;
		}

		toggleMotion = () => {
			playing = !playing;
			syncAnimation();
		};
		const size = new ResizeObserver(resize);
		size.observe(canvas);
		const visibility = new IntersectionObserver(([entry]) => {
			inView = entry.isIntersecting;
			syncAnimation();
		});
		visibility.observe(canvas);
		window.addEventListener('pointermove', move, { capture: true, passive: true });
		document.documentElement.addEventListener('pointerleave', leave);
		document.addEventListener('visibilitychange', syncAnimation);
		// Still for anyone who asked for less motion: the first frame is drawn
		// and the button offers to play it.
		playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
		resize();
		syncAnimation();
		ready = true;

		return () => {
			cancelAnimationFrame(frame);
			size.disconnect();
			visibility.disconnect();
			window.removeEventListener('pointermove', move, true);
			document.documentElement.removeEventListener('pointerleave', leave);
			document.removeEventListener('visibilitychange', syncAnimation);
		};
	});
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>
{#if ready}
	<button class="motion-control" type="button" onclick={toggleMotion}>
		{playing ? 'Pause background' : 'Play background'}
	</button>
{/if}

<style>
	canvas {
		position: absolute;
		z-index: -1;
		top: calc(-1 * var(--home-header-height));
		left: 0;
		width: 100%;
		height: min(calc(100% + var(--home-header-height)), 100svh);
		pointer-events: none;
	}

	.motion-control {
		position: absolute;
		z-index: 1;
		top: calc(min(100%, 100svh - var(--home-header-height)) - 44px);
		right: max(12px, env(safe-area-inset-right));
		padding: 8px 13px;
		border: 1px solid #947961;
		border-radius: 999px;
		background: #1d170d;
		color: #fff8ed;
		font-size: 12px;
		cursor: pointer;
	}

	.motion-control:focus-visible {
		outline: 2px solid #fff8ed;
		outline-offset: 3px;
	}
</style>
