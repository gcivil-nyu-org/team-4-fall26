<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
	import { boundsOf, type Bounds } from '$lib/bounds';
	import type { StudySpot } from '$lib/contract';

	/*
		The map inside the homepage's phone. The same basemap and tiles as the
		results map, but it fills whatever box it is given, and a tapped pin is
		handed to the caller -- which shows it in a card inside the phone --
		rather than opening a popup too wide for the screen.
	*/
	type Props = {
		spots: StudySpot[];
		picked: string | null;
		onPick: (spot: StudySpot | null) => void;
		/** A still picture of where the spots are: no panning, zooming or tapping. */
		still?: boolean;
	};

	let { spots, picked, onPick, still = false }: Props = $props();

	const TILES = '/tiles/nyc.pmtiles';
	const FALLBACK: Bounds = [
		[-74.01, 40.722],
		[-73.985, 40.74]
	];

	let canvas = $state<HTMLDivElement | null>(null);
	let ready = $state<{ maplibre: typeof import('maplibre-gl'); map: MapLibreMap } | null>(null);
	/** Each pin by its spot, to mark the picked one. Not state: only effects read it. */
	let pins: { id: string; pin: HTMLButtonElement }[] = [];

	$effect(() => {
		const element = canvas;
		if (element === null) return;
		const initial = untrack(() => boundsOf(spots));
		let cancelled = false;
		let map: MapLibreMap | null = null;
		let size: ResizeObserver | null = null;

		async function start() {
			const [maplibre, pmtiles] = await Promise.all([
				import('maplibre-gl'),
				import('pmtiles'),
				import('maplibre-gl/dist/maplibre-gl.css')
			]);
			const { basemapStyle } = await import('$lib/basemap');
			const workerUrl = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url');
			if (cancelled) return;
			maplibre.setWorkerUrl(workerUrl.default);
			maplibre.addProtocol('pmtiles', new pmtiles.Protocol().tile);

			const instance = new maplibre.Map({
				container: element!,
				style: basemapStyle(new URL(TILES, location.href).href),
				bounds: initial ?? FALLBACK,
				fitBoundsOptions: { padding: 40, maxZoom: 16 },
				attributionControl: { compact: true },
				pitchWithRotate: false,
				dragRotate: false,
				touchPitch: false,
				// The page scrolls past this phone: the wheel stays the page's.
				cooperativeGestures: !still,
				interactive: !still
			});
			map = instance;
			instance.touchZoomRotate.disableRotation();
			instance.on('click', () => onPick(null));
			// The phone changes size with the window; the map follows it.
			size = new ResizeObserver(() => instance.resize());
			size.observe(element!);
			ready = { maplibre, map: instance };
		}

		void start();
		return () => {
			cancelled = true;
			ready = null;
			size?.disconnect();
			map?.remove();
		};
	});

	$effect(() => {
		const current = spots;
		const loaded = ready;
		if (loaded === null) return;
		const { maplibre, map } = loaded;
		const markers: Marker[] = [];
		pins = [];

		for (const spot of current) {
			const pin = document.createElement('button');
			pin.type = 'button';
			pin.className = 'phone-pin';
			// MapLibre places a marker by setting its transform, so the dot that
			// grows on hover is a child: styling the marker itself would pin it
			// to the screen instead of the map.
			pin.append(document.createElement('span'));
			if (still) pin.tabIndex = -1;
			pin.setAttribute('aria-label', spot.name);
			pin.addEventListener('click', (event) => {
				event.stopPropagation();
				onPick(spot);
			});
			pins.push({ id: spot.id, pin });
			markers.push(
				new maplibre.Marker({ element: pin }).setLngLat([spot.longitude, spot.latitude]).addTo(map)
			);
		}
		const bounds = boundsOf(current);
		if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });

		return () => {
			for (const marker of markers) marker.remove();
		};
	});

	/* The picked pin stands out, and the map brings it into view. */
	$effect(() => {
		const id = picked;
		const loaded = ready;
		for (const { id: key, pin } of pins) pin.classList.toggle('picked', key === id);
		if (!id || !loaded) return;
		const spot = untrack(() => spots.find((candidate) => candidate.id === id));
		if (spot) loaded.map.easeTo({ center: [spot.longitude, spot.latitude], offset: [0, -60] });
	});
</script>

<div class="map" bind:this={canvas}></div>

<style>
	.map {
		position: absolute;
		inset: 0;
	}

	.map :global(.phone-pin) {
		display: grid;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		place-items: center;
	}

	.map :global(.phone-pin span) {
		width: 16px;
		height: 16px;
		border: 2px solid #fff;
		border-radius: 50%;
		background: #ff385c;
		box-shadow: 0 1px 4px rgb(0 0 0 / 35%);
		transition: transform 120ms ease;
	}

	.map :global(.phone-pin:hover span) {
		transform: scale(1.25);
	}

	.map :global(.phone-pin.picked) {
		z-index: 2;
	}

	.map :global(.phone-pin.picked span) {
		background: #111;
		transform: scale(1.5);
	}

	.map :global(.maplibregl-ctrl-attrib) {
		font-size: 9px;
	}
</style>
