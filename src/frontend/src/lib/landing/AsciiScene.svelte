<script lang="ts">
	import { onMount } from 'svelte';
	import { paintScene, type Mood } from './ascii-scene';

	let { mood, seed }: { mood: Mood; seed: number } = $props();

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const context = canvas.getContext('2d');
		if (!context) return;
		const scene = context;

		// Static artwork: painted once per size, never animated.
		function paint() {
			const { width, height } = canvas.getBoundingClientRect();
			if (!width || !height) return;
			const ratio = Math.min(devicePixelRatio || 1, 2);
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			scene.setTransform(ratio, 0, 0, ratio, 0, 0);
			paintScene(scene, width, height, mood, seed);
		}

		const size = new ResizeObserver(paint);
		size.observe(canvas);
		return () => size.disconnect();
	});
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
</style>
