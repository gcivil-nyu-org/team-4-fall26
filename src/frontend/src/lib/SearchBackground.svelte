<script lang="ts">
	import { onMount } from 'svelte';
	import { createCanvasSearchBackgroundRenderer } from './search-background-canvas';
	import type { Point, Stroke } from './search-background-canvas';

	// A pointer over the opaque panel lights up the closest visible strip.
	function visiblePoint(x: number, y: number, panel: DOMRect, frame: DOMRect) {
		const left = panel.left - frame.left;
		const right = panel.right - frame.left;
		const top = panel.top - frame.top;
		const bottom = panel.bottom - frame.top;
		if (x <= left || x >= right || y <= top || y >= bottom) return { x, y };

		const nearest = Math.min(
			left > 0 ? x - left : Infinity,
			right < frame.width ? right - x : Infinity,
			top > 0 ? y - top : Infinity,
			bottom < frame.height ? bottom - y : Infinity
		);
		if (nearest === x - left) return { x: left - Math.min(45, left / 2), y };
		if (nearest === right - x) return { x: right + Math.min(45, (frame.width - right) / 2), y };
		if (nearest === y - top) return { x, y: top - Math.min(45, top / 2) };
		if (nearest === bottom - y) return { x, y: bottom + Math.min(45, (frame.height - bottom) / 2) };
		return { x, y };
	}


	let canvas: HTMLCanvasElement;
	let ready = $state(false);
	let playing = $state(true);
	let toggleMotion = $state<(() => void) | undefined>();

	onMount(() => {
		const searchPanel = canvas.parentElement?.querySelector('[data-search-panel]');
		const painter = createCanvasSearchBackgroundRenderer(canvas);
		if (!searchPanel || !painter) return;

		const panel = searchPanel;
		const renderer = painter;
		let pointer: { raw: Point; visible: Point } | undefined;
		let lastPointer: typeof pointer;
		let frame = 0;
		let lastDraw = 0;
		let time = 0;

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
			if (playing && !document.hidden) frame = requestAnimationFrame(tick);
		}

		function resize() {
			const { width, height } = canvas.getBoundingClientRect();
			renderer.resize(width, height, Math.min(devicePixelRatio || 1, 1.5));
			lastPointer = undefined;
			renderer.draw(time, 0);
		}

		function move(event: PointerEvent) {
			if (!playing || event.pointerType === 'touch') return;
			const bounds = canvas.getBoundingClientRect();
			const x = event.clientX - bounds.left;
			const y = event.clientY - bounds.top;
			const visible = visiblePoint(x, y, panel.getBoundingClientRect(), bounds);
			pointer = {
				raw: { x, y: bounds.height - y },
				visible: { x: visible.x, y: bounds.height - visible.y }
			};
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
		window.addEventListener('pointermove', move, { capture: true, passive: true });
		document.documentElement.addEventListener('pointerleave', leave);
		document.addEventListener('visibilitychange', syncAnimation);
		resize();
		syncAnimation();
		ready = true;

		return () => {
			cancelAnimationFrame(frame);
			size.disconnect();
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
		position: fixed;
		z-index: -1;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.motion-control {
		position: fixed;
		z-index: 1;
		right: max(12px, env(safe-area-inset-right));
		bottom: max(12px, env(safe-area-inset-bottom));
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
