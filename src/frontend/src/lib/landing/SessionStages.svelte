<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { listSpotsNear, searchSpots } from '$lib/api';
	import { mapsUrl } from '$lib/maps';
	import { orderByTrunk, routeColour, routeTextColour, walkMinutes } from '$lib/subway';
	import { communityRequest, type Community } from '$lib/communities';
	import type { StudySpot } from '$lib/contract';
	import { place, readableCategory } from '$lib/spot';
	import PhoneMap from './PhoneMap.svelte';
	import type { Seat } from '$lib/server/snapshot';
	import { session } from '$lib/session.svelte';

	/** Real spots to read and write reviews for: the page's best seats. */
	let { seats }: { seats: readonly Seat[] } = $props();

	type FeatureId = 'communities' | 'map' | 'reviews';
	type Feature = {
		id: FeatureId;
		tab: string;
		/** Two lines, set in capitals, as Partiful sets theirs. */
		headline: [string, string];
		lead: string;
		body: string;
		cta: string;
		/** Already resolved. */
		href: string;
	};

	const mapHref = `${resolve('/')}?view=map`;

	const features: readonly Feature[] = [
		{
			id: 'communities',
			tab: 'Groups',
			headline: ['Find your', 'study group'],
			lead: 'No more studying alone.',
			body: 'Search groups by school or course, open one, and say hi. No account needed: come in as a guest.',
			cta: 'Browse communities',
			href: resolve('/communities')
		},
		{
			id: 'map',
			tab: 'Map',
			headline: ['Every free seat,', 'mapped'],
			lead: 'Reading rooms, plazas, cafés.',
			body: 'Filter for Wi-Fi, nothing to buy, or indoor seating, and see what is a few minutes away.',
			cta: 'Open the map',
			href: mapHref
		},
		{
			id: 'reviews',
			tab: 'Reviews',
			headline: ['Rate where', 'you study'],
			lead: 'Know before you go.',
			body: 'Read what other students thought of a spot, and leave a rating of your own while you are there.',
			cta: 'Find a spot to rate',
			href: mapHref
		}
	];

	/*
		Partiful's "Text blast your guests": the section is a screen tall per
		feature, and the phone stays pinned in the middle while you scroll. The
		phone's screen and the words either side change at each feature; the
		phone itself is the real thing, working on live data.
	*/
	let section: HTMLElement;
	let active = $state(0);

	function travel() {
		return Math.max(1, section.offsetHeight - innerHeight);
	}

	/** The tab bar scrolls the page to its feature, so words and screen agree. */
	function show(index: number) {
		const top = section.getBoundingClientRect().top + scrollY;
		scrollTo({ top: top + (travel() * index) / (features.length - 1) + 1, behavior: 'smooth' });
	}

	onMount(() => {
		let frame = 0;
		function update() {
			frame = 0;
			const progress = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / travel()));
			active = Math.min(features.length - 1, Math.round(progress * (features.length - 1)));
		}
		function schedule() {
			if (!frame) frame = requestAnimationFrame(update);
		}
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		update();
		void findGroups('');
		void findSpots();
		if (seats[0]) void openSpot(seats[0].id);
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
		};
	});

	/* --- Communities: the real public groups, searchable. --- */

	let groupQuery = $state('');
	let groups = $state<Community[]>([]);
	let groupsState = $state<'loading' | 'ready' | 'error'>('loading');
	let groupSearch = 0;
	let groupTimer = 0;

	async function findGroups(query: string) {
		const search = ++groupSearch;
		groupsState = 'loading';
		try {
			const result = await communityRequest<{ items: Community[] }>(
				`/communities?q=${encodeURIComponent(query)}&offset=0`
			);
			if (search !== groupSearch) return;
			groups = result.items;
			groupsState = 'ready';
		} catch {
			if (search === groupSearch) groupsState = 'error';
		}
	}

	function typeGroups(value: string) {
		groupQuery = value;
		clearTimeout(groupTimer);
		groupTimer = window.setTimeout(() => void findGroups(value.trim()), 250);
	}

	const hue = (name: string) => [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;

	/* --- Map: real spots near Washington Square; a tapped pin opens a card. --- */

	const AROUND = { kind: 'point', latitude: 40.7308, longitude: -73.9973 } as const;

	let spots = $state<StudySpot[]>([]);
	let spotsState = $state<'loading' | 'ready' | 'error'>('loading');
	let picked = $state<StudySpot | null>(null);

	let spotQuery = $state('');
	let spotSearch = 0;
	let spotTimer = 0;

	/** Nearby spots when the box is empty; otherwise every spot that matches. */
	async function findSpots(query = '') {
		const search = ++spotSearch;
		spotsState = 'loading';
		picked = null;
		try {
			const page = query
				? await searchSpots(query, { limit: 40 })
				: await listSpotsNear(AROUND, { limit: 60 });
			if (search !== spotSearch) return;
			spots = page.items;
			spotsState = 'ready';
		} catch {
			if (search === spotSearch) spotsState = 'error';
		}
	}

	function typeSpots(value: string) {
		spotQuery = value;
		clearTimeout(spotTimer);
		spotTimer = window.setTimeout(() => void findSpots(value.trim()), 300);
	}

	/** What the picked spot offers, in words for its card. */
	function offers(spot: StudySpot): string[] {
		return [
			spot.free_public_wifi ? 'Wi-Fi' : '',
			spot.no_purchase_needed ? 'Free to sit' : '',
			spot.indoor_seating ? 'Indoors' : '',
			spot.subway_step_free === 'full' ? 'Step-free' : ''
		].filter(Boolean);
	}

	/* --- Reviews: a real spot's reviews, and a real way to add one. --- */

	type Review = {
		id: number;
		author: string | null;
		rating: number;
		noise: number | null;
		wifi: number | null;
		outlets: number | null;
		body: string;
		created_at: string;
	};

	// Starts on the first seat rather than empty, so the prerendered "Open" link
	// already names a real page: an empty id renders `/spots/`, which does not
	// exist and fails the build's prerender crawl. Only the initial value is
	// wanted: after this, the reader's pick decides.
	// svelte-ignore state_referenced_locally
	let spotId = $state(seats[0]?.id ?? '');
	let reviews = $state<Review[]>([]);
	let reviewsState = $state<'loading' | 'ready' | 'error'>('loading');
	let reviewSearch = 0;

	const seat = $derived(seats.find((candidate) => candidate.id === spotId));
	const spotName = $derived(seat?.name ?? '');

	/*
		Until a spot has real reviews -- from StudySpot's students or from
		Google -- it shows a few samples, labelled as samples, so the screen
		shows what a review looks like. They are picked by the spot's id, so a
		spot always shows the same ones.
	*/
	const SAMPLES: readonly Omit<Review, 'id' | 'created_at'>[] = [
		{
			author: 'maya.k',
			rating: 5,
			noise: 5,
			wifi: 4,
			outlets: 4,
			body: 'Calm once the afternoon rush clears. Outlets along the window tables.'
		},
		{
			author: 'theo_r',
			rating: 4,
			noise: 4,
			wifi: 5,
			outlets: 2,
			body: 'Wi-Fi is fast. Get there before noon if you want a table to yourself.'
		},
		{
			author: 'priya',
			rating: 4,
			noise: 3,
			wifi: 4,
			outlets: 4,
			body: 'A bit of chatter by the entrance, but the back room is quiet.'
		},
		{
			author: 'jonah.s',
			rating: 5,
			noise: 5,
			wifi: 3,
			outlets: 5,
			body: 'Plenty of plugs and nobody minds you staying all afternoon.'
		},
		{
			author: 'lucia',
			rating: 3,
			noise: 2,
			wifi: 4,
			outlets: 3,
			body: 'Good for a group session, too lively for exam cramming.'
		},
		{
			author: 'sam_w',
			rating: 4,
			noise: 4,
			wifi: 4,
			outlets: 3,
			body: 'Bright, clean, and close to the train. My go-to between classes.'
		}
	];

	function samplesFor(id: string): Review[] {
		const start = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % SAMPLES.length;
		return [0, 1, 2].map((offset) => ({
			...SAMPLES[(start + offset * 2) % SAMPLES.length],
			id: -1 - offset,
			created_at: ''
		}));
	}

	type Attribution = { name: string; uri: string | null };
	type GooglePlace = {
		name: string;
		rating: number | null;
		rating_count: number;
		maps_uri: string | null;
		reviews: {
			author: Attribution;
			author_photo: string | null;
			rating: number;
			text: string;
			when: string;
		}[];
		photos: { uri: string; attributions: Attribution[] }[];
	};

	/** Google's page for the open spot: null when it has none, 'off' when unavailable. */
	let google = $state<GooglePlace | null | 'off' | 'loading'>('loading');

	const googleReviews = $derived(
		typeof google === 'object' && google !== null ? google.reviews.length : 0
	);
	const sample = $derived(reviewsState === 'ready' && reviews.length === 0 && googleReviews === 0);
	const shown = $derived(sample ? samplesFor(spotId) : reviews);
	const average = $derived(
		shown.length ? shown.reduce((sum, review) => sum + review.rating, 0) / shown.length : 0
	);

	/** How many reviews gave each number of stars, five first. */
	const breakdown = $derived(
		[5, 4, 3, 2, 1].map((stars) => ({
			stars,
			share: shown.length
				? shown.filter((review) => Math.round(review.rating) === stars).length / shown.length
				: 0
		}))
	);

	/** Google's reviews and StudySpot's, as one row of cards. */
	type Card = {
		key: string;
		author: string;
		photo: string | null;
		rating: number;
		text: string;
		when: string;
		tags: string[];
		from: 'google' | 'studyspot' | 'sample';
	};
	const cards = $derived<Card[]>([
		...(typeof google === 'object' && google !== null
			? google.reviews.map((review, i) => ({
					key: `g${i}`,
					author: review.author.name,
					photo: review.author_photo,
					rating: review.rating,
					text: review.text,
					when: review.when,
					tags: [],
					from: 'google' as const
				}))
			: []),
		...shown.map((review) => ({
			key: `s${review.id}`,
			author: review.author ?? 'A student',
			photo: null,
			rating: review.rating,
			text: review.body,
			when: review.created_at
				? new Date(review.created_at).toLocaleDateString('en-US', {
						month: 'short',
						day: 'numeric'
					})
				: '',
			tags: liked(review),
			from: sample ? ('sample' as const) : ('studyspot' as const)
		}))
	]);

	async function openGoogle(id: string, search: number) {
		google = 'loading';
		try {
			const response = await fetch(`/api/spots/${encodeURIComponent(id)}/google`, {
				headers: { accept: 'application/json' }
			});
			if (search !== reviewSearch) return;
			google = response.ok ? ((await response.json()) as GooglePlace | null) : 'off';
		} catch {
			if (search === reviewSearch) google = 'off';
		}
	}

	/** The open spot in full: its coordinates for the map, its address for directions. */
	let detail = $state<StudySpot | null>(null);

	async function openDetail(id: string, search: number) {
		try {
			const response = await fetch(`/api/spots/${encodeURIComponent(id)}`, {
				headers: { accept: 'application/json' }
			});
			const spot: StudySpot | null = response.ok ? await response.json() : null;
			if (search === reviewSearch) detail = spot;
		} catch {
			if (search === reviewSearch) detail = null;
		}
	}

	async function openSpot(id: string) {
		spotId = id;
		posted = '';
		postError = '';
		const search = ++reviewSearch;
		reviewsState = 'loading';
		void openGoogle(id, search);
		void openDetail(id, search);
		try {
			const response = await fetch(`/api/spots/${encodeURIComponent(id)}/reviews?limit=20`, {
				headers: { accept: 'application/json' }
			});
			if (!response.ok) throw new Error(String(response.status));
			const page: { items: Review[] } = await response.json();
			if (search !== reviewSearch) return;
			reviews = page.items;
			reviewsState = 'ready';
		} catch {
			if (search === reviewSearch) reviewsState = 'error';
		}
	}

	/** What a review says it liked, from its scores out of five. */
	function liked(review: Review): string[] {
		return [
			(review.noise ?? 0) >= 4 ? 'Quiet' : '',
			(review.wifi ?? 0) >= 4 ? 'Good Wi-Fi' : '',
			(review.outlets ?? 0) >= 4 ? 'Outlets' : ''
		].filter(Boolean);
	}

	let rating = $state(0);
	let hovering = $state(0);
	let note = $state('');
	let posting = $state(false);
	let posted = $state('');
	let postError = $state('');

	const student = $derived(
		session.status === 'signed-in' && session.account?.account_type === 'student'
	);

	async function postReview() {
		const scope = session.scope;
		if (!rating || !scope) return;
		posting = true;
		postError = '';
		try {
			const credentials = await session.credentialsFor(scope);
			const headers: Record<string, string> = {
				accept: 'application/json',
				'content-type': 'application/json',
				authorization: `Bearer ${credentials.access}`
			};
			if (credentials.id) headers['x-id-token'] = credentials.id;
			const response = await fetch(`/api/spots/${encodeURIComponent(spotId)}/reviews`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ rating, body: note.trim() })
			});
			if (!response.ok) {
				const result = await response.json().catch(() => null);
				throw new Error(result?.error?.message ?? `Could not post (${response.status}).`);
			}
			rating = 0;
			note = '';
			const done = spotName;
			await openSpot(spotId);
			posted = `Thanks! Your rating of ${done} is up.`;
		} catch (error) {
			postError = error instanceof Error ? error.message : 'Could not post your rating.';
		} finally {
			posting = false;
		}
	}

	const here = $derived(page.url.pathname + page.url.search);

	/** A five-pointed star centred on (x, y). */
	function star(x: number, y: number, r: number): string {
		return Array.from({ length: 10 }, (_, i) => {
			const a = ((i * 36 - 90) * Math.PI) / 180;
			const d = i % 2 ? r * 0.42 : r;
			return `${(x + Math.cos(a) * d).toFixed(2)},${(y + Math.sin(a) * d).toFixed(2)}`;
		}).join(' ');
	}
</script>

{#snippet stars(lit: number)}
	<svg class="stars" viewBox="0 0 90 16" aria-hidden="true">
		{#each [0, 1, 2, 3, 4] as i (i)}
			<polygon points={star(8 + i * 18, 8, 7.5)} class:lit={i < Math.round(lit)} />
		{/each}
	</svg>
{/snippet}

{#snippet communitiesScreen()}
	<input
		class="search"
		type="search"
		placeholder="Search by school or course"
		aria-label="Search communities"
		value={groupQuery}
		oninput={(event) => typeGroups(event.currentTarget.value)}
	/>
	{#if groupsState === 'error'}
		<p class="empty">Couldn't load communities. Try again in a moment.</p>
	{:else if groupsState === 'ready' && groups.length === 0}
		<p class="empty">No groups match "{groupQuery}". Start one on the Communities page.</p>
	{:else}
		<ul class="list scroll" aria-busy={groupsState === 'loading'}>
			{#each groups as group (group.id)}
				<li>
					<a data-sveltekit-reload href="{resolve('/communities')}?id={group.id}">
						<span class="avatar" style:--hue={hue(group.name)}>{group.name.charAt(0)}</span>
						<span class="row-text">
							<strong>{group.name}</strong>
							<small>{[group.school, group.course].filter(Boolean).join(' · ')}</small>
						</span>
						<svg class="chevron" viewBox="0 0 8 14" aria-hidden="true"
							><path d="M1 1l6 6-6 6" /></svg
						>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet mapScreen()}
	<div class="map">
		<input
			class="search map-search"
			type="search"
			placeholder="Search spots or neighborhoods"
			aria-label="Search the map"
			value={spotQuery}
			oninput={(event) => typeSpots(event.currentTarget.value)}
		/>
		{#if spotsState === 'error'}
			<p class="empty">Couldn't load the map's spots.</p>
		{:else}
			<PhoneMap {spots} picked={picked?.id ?? null} onPick={(spot) => (picked = spot)} />
		{/if}

		{#if picked}
			<!-- The tapped pin, as a card that sits inside the phone. -->
			<div class="spot-card">
				<button class="close" type="button" aria-label="Close" onclick={() => (picked = null)}
					>×</button
				>
				<small>{readableCategory(picked.category)} · {place(picked)}</small>
				<strong>{picked.name}</strong>
				{#if picked.subway_station}
					<small>{picked.subway_station} · {picked.subway_routes}</small>
				{/if}
				{#if offers(picked).length}
					<span class="tags"
						>{#each offers(picked) as tag (tag)}<i>{tag}</i>{/each}</span
					>
				{/if}
				<a class="open" data-sveltekit-reload href={resolve(`/spots/${picked.id}` as '/')}
					>Open spot</a
				>
			</div>
		{:else}
			<p class="map-note">
				{spotsState === 'loading'
					? 'Finding spots…'
					: spotQuery.trim()
						? spots.length
							? `${spots.length} match${spots.length === 1 ? '' : 'es'} · tap a pin`
							: `Nothing matches "${spotQuery.trim()}"`
						: `${spots.length} spots nearby · tap a pin`}
			</p>
		{/if}
	</div>
{/snippet}

{#snippet reviewsScreen()}
	<div class="scroll-area place">
		<!-- Which spot: the page's best seats, one tap each. -->
		<p class="picker">
			{#each seats as option (option.id)}
				<button
					type="button"
					class="chip"
					aria-pressed={option.id === spotId}
					onclick={() => void openSpot(option.id)}>{option.name}</button
				>
			{/each}
		</p>

		<!-- The header: Google's photos when there are some, else where it is. -->
		<div class="hero">
			{#if typeof google === 'object' && google !== null && google.photos.length}
				<div class="photos">
					{#each google.photos as photo, i (photo.uri)}
						<figure>
							<img src={photo.uri} alt="{spotName}, photo {i + 1}" loading="lazy" />
							{#if photo.attributions[0]}
								<figcaption>{photo.attributions[0].name}</figcaption>
							{/if}
						</figure>
					{/each}
				</div>
			{:else if detail}
				<PhoneMap spots={[detail]} picked={detail.id} onPick={() => {}} still />
			{/if}
		</div>

		<h4 class="place-name">{spotName}</h4>
		{#if seat}
			<p class="place-sub">
				{readableCategory(seat.category)} · {[seat.neighborhood, seat.borough]
					.filter(Boolean)
					.join(', ')}
			</p>
		{/if}

		<div class="actions">
			{#if detail}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Google Maps -->
				<a class="action primary" href={mapsUrl(detail)} target="_blank" rel="noreferrer"
					>Directions</a
				>
			{/if}
			<a class="action" data-sveltekit-reload href={resolve(`/spots/${spotId}` as '/')}>Open</a>
			<a class="action" href="#rate-{spotId}">Rate</a>
		</div>

		{#if seat}
			<div class="facts">
				<div>
					<small>Rating</small>
					<strong>{shown.length || googleReviews ? average.toFixed(1) : '–'} ★</strong>
				</div>
				<div>
					<small>Walk</small>
					<strong>{walkMinutes(seat.subway_metres)} min</strong>
				</div>
				<div>
					<small>{seat.subway_station}</small>
					<span class="bullets">
						{#each orderByTrunk(seat.subway_routes.split(' ')) as route (route)}
							<i style:background={routeColour(route)} style:color={routeTextColour(route)}
								>{route}</i
							>
						{/each}
					</span>
				</div>
			</div>
		{/if}

		<h5 class="section-head">
			Ratings &amp; Reviews
			{#if sample}<span class="badge">Samples</span>{/if}
		</h5>

		{#if reviewsState === 'loading'}
			<p class="empty">Loading reviews…</p>
		{:else if !cards.length}
			<p class="empty">No reviews yet. Be the first.</p>
		{:else}
			<div class="summary">
				<div class="big">
					<strong>{average.toFixed(1)}</strong>
					<small>out of 5</small>
				</div>
				<div class="bars">
					{#each breakdown as row (row.stars)}
						<span class="bar-row">
							<small>{'★'.repeat(row.stars)}</small>
							<span class="bar"><i style:width="{row.share * 100}%"></i></span>
						</span>
					{/each}
					<small class="total">
						{cards.length} rating{cards.length === 1 ? '' : 's'}
					</small>
				</div>
			</div>

			<div class="cards">
				{#each cards as card (card.key)}
					<article class="card">
						<header>
							{#if card.photo}
								<img class="avatar round" src={card.photo} alt="" />
							{:else}
								<span class="avatar round" style:--hue={hue(card.author)}
									>{card.author.charAt(0).toUpperCase()}</span
								>
							{/if}
							<span>
								<strong>{card.author}</strong>
								<small>{card.when}{card.from === 'google' ? ' · Google' : ''}</small>
							</span>
						</header>
						{@render stars(card.rating)}
						{#if card.text}<p>{card.text}</p>{/if}
						{#if card.tags.length}
							<span class="tags"
								>{#each card.tags as tag (tag)}<i>{tag}</i>{/each}</span
							>
						{/if}
					</article>
				{/each}
			</div>
			{#if sample}
				<p class="fine">
					Sample reviews. Real ones from students replace them as soon as there are any.
				</p>
			{/if}
		{/if}

		<form
			id="rate-{spotId}"
			class="rate"
			onsubmit={(event) => {
				event.preventDefault();
				void postReview();
			}}
		>
			<div class="rate-row">
				<small>Tap to rate</small>
				<div class="picker-stars" role="radiogroup" aria-label="Your rating">
					{#each [1, 2, 3, 4, 5] as value (value)}
						<button
							type="button"
							role="radio"
							aria-checked={rating === value}
							aria-label="{value} star{value === 1 ? '' : 's'}"
							class:lit={value <= (hovering || rating)}
							onpointerenter={() => (hovering = value)}
							onpointerleave={() => (hovering = 0)}
							onclick={() => (rating = value)}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><polygon points={star(8, 8.5, 7.5)} /></svg
							>
						</button>
					{/each}
				</div>
			</div>
			{#if rating}
				{#if student}
					<input
						class="search"
						placeholder="Quiet? Outlets? Say a line."
						aria-label="Your review"
						maxlength="500"
						bind:value={note}
					/>
					<button class="post" type="submit" disabled={posting}>
						{posting ? 'Posting…' : 'Post rating'}
					</button>
				{:else if session.status === 'signed-out'}
					<button class="post" type="button" onclick={() => session.logIn(here)}>
						Log in to post your rating
					</button>
				{:else}
					<p class="note">Ratings are posted from a student account.</p>
				{/if}
			{/if}
			{#if posted}<p class="note good">{posted}</p>{/if}
			{#if postError}<p class="note bad" role="alert">{postError}</p>{/if}
		</form>
	</div>
{/snippet}

<svelte:head>
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@900&family=Inter:wght@300;400;600;700&display=swap"
	/>
</svelte:head>

<section
	class="blast"
	aria-labelledby="blast-title"
	bind:this={section}
	style:--count={features.length}
>
	<h2 id="blast-title" class="visually-hidden">
		StudySpot helps you before, during and after your study sessions.
	</h2>

	<div class="stage">
		<div class="headlines">
			{#each features as feature, i (feature.id)}
				<h3 class:shown={i === active} inert={i !== active}>
					{feature.headline[0]}<br />{feature.headline[1]}
				</h3>
			{/each}
		</div>

		<div class="phone">
			<span class="island" aria-hidden="true"></span>
			<div class="glass">
				<!-- iOS's status bar: the time; signal, Wi-Fi and battery on the right. -->
				<p class="status" aria-hidden="true">
					<span class="time">9:41</span>
					<span class="indicators">
						<svg viewBox="0 0 18 12" class="signal"
							><rect x="0" y="8" width="3" height="4" rx="0.8" /><rect
								x="5"
								y="5.5"
								width="3"
								height="6.5"
								rx="0.8"
							/><rect x="10" y="3" width="3" height="9" rx="0.8" /><rect
								x="15"
								y="0"
								width="3"
								height="12"
								rx="0.8"
							/></svg
						>
						<svg viewBox="0 0 16 12" class="wifi"
							><path
								d="M8 2.6c2.4 0 4.6.9 6.2 2.5l1.2-1.3A10.4 10.4 0 0 0 8 .8 10.4 10.4 0 0 0 .6 3.8l1.2 1.3A8.7 8.7 0 0 1 8 2.6Z"
							/><path
								d="M8 6c1.5 0 2.8.6 3.8 1.5l1.2-1.3A7.1 7.1 0 0 0 8 4.2a7.1 7.1 0 0 0-5 2l1.2 1.3C5.2 6.6 6.5 6 8 6Z"
							/><path d="M8 9.3c.6 0 1.1.2 1.5.6L8 11.5 6.5 9.9c.4-.4.9-.6 1.5-.6Z" /></svg
						>
						<svg viewBox="0 0 27 13" class="battery"
							><rect
								x="0.5"
								y="0.5"
								width="23"
								height="12"
								rx="3.5"
								fill="none"
								stroke="currentColor"
								opacity="0.4"
							/><rect x="2" y="2" width="18" height="9" rx="2" /><path
								d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z"
								opacity="0.45"
							/></svg
						>
					</span>
				</p>
				<p class="screen-title">
					{features[active].tab === 'Groups' ? 'Communities' : features[active].tab}
				</p>
				{#each features as feature, i (feature.id)}
					<div class="screen" class:shown={i === active} inert={i !== active}>
						{#if feature.id === 'communities'}
							{@render communitiesScreen()}
						{:else if feature.id === 'map'}
							{@render mapScreen()}
						{:else}
							{@render reviewsScreen()}
						{/if}
					</div>
				{/each}
				<nav class="tabs" aria-label="Phone tabs">
					{#each features as feature, i (feature.id)}
						<button
							type="button"
							aria-current={i === active ? 'page' : undefined}
							onclick={() => show(i)}>{feature.tab}</button
						>
					{/each}
				</nav>
			</div>
		</div>

		<div class="details">
			{#each features as feature, i (feature.id)}
				<div class="detail" class:shown={i === active} inert={i !== active}>
					<p>{feature.lead}</p>
					<p>{feature.body}</p>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
					<a class="cta" data-sveltekit-reload href={feature.href}>{feature.cta} <span>→</span></a>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	/* A screen's height of scroll per feature; the stage stays pinned through it. */
	.blast {
		position: relative;
		height: calc(var(--count) * 100svh);
		background: #111;
		color: #fff;
		font-family: Inter, ui-sans-serif, sans-serif;
	}

	.stage {
		position: sticky;
		/* Pinned below the page's sticky header, when it has one. */
		top: var(--deck-top, 0px);
		display: grid;
		height: calc(100svh - var(--deck-top, 0px));
		align-items: center;
		grid-template-columns: 1fr auto 1fr;
		gap: clamp(24px, 4vw, 72px);
		padding: 0 clamp(20px, 7vw, 128px);
	}

	/* Each feature's words share one place; only the current one shows. */
	.headlines,
	.details {
		display: grid;
	}

	.headlines > *,
	.details > * {
		grid-area: 1 / 1;
		visibility: hidden;
	}

	.headlines > .shown,
	.details > .shown {
		visibility: visible;
	}

	/* Partiful's headline: a heavy display face, capitals, solid leading. */
	h3 {
		margin: 0;
		font-family: 'Inter Tight', Inter, sans-serif;
		font-size: 50px;
		font-weight: 900;
		letter-spacing: -0.035em;
		line-height: 1;
		text-transform: uppercase;
	}

	/* Partiful's text: light, a touch tight. */
	.detail {
		max-width: 300px;
		justify-self: start;
		color: #ececec;
		font-size: 18px;
		font-weight: 300;
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.detail p {
		margin: 0 0 22px;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		padding: 15px 24px;
		border-radius: 999px;
		background: #fff;
		color: #000;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 0;
	}

	.cta:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 3px;
	}

	/* The phone: a thin light bezel, a black rim, the island, and glass. */
	.phone {
		position: relative;
		height: min(740px, 86svh);
		aspect-ratio: 290 / 600;
		border: 3px solid #d9d9d9;
		border-radius: 54px;
		background: #000;
		box-shadow:
			0 0 0 1px #555,
			0 30px 80px rgb(0 0 0 / 60%);
	}

	.island {
		position: absolute;
		z-index: 10;
		top: 18px;
		left: 50%;
		width: 30%;
		height: 26px;
		border-radius: 999px;
		background: #000;
		transform: translateX(-50%);
	}

	.glass {
		position: absolute;
		display: flex;
		overflow: hidden;
		flex-direction: column;
		padding: 16px 14px 0;
		border-radius: 46px;
		background: linear-gradient(180deg, #e3f1f4, #c6e2ea);
		color: #111;
		font-size: 13px;
		inset: 7px;
	}

	/* iOS's status bar: the time either side of the island, icons on the right. */
	.status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0 10px 18px 22px;
		height: 22px;
	}

	.time {
		font-family: -apple-system, 'SF Pro Text', Inter, sans-serif;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.indicators {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.indicators svg {
		fill: currentColor;
	}

	.signal {
		width: 18px;
		height: 12px;
	}

	.wifi {
		width: 16px;
		height: 12px;
	}

	.battery {
		width: 26px;
		height: 13px;
	}

	.screen-title {
		margin: 0 0 12px;
		font-size: 14px;
		font-weight: 700;
		text-align: center;
	}

	/* Screens change outright; kept mounted, so the map is not rebuilt. */
	.screen {
		position: relative;
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		margin-bottom: 8px;
	}

	.screen:not(.shown) {
		position: absolute;
		visibility: hidden;
		inset: 0;
	}

	/* MapLibre sets its own controls visible, which would show through. */
	.screen:not(.shown) :global(*) {
		visibility: hidden !important;
	}

	.search {
		width: 100%;
		margin: 0 0 10px;
		padding: 10px 14px;
		border: 0;
		border-radius: 12px;
		background: rgb(255 255 255 / 80%);
		color: #111;
		font: inherit;
	}

	.search:focus-visible {
		outline: 2px solid #111;
	}

	.list {
		display: grid;
		gap: 1px;
		margin: 0;
		padding: 0;
		overflow: hidden auto;
		border-radius: 14px;
		background: rgb(17 17 17 / 6%);
		list-style: none;
		overscroll-behavior: contain;
	}

	.scroll {
		min-height: 0;
		flex: 1;
		align-content: start;
	}

	.list li,
	.list a {
		display: flex;
		align-items: center;
		gap: 10px;
		background: rgb(255 255 255 / 85%);
	}

	.list li {
		padding: 0;
	}

	.list a {
		width: 100%;
		padding: 11px 12px;
		color: inherit;
	}

	.list a:hover {
		background: #fff;
	}

	.avatar {
		display: grid;
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 10px;
		background: hsl(var(--hue) 60% 86%);
		color: hsl(var(--hue) 45% 30%);
		font-weight: 700;
		place-items: center;
	}

	.avatar.round {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-size: 12px;
	}

	.row-text {
		display: grid;
		min-width: 0;
		flex: 1;
		gap: 2px;
	}

	.row-text strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-text small {
		overflow: hidden;
		color: #5c6870;
		font-size: 11.5px;
		line-height: 1.35;
		text-overflow: ellipsis;
	}

	.chevron {
		width: 7px;
		height: 13px;
		flex: none;
		fill: none;
		stroke: #9aa5ad;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	.empty {
		margin: 8px 4px;
		color: #5c6870;
	}

	.chip {
		flex: none;
		padding: 6px 11px;
		border: 1px solid rgb(17 17 17 / 18%);
		border-radius: 999px;
		background: rgb(255 255 255 / 60%);
		color: #111;
		font: inherit;
		font-size: 11.5px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}

	.chip[aria-pressed='true'] {
		border-color: #111;
		background: #111;
		color: #fff;
	}

	.picker {
		display: flex;
		gap: 6px;
		margin: 0 0 10px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	/* The map fills the screen; the note and the spot card float over it. */
	.map {
		position: relative;
		overflow: hidden;
		min-height: 0;
		flex: 1;
		margin: 0 -14px -8px;
		background: #eef0ea;
	}

	/* The search box floats at the top of the map, like Maps' own. */
	.map-search {
		position: absolute;
		z-index: 3;
		top: 10px;
		right: 10px;
		left: 10px;
		width: auto;
		margin: 0;
		background: rgb(255 255 255 / 94%);
		box-shadow: 0 4px 14px rgb(0 0 0 / 14%);
	}

	.map-note,
	.spot-card {
		position: absolute;
		z-index: 3;
		right: 10px;
		bottom: 10px;
		left: 10px;
	}

	.map-note {
		margin: 0;
		padding: 8px 12px;
		border-radius: 12px;
		background: rgb(255 255 255 / 90%);
		color: #5c6870;
		font-size: 11.5px;
		text-align: center;
	}

	.spot-card {
		display: grid;
		gap: 4px;
		padding: 14px 14px 12px;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 10px 30px rgb(0 0 0 / 22%);
	}

	.spot-card strong {
		padding-right: 22px;
		font-size: 15px;
		line-height: 1.2;
	}

	.spot-card small {
		color: #5c6870;
		font-size: 11.5px;
	}

	.spot-card .close {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgb(17 17 17 / 7%);
		color: #111;
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
	}

	.spot-card .open {
		margin-top: 6px;
		padding: 9px;
		border-radius: 10px;
		background: #111;
		color: #fff;
		font-weight: 600;
		text-align: center;
	}

	/* The reviews scroll as one column above the rating form. */
	.scroll-area {
		min-height: 0;
		flex: 1;
		overflow: hidden auto;
		overscroll-behavior: contain;
		scrollbar-width: none;
	}

	.photos {
		display: flex;
		gap: 6px;
		margin: 0 0 12px;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
	}

	.photos figure {
		position: relative;
		flex: none;
		width: 78%;
		margin: 0;
		scroll-snap-align: start;
	}

	.photos img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		border-radius: 14px;
		object-fit: cover;
	}

	.photos figcaption {
		position: absolute;
		bottom: 6px;
		left: 8px;
		color: #fff;
		font-size: 9.5px;
		text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
	}

	img.avatar {
		object-fit: cover;
	}

	.stars {
		width: 72px;
		height: 13px;
	}

	.stars polygon {
		fill: rgb(17 17 17 / 14%);
	}

	.stars polygon.lit {
		fill: #f5a623;
	}

	.tags {
		display: flex;
		gap: 4px;
		margin-top: 4px;
	}

	.tags i {
		padding: 2px 8px;
		border-radius: 999px;
		background: rgb(17 17 17 / 7%);
		font-size: 10.5px;
		font-style: normal;
		font-weight: 600;
	}

	.rate {
		display: grid;
		gap: 8px;
		margin-top: 10px;
	}

	.rate .search {
		margin: 0;
	}

	.picker-stars {
		display: flex;
		justify-content: center;
		gap: 4px;
	}

	.picker-stars button {
		display: grid;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		place-items: center;
	}

	.picker-stars svg {
		width: 26px;
		height: 26px;
		fill: rgb(17 17 17 / 14%);
		transition: transform 120ms ease;
	}

	.picker-stars button.lit svg {
		fill: #f5a623;
	}

	.picker-stars button:hover svg {
		transform: scale(1.15);
	}

	.post {
		padding: 11px;
		border: 0;
		border-radius: 12px;
		background: #111;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.post:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.note {
		margin: 0;
		color: #5c6870;
		font-size: 11.5px;
		text-align: center;
	}

	.note.good {
		color: #1e7a3c;
	}

	.note.bad {
		color: #b3261e;
	}

	/* The app's tab bar, along the bottom of the glass. */
	.tabs {
		display: flex;
		justify-content: space-around;
		margin: 0 -14px;
		padding: 8px 10px 22px;
		border-top: 1px solid rgb(17 17 17 / 8%);
		background: rgb(255 255 255 / 55%);
	}

	.tabs button {
		padding: 6px 10px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: #5c6870;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.tabs button[aria-current='page'] {
		background: #111;
		color: #fff;
	}

	/* --- The place card: Apple Maps' layout, StudySpot's data. --- */

	.place {
		margin: 0 -14px;
		padding: 0 14px 12px;
	}

	.hero {
		position: relative;
		overflow: hidden;
		height: 150px;
		margin: 0 0 12px;
		border-radius: 16px;
		background: #e4ebe6;
	}

	.hero .photos {
		height: 100%;
		margin: 0;
	}

	.hero .photos figure {
		width: 100%;
	}

	.hero .photos img {
		height: 100%;
		aspect-ratio: auto;
		border-radius: 0;
	}

	.place-name {
		margin: 0;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}

	.place-sub {
		margin: 2px 0 12px;
		color: #5c6870;
		font-size: 12.5px;
	}

	.actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin-bottom: 12px;
	}

	.action {
		padding: 9px 6px;
		border-radius: 12px;
		background: rgb(255 255 255 / 80%);
		color: #0a66d8;
		font-size: 12.5px;
		font-weight: 600;
		text-align: center;
	}

	.action.primary {
		background: #0a66d8;
		color: #fff;
	}

	/* Three facts in a row, divided by hairlines, as Maps lays them out. */
	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr 1.4fr;
		margin-bottom: 18px;
		padding: 10px 0;
		border-top: 1px solid rgb(17 17 17 / 8%);
		border-bottom: 1px solid rgb(17 17 17 / 8%);
	}

	.facts > div {
		display: grid;
		gap: 3px;
		min-width: 0;
		padding: 0 8px;
		border-left: 1px solid rgb(17 17 17 / 8%);
	}

	.facts > div:first-child {
		padding-left: 0;
		border-left: 0;
	}

	.facts small {
		overflow: hidden;
		color: #5c6870;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.facts strong {
		font-size: 15px;
	}

	.bullets {
		display: flex;
		gap: 3px;
	}

	.bullets i {
		display: grid;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		font-size: 10px;
		font-style: normal;
		font-weight: 700;
		place-items: center;
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 10px;
		font-size: 16px;
		font-weight: 700;
	}

	.badge {
		padding: 2px 7px;
		border-radius: 999px;
		background: rgb(17 17 17 / 8%);
		color: #5c6870;
		font-size: 10px;
		font-weight: 600;
	}

	/* The score beside a five-to-one breakdown, App Store style. */
	.summary {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 12px;
	}

	.big {
		display: grid;
		justify-items: center;
	}

	.big strong {
		font-size: 44px;
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
	}

	.big small {
		color: #5c6870;
		font-size: 11px;
		font-weight: 600;
	}

	.bars {
		display: grid;
		flex: 1;
		gap: 2px;
	}

	.bar-row {
		display: grid;
		align-items: center;
		grid-template-columns: 44px 1fr;
		gap: 6px;
	}

	.bar-row small {
		color: #8a959c;
		font-size: 7.5px;
		letter-spacing: 0.5px;
		text-align: right;
	}

	.bar {
		overflow: hidden;
		height: 4px;
		border-radius: 999px;
		background: rgb(17 17 17 / 9%);
	}

	.bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #5c6870;
	}

	.total {
		color: #5c6870;
		font-size: 10.5px;
		text-align: right;
	}

	/* Reviews as cards you swipe through. */
	.cards {
		display: flex;
		margin-top: 2px;
		gap: 8px;
		margin: 0 -14px 8px;
		padding: 0 14px;
		overflow-x: auto;
		scroll-padding: 0 14px;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
	}

	.card {
		display: grid;
		flex: none;
		align-content: start;
		gap: 6px;
		width: 86%;
		padding: 12px;
		border-radius: 14px;
		background: rgb(255 255 255 / 88%);
		scroll-snap-align: start;
	}

	.card header {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.card header span {
		display: grid;
	}

	.card header small {
		color: #8a959c;
		font-size: 10.5px;
	}

	.card p {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		color: #2c3337;
		font-size: 12px;
		line-height: 1.4;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
	}

	.fine {
		margin: 0 0 12px;
		color: #8a959c;
		font-size: 10px;
	}

	.rate-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-radius: 14px;
		background: rgb(255 255 255 / 80%);
	}

	.rate-row small {
		color: #5c6870;
		font-size: 12px;
		font-weight: 600;
	}

	.rate-row .picker-stars button {
		width: 26px;
		height: 26px;
	}

	.rate-row .picker-stars svg {
		width: 20px;
		height: 20px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* Narrow screens: the headline above the phone, the words below it. */
	@media (max-width: 860px) {
		.stage {
			align-content: center;
			grid-template-columns: 1fr;
			grid-template-rows: auto auto auto;
			justify-items: center;
			gap: 18px;
			text-align: center;
		}

		h3 {
			font-size: 30px;
		}

		.phone {
			height: min(560px, 62svh);
		}

		.detail {
			justify-self: center;
			font-size: 15px;
		}

		.detail p:not(:first-child) {
			display: none;
		}

		.detail p:first-child {
			display: block;
			margin-bottom: 12px;
		}
	}
</style>
