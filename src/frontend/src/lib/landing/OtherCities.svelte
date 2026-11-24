<script lang="ts">
	import { resolve } from '$app/paths';
	import LocomotiveList, { splitName, type Row } from './LocomotiveList.svelte';

	type City = { name: string; photo: string };

	// Partiful's other cities. StudySpot maps none of them yet, and says so:
	// every row leads to the Board, where people can ask for their city. The
	// photos are public domain and come from Wikimedia Commons' file API.
	const CITIES: readonly City[] = [
		{
			name: 'Los Angeles',
			photo: 'Palm lined street in Los Angeles, California LCCN2013632428.tif'
		},
		{
			name: 'San Francisco',
			photo: 'Golden Gate Bridge, San Francisco, California LCCN2013633353.tif'
		},
		{
			name: 'Chicago',
			photo: 'Skyline and lakefront, Chicago, Illinois LCCN2011631067.tif'
		}
	];

	const board = resolve('/board');

	function photoUrl(file: string): string {
		return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=500`;
	}

	function row(city: City): Row {
		return {
			key: city.name,
			href: board,
			name: `Ask for ${city.name} on the Board`,
			...splitName(city.name),
			image: photoUrl(city.photo)
		};
	}

	const everywhere: Row = {
		key: 'everywhere',
		href: board,
		name: 'Ask for your city on the Board',
		before: 'Everywhere',
		after: '',
		image: photoUrl('The Earth seen from Apollo 17.jpg')
	};
</script>

<section class="cities" aria-labelledby="cities-title">
	<div class="intro">
		<h2 id="cities-title">Not in New York?</h2>
		<p>
			StudySpot only maps New York City for now. If you want your city next, ask for it on the
			Board.
		</p>
	</div>

	<LocomotiveList items={CITIES} {row} cta={everywhere} />
</section>

<style>
	.cities {
		--ink: #000;
		min-height: 100vh;
		min-height: 100svh;
		padding: clamp(80px, 10vw, 140px) 40px;
		background: #fff;
		color: #000;
	}

	.intro {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px 40px;
		margin-bottom: 7px;
		font-size: 26px;
		line-height: 1.2;
	}

	h2 {
		margin: 0;
		font-size: inherit;
		font-weight: 400;
	}

	.intro p {
		max-width: 22em;
		margin: 0;
	}

	@media (max-width: 1024px) {
		.cities {
			padding-inline: 20px;
		}
	}

	@media (max-width: 699px) {
		.intro {
			font-size: 18px;
		}
	}
</style>
