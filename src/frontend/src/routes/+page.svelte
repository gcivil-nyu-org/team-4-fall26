<script lang="ts">
	// Aliased because `page` is a local name for a page of results throughout
	// this file, which is a different thing entirely.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as route } from '$app/state';
	import BestSeats from '$lib/landing/BestSeats.svelte';
	import CardStack from '$lib/landing/CardStack.svelte';
	import HomeFooter from '$lib/landing/HomeFooter.svelte';
	import IntroStatement from '$lib/landing/IntroStatement.svelte';
	import OtherCities from '$lib/landing/OtherCities.svelte';
	import SessionStages from '$lib/landing/SessionStages.svelte';
	import SpiralCta from '$lib/landing/SpiralCta.svelte';
	import VisionFeelings from '$lib/landing/VisionFeelings.svelte';
	import NearControl from '$lib/NearControl.svelte';
	import SearchBackground from '$lib/SearchBackground.svelte';
	import SearchBar from '$lib/SearchBar.svelte';
	import SiteHeader from '$lib/SiteHeader.svelte';
	import homeFonts from '$lib/fonts/home.css?raw';
	import SpotResults from '$lib/SpotResults.svelte';
	import SpotFiltersBar from '$lib/SpotFilters.svelte';
	import type LocomotiveScroll from 'locomotive-scroll';
	import 'locomotive-scroll/locomotive-scroll.css';
	import { onMount } from 'svelte';
	import {
		ApiError,
		DEFAULT_LIMIT,
		fetchFacets,
		listSpots,
		listSpotsNear,
		searchSpots
	} from '$lib/api';
	import type { Facets, Near, NearbySpot, SpotFilters, StudySpot } from '$lib/contract';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * The font cores to preload: only Inter's, which the hero sets. The others
	 * are first drawn several screens down; preloading them too (250 KB of
	 * Newsreader alone) made no measurable difference to LCP on desktop or on
	 * slow 3G, so it would only move bytes earlier for nothing.
	 */
	const HOME_FONT_CORES = ['/fonts/inter-core.woff2'] as const;

	onMount(() => {
		const motion = matchMedia('(prefers-reduced-motion: reduce)');
		let Scroll: typeof LocomotiveScroll | undefined;
		let scroll: LocomotiveScroll | undefined;
		let disposed = false;

		function update() {
			if (motion.matches) {
				scroll?.destroy();
				scroll = undefined;
			} else if (Scroll && !scroll) {
				scroll = new Scroll({
					lenisOptions: { lerp: 0.1, allowNestedScroll: true }
				});
			}
		}

		// Locomotive caches where its elements sit and only re-measures on a
		// window resize, but results arriving push everything below them down.
		const layout = new ResizeObserver(() => scroll?.resize());
		layout.observe(document.body);

		motion.addEventListener('change', update);
		void import('locomotive-scroll')
			.then(({ default: Constructor }) => {
				if (disposed) return;
				Scroll = Constructor;
				update();
			})
			.catch((error: unknown) => console.warn('Could not start smooth scrolling.', error));

		return () => {
			disposed = true;
			layout.disconnect();
			motion.removeEventListener('change', update);
			scroll?.destroy();
		};
	});

	type Status = 'idle' | 'searching' | 'loaded' | 'error';

	let status = $state<Status>('idle');
	let query = $state('');
	let spots = $state<(StudySpot | NearbySpot)[]>([]);
	let total = $state(0);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let errorMessage = $state('');

	let facets = $state<Facets | null>(null);
	let filters = $state<SpotFilters>({});

	/**
	 * Where results are ordered from, nearest first, or null for the usual order.
	 *
	 * Kept apart from `filters` because it narrows nothing: Clear filters leaves
	 * it alone, and only "Stop sorting by distance" or a search ends it. It and
	 * the search box exclude each other, because the ranked search orders by
	 * relevance and takes no point -- so setting one empties the other.
	 */
	let near = $state<Near | null>(null);

	/** Whether the filter menu is open. Closed, its controls still apply. */
	let filtersOpen = $state(false);
	/** How many filters are narrowing or ordering the results, for the menu's badge. */
	let activeFilters = $derived(
		Object.values(filters).filter((value) => value !== undefined && value !== '' && value !== false)
			.length + (near ? 1 : 0)
	);

	let wandering = $state(false);
	/** Why Wander found nowhere to go, in words for the reader. */
	let wanderNotice = $state('');

	/**
	 * Kagi's example searches under the box: each one runs a real search, and
	 * the tag before it says what kind -- a place, a borough, a filter.
	 */
	const SUGGESTIONS: readonly { tag: string; label: string; apply: () => void }[] = [
		{ tag: '@', label: 'Bryant Park', apply: () => handleSearch('Bryant Park') },
		{
			tag: 'in:',
			label: 'Libraries in Brooklyn',
			apply: () => {
				filters = { ...filters, borough: 'Brooklyn' };
				handleSearch('library');
			}
		},
		{
			tag: '#',
			label: 'Free Wi-Fi, nothing to buy',
			apply: () => handleFilters({ ...filters, free_public_wifi: true, no_purchase_needed: true })
		}
	];

	/**
	 * List or map.
	 *
	 * Held here rather than in `SpotResults` because the choice has to outlive
	 * a search: a reader who switched to the map and then typed a new query
	 * meant to see the new results on the map, not to be put back in a list.
	 */
	let view = $state<'list' | 'map'>('list');

	/**
	 * The query and filters the shown results came from.
	 *
	 * `query` is what the search box shows, which is not the same thing: the box
	 * can be typed in, or emptied, without being submitted. Paging has to repeat
	 * the request that produced the visible page, and the empty-state message has
	 * to name the query that actually found nothing, so both read this instead.
	 *
	 * `run()` records it when it issues a request rather than when one returns,
	 * which is sound because of the `latestSearch` guard below: only the most
	 * recently issued request is allowed to write results, so it is also the one
	 * that wrote this.
	 */
	let applied = $state<{ query: string; filters: SpotFilters; near: Near | null }>({
		query: '',
		filters: {},
		near: null
	});

	/** Who the distances on the cards are measured from, for their wording. */
	let distanceFrom = $derived(
		applied.near === null ? undefined : applied.near.kind === 'point' ? 'you' : applied.near.name
	);

	// The hero fills the viewport until there is something below it to see.
	let searched = $derived(status !== 'idle');

	/**
	 * Keep the filter controls describing the results on screen.
	 *
	 * The counts are promises about what picking a value returns, so they follow
	 * `applied` rather than being fetched once: counted over the whole snapshot
	 * they stop being true the moment anything is narrowing the results, and the
	 * controls go on offering values that now match nothing. The endpoint leaves
	 * each facet's own filter out, so a chosen borough still lists the other
	 * four.
	 *
	 * The cost is one extra request per interaction. Returning results and facets
	 * together would avoid it, which is what a dedicated search engine does in a
	 * single response; two requests is the price of keeping this in Postgres.
	 */
	let latestFacets = 0;

	$effect(() => {
		const snapshot = applied;
		const request = ++latestFacets;

		fetchFacets({ query: snapshot.query || undefined, filters: snapshot.filters })
			.then((loaded) => {
				if (request === latestFacets) facets = loaded;
			})
			// Deliberately keeps whatever is already there. Blanking the controls
			// because one refresh failed would take away the filters mid-use; stale
			// counts beside working controls are the better failure.
			.catch(() => {});
	});

	/**
	 * Each search is tagged so a slow earlier request cannot overwrite a faster
	 * later one. Typing a second query before the first returns is ordinary
	 * behaviour, and without this the results could end up showing the wrong one.
	 */
	let latestSearch = 0;

	/**
	 * How long to wait after a keystroke before searching.
	 *
	 * Long enough that an ordinary word is one request rather than five, short
	 * enough to feel like the results are following the typing.
	 *
	 * The matching is what makes a half-typed word worth sending at all:
	 * `search.py` treats the last word as a prefix, so `bob` reaches Bobst
	 * Library. Before that it reached "The Cafe at Bob" and nothing else.
	 */
	const TYPING_DELAY_MS = 250;

	let typingTimer: ReturnType<typeof setTimeout> | undefined;

	/** Search once the typing stops. */
	function runSoon(): void {
		clearTimeout(typingTimer);
		typingTimer = setTimeout(() => void run(), TYPING_DELAY_MS);
	}

	/** Search now, dropping a keystroke's pending search so it cannot land after. */
	function runNow(): void {
		clearTimeout(typingTimer);
		void run();
	}

	// Nothing should fire after the page is gone.
	$effect(() => () => clearTimeout(typingTimer));

	function describe(error: unknown): string {
		if (error instanceof ApiError) {
			// The database being unavailable is worth saying plainly; everything
			// else is reported in the API's own words.
			if (error.code === 'database_unavailable') {
				return 'The study-spot database is unavailable. Try again shortly.';
			}
			if (error.code === 'network_error') {
				return 'Could not reach StudySpot. Check your connection and try again.';
			}
			return error.message;
		}
		return 'Something went wrong while searching.';
	}

	/**
	 * Run whichever request the current query and filters call for.
	 *
	 * A query ranks; a point orders by distance; filters alone list. With none
	 * of them there is nothing to show, so the page returns to the state it
	 * loaded in rather than fetching everything.
	 */
	async function run(everything = false): Promise<void> {
		const search = ++latestSearch;
		const trimmed = query.trim();
		const filtering = Object.keys(filters).length > 0;

		applied = { query: trimmed, filters: { ...filters }, near };

		if (!trimmed && !filtering && near === null && !everything) {
			status = 'idle';
			spots = [];
			total = 0;
			hasMore = false;
			return;
		}

		status = 'searching';
		errorMessage = '';

		try {
			const page = trimmed
				? await searchSpots(trimmed, { limit: DEFAULT_LIMIT, filters })
				: near
					? await listSpotsNear(near, { limit: DEFAULT_LIMIT, filters })
					: await listSpots({ limit: DEFAULT_LIMIT, filters });
			if (search !== latestSearch) return;

			spots = page.items;
			total = page.pagination.total;
			hasMore = page.pagination.has_more;
			status = 'loaded';
		} catch (error) {
			if (search !== latestSearch) return;

			errorMessage = describe(error);
			spots = [];
			total = 0;
			hasMore = false;
			status = 'error';
		}
	}

	/**
	 * Typing searches, once it pauses.
	 *
	 * Submitting is still meaningful: it searches immediately rather than waiting
	 * out the delay, and it is how someone who has cleared the box says so.
	 */
	function handleQueryInput(next: string): void {
		query = next;
		if (next.trim()) leaveNear();
		runSoon();
	}

	function handleSearch(submitted: string): void {
		query = submitted;
		if (submitted.trim()) leaveNear();
		runNow();
	}

	/** Stop ordering by distance. Leaves the request to the caller. */
	function leaveNear(): void {
		near = null;
	}

	/** Order by distance from `next`, which ends any search in the box. */
	function useNear(next: Near): void {
		query = '';
		near = next;
		runNow();
	}

	/**
	 * Wander: skip the list and go somewhere -- one spot, picked at random from
	 * whatever the box and the filters would find, the way a flâneur picks a
	 * street. Two requests, one to count the matches and one for the spot at
	 * a random offset, so every match is equally likely, not just page one.
	 */
	async function wander(): Promise<void> {
		if (wandering) return;
		wandering = true;
		wanderNotice = '';
		const text = query.trim();
		const find = (offset: number) => {
			const options = { limit: 1, offset, filters };
			return text ? searchSpots(text, options) : listSpots(options);
		};

		try {
			const first = await find(0);
			const { total } = first.pagination;
			const pick =
				total > 1 ? (await find(Math.floor(Math.random() * total))).items[0] : first.items[0];
			if (!pick) {
				wanderNotice = text
					? `Nothing matches ${text}. Try another word, or clear a filter.`
					: 'Nothing matches these filters. Clear one and try again.';
				return;
			}
			await goto(resolve(`/spots/${pick.id}` as '/'));
		} catch (error) {
			wanderNotice = describe(error);
		} finally {
			wandering = false;
		}
	}

	function handleNeighborhood(name: string): void {
		leaveNear();
		useNear({ kind: 'neighborhood', name });
	}

	function handleClearNear(): void {
		leaveNear();
		runNow();
	}

	function handleFilters(next: SpotFilters, typing = false): void {
		filters = next;

		// A select or a checkbox is a decision and lands at once. The campus
		// box is typed, so it waits the same beat the search box does --
		// otherwise every letter of "New York University" is a request.
		if (typing) runSoon();
		else runNow();
	}

	/** The results, so the Map tab can bring them into view. */
	let results = $state<HTMLDivElement | null>(null);

	/**
	 * The Map tab in the header.
	 *
	 * It has to lead somewhere on its own: switching the view with nothing
	 * searched would scroll to an empty page and look broken. `run()` returns
	 * to idle for an empty query on purpose, so browsing the whole city is
	 * asked for explicitly here rather than being what an empty box means.
	 */
	async function showMap(): Promise<void> {
		view = 'map';
		if (status === 'idle') await run(true);

		// Past the hero, which otherwise fills the screen on a fresh page.
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		results?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
	}

	/**
	 * `?view=map` opens the map, which is how the header's Map tab reaches it
	 * from the detail pages and from Communities.
	 *
	 * Read, never written: switching views with the toggle leaves the URL
	 * alone, so the back button goes back to wherever someone came from rather
	 * than stepping through every time they changed their mind.
	 */
	$effect(() => {
		if (route.url.searchParams.get('view') === 'map') void showMap();
	});

	async function handleShowMore(): Promise<void> {
		if (loadingMore) return;
		const search = latestSearch;
		loadingMore = true;

		try {
			// Deliberately `applied` and not the live controls: this continues the
			// page already on screen, which the box may since have been typed in.
			const options = { limit: DEFAULT_LIMIT, offset: spots.length, filters: applied.filters };
			const page = applied.query
				? await searchSpots(applied.query, options)
				: applied.near
					? await listSpotsNear(applied.near, options)
					: await listSpots(options);
			if (search !== latestSearch) return;

			spots = [...spots, ...page.items];
			hasMore = page.pagination.has_more;
		} catch (error) {
			if (search !== latestSearch) return;
			errorMessage = describe(error);
		} finally {
			loadingMore = false;
		}
	}
</script>

<svelte:head>
	<title>StudySpot</title>
	<!--
		The homepage's own fonts: Inter, Inter Tight and the pixel face, self-hosted and
		subset by fonts/subset.py (Newsreader and Instrument Serif are global, in
		layout.css). Inlined rather than imported so they leave with the page, as the
		Google Fonts stylesheet they replace did: the chat pages declare a different
		Inter, and the two must not meet. Inter's core is preloaded; the
		extended files load only when a page draws one of their characters.
	-->
	{#each HOME_FONT_CORES as href (href)}
		<link rel="preload" {href} as="font" type="font/woff2" crossorigin="anonymous" />
	{/each}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated CSS from the repo, not user input -->
	{@html `<style>${homeFonts}</style>`}
	<meta
		name="description"
		content="Discover cafés and other NYC third places where students can meet and study."
	/>
</svelte:head>

<div class="page">
	<!--
		`onMap` is what makes the header's Map tab a button here rather than a
		link home: the results it switches to the map are already on this page,
		and navigating would throw away the search that found them.
	-->
	<div class="home-nav">
		<SiteHeader onMap={showMap} />
	</div>

	<main>
		<div class="first-scene">
			<SearchBackground />
			<div class="search-stage" class:browsing={!searched}>
				<section class="hero" class:compact={searched} aria-labelledby="hero-title">
					<h1 id="hero-title">Find a place to study together.</h1>

					<div class="search-card">
						<SearchBar value={query} onInput={handleQueryInput} onSearch={handleSearch}>
							<button
								type="button"
								class="filters-toggle"
								aria-expanded={filtersOpen}
								aria-controls="search-filters"
								onclick={() => (filtersOpen = !filtersOpen)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true">
									<path d={filtersOpen ? 'M4 4l8 8M12 4l-8 8' : 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11'}
									></path>
								</svg>
								Filters
								{#if activeFilters}<span class="badge">{activeFilters}</span>{/if}
							</button>
						</SearchBar>

						<div id="search-filters" class="filter-menu" hidden={!filtersOpen}>
							<NearControl
								neighborhoods={data.neighborhoods}
								{near}
								onNeighborhood={handleNeighborhood}
								onClear={handleClearNear}
							/>
							<SpotFiltersBar {facets} {filters} onChange={handleFilters} />
						</div>

						<ul class="suggestions" aria-label="Try a search">
							{#each SUGGESTIONS as suggestion (suggestion.label)}
								<li>
									<button type="button" class="chip" onclick={suggestion.apply}>
										<span class="tag" aria-hidden="true">{suggestion.tag}</span>
										{suggestion.label}
										<svg viewBox="0 0 24 24" aria-hidden="true">
											<circle cx="11" cy="11" r="6.5"></circle>
											<path d="m16 16 4 4"></path>
										</svg>
									</button>
								</li>
							{/each}
							<li>
								<button
									type="button"
									class="chip wander"
									class:spinning={wandering}
									disabled={wandering}
									title="Take me somewhere: one spot, picked at random"
									onclick={() => void wander()}
								>
									<svg class="compass" viewBox="0 0 24 24" aria-hidden="true">
										<circle cx="12" cy="12" r="9"></circle>
										<path class="needle" d="M12 5.5 14.2 12 12 18.5 9.8 12Z"></path>
									</svg>
									{wandering ? 'Wandering…' : 'Wander'}
								</button>
							</li>
						</ul>
						{#if wanderNotice}
							<p class="wander-notice" role="alert">{wanderNotice}</p>
						{/if}
					</div>

					<p class="description">Free to use. No ads.</p>
				</section>

				<!-- aria-live so a screen reader hears the outcome without moving focus. -->
				<div aria-live="polite">
					{#if status === 'searching'}
						<p class="status">Searching…</p>
					{:else if status === 'error'}
						<p class="status error" role="alert">{errorMessage}</p>
					{:else if status === 'loaded' && spots.length === 0}
						<p class="status">
							{#if applied.query}
								No places match <strong>{applied.query}</strong>. Try a library, a campus, or a
								neighborhood, or clear a filter.
							{:else}
								No places match these filters.
							{/if}
						</p>
					{/if}
				</div>

				<!--
					Outside the live region, and kept on screen while the next search is
					in flight rather than replaced by "Searching…".

					Both for the map's sake. A MapLibre instance is not free to build,
					and unmounting the results between one query and the next would tear
					it down and raise it again on every search -- so the pins would
					blink out and re-frame each time someone finished typing a word. The
					results on screen are still the answer to the last query until the
					new one lands, which is also why the list reads better this way.

					Moving it out of the live region is the other half: a screen reader
					was being handed every card of every result set. The count line
					inside announces the outcome now, which is the part worth hearing.
				-->
				<div class:results-panel={spots.length > 0 && status !== 'error'} bind:this={results}>
					{#if spots.length > 0 && status !== 'error'}
						<SpotResults
							{spots}
							{total}
							{hasMore}
							{loadingMore}
							{view}
							{distanceFrom}
							onView={(next) => (view = next)}
							onShowMore={handleShowMore}
						/>
					{/if}
				</div>
			</div>
		</div>

		<CardStack cards={[intro, stages, vision, seats, cities, spiral]} />
		{#snippet intro()}<IntroStatement />{/snippet}
		{#snippet stages()}<SessionStages
				seats={data.bestSeats.find((group) => group.borough === 'Manhattan')?.seats ?? []}
			/>{/snippet}
		{#snippet vision()}<VisionFeelings />{/snippet}
		{#snippet seats()}<BestSeats boroughs={data.bestSeats} />{/snippet}
		{#snippet cities()}<OtherCities />{/snippet}
		{#snippet spiral()}<SpiralCta />{/snippet}
	</main>
	<HomeFooter />
</div>

<style>
	.page {
		--home-gutter: 24px;
		--home-header-height: 60px;
		/* The landing deck's cards pin just below the sticky header (read as px by script). */
		--deck-top: 68px;
		--site-header-text: #f7f8f8;
		--site-header-muted: #8a8f98;
		--site-header-hover: rgb(255 255 255 / 7%);
		--site-header-rule: rgb(255 255 255 / 10%);
		--site-header-cta: #e5e5e6;
		--site-header-cta-text: #08090a;
		--site-menu-bg: #0f1011;
		isolation: isolate;
		min-height: 100vh;
		min-height: 100dvh;
		background: #1d170d;
	}

	.home-nav {
		position: sticky;
		z-index: 10;
		top: 0;
		padding-inline: 20px;
		border-bottom: 1px solid rgb(255 255 255 / 8%);
		/* Linear's black, solid, so the bar reads the same over light and dark sections. */
		background: #08090a;
	}

	.first-scene {
		position: relative;
	}

	.search-stage {
		display: flow-root;
		width: min(1180px, calc(100% - 2 * var(--home-gutter)));
		margin: 0 auto;
		padding-bottom: var(--home-gutter);
	}

	.search-stage.browsing {
		min-height: calc(100vh - var(--home-header-height));
		min-height: calc(100svh - var(--home-header-height));
	}

	/*
		Linear's palette: near-black surfaces a step apart, hairline borders of
		white at low opacity, grey text in three strengths, and indigo for the
		one thing to press. The search components read these tokens.
	*/
	.hero {
		--ln-panel: #0f1011;
		--ln-surface: #141516;
		--ln-raised: #1c1d1f;
		--ln-border: rgb(255 255 255 / 8%);
		--ln-text: #f7f8f8;
		--ln-muted: #8a8f98;
		--ln-faint: #62666d;
		--ln-brand: #5e6ad2;
		--ln-brand-hover: #7170ff;
		position: relative;
		display: flex;
		width: min(820px, 100%);
		min-height: calc(100svh - var(--home-header-height) - 48px);
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 36px;
		margin: 0 auto;
		padding: 48px 0;
		isolation: isolate;
		color: var(--ln-text);
		text-align: center;
		transition: min-height 240ms ease;
	}

	/*
		No card: the search sits straight on the background, with a soft pool
		of dark behind it so the words read over the brightest part.
	*/
	.hero::before {
		position: absolute;
		z-index: -1;
		background: radial-gradient(
			closest-side,
			rgb(8 9 10 / 92%),
			rgb(8 9 10 / 70%) 55%,
			rgb(8 9 10 / 0%)
		);
		content: '';
		inset: -4% -18%;
		pointer-events: none;
	}

	/* Once results exist, the hero stops owning the whole viewport. */
	.hero.compact {
		min-height: 0;
		gap: 24px;
		padding: 32px 0;
	}

	.hero.compact h1 {
		font-size: clamp(2rem, 4vw, 3rem);
	}

	.hero.compact .description {
		display: none;
	}

	.search-card {
		display: grid;
		width: 100%;
		gap: 18px;
		text-align: left;
	}

	.filters-toggle {
		display: inline-flex;
		height: 36px;
		flex: none;
		align-items: center;
		gap: 7px;
		padding: 0 12px;
		border: 0;
		border-left: 1px solid var(--ln-border);
		border-radius: 0;
		background: transparent;
		color: var(--ln-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.filters-toggle:hover,
	.filters-toggle[aria-expanded='true'] {
		color: var(--ln-text);
	}

	.filters-toggle:focus-visible,
	.chip:focus-visible {
		outline: 2px solid var(--ln-brand-hover);
		outline-offset: 2px;
	}

	.filters-toggle svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-width: 1.5;
	}

	.badge {
		display: inline-grid;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--ln-brand);
		color: #fff;
		font-size: 11px;
		place-items: center;
	}

	.filter-menu {
		display: grid;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--ln-border);
		border-radius: 16px;
		background: rgb(15 16 17 / 92%);
		backdrop-filter: blur(12px);
	}

	.filter-menu[hidden] {
		display: none;
	}

	/* Kagi's example searches: quiet chips, a coloured tag, a small lens. */
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chip {
		display: inline-flex;
		min-height: 36px;
		align-items: center;
		gap: 6px;
		padding: 0 12px;
		border: 1px solid var(--ln-border);
		border-radius: 8px;
		background: rgb(20 21 22 / 80%);
		color: var(--ln-text);
		font-size: 14px;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}

	.chip:hover {
		border-color: rgb(255 255 255 / 16%);
		background: var(--ln-raised);
	}

	.tag {
		color: var(--ln-brand-hover);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 13px;
	}

	.chip svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--ln-muted);
		stroke-linecap: round;
		stroke-width: 1.8;
	}

	/* Wander: a compass whose needle swings round while it picks. */
	.wander {
		border-color: rgb(113 112 255 / 35%);
		background: rgb(94 106 210 / 14%);
	}

	.wander .compass {
		width: 17px;
		height: 17px;
		stroke: var(--ln-brand-hover);
	}

	.wander .needle {
		fill: var(--ln-brand-hover);
		stroke: none;
		transform-origin: 12px 12px;
		transition: transform 500ms cubic-bezier(0.23, 1, 0.32, 1);
	}

	.wander:hover .needle {
		transform: rotate(35deg);
	}

	.wander.spinning .needle {
		animation: swing 0.9s linear infinite;
	}

	.wander:disabled {
		cursor: progress;
	}

	@keyframes swing {
		to {
			transform: rotate(360deg);
		}
	}

	.wander-notice {
		margin: 0;
		color: #eb5757;
		font-size: 13px;
		text-align: center;
	}

	h1 {
		max-width: 12em;
		/*
			The gradient is clipped to the text's box, and at line-height 1 the
			descenders (the g of "together") hang below it -- so the box gets
			room for them, and the margin gives that room back.
		*/
		margin: 0 0 calc(20px - 0.14em);
		padding-bottom: 0.14em;
		background: linear-gradient(180deg, #f7f8f8 30%, rgb(247 248 248 / 55%));
		background-clip: text;
		color: transparent;
		font-size: clamp(3rem, 6.5vw, 5.25rem);
		font-weight: 600;
		letter-spacing: -0.05em;
		line-height: 1;
		transition: font-size 240ms ease;
	}

	.description {
		margin: 0;
		color: var(--ln-faint);
		font-size: 14px;
	}

	.status {
		width: min(800px, 100%);
		margin: 28px auto 0;
		padding: 24px;
		border: 1px solid var(--color-border);
		border-radius: 20px;
		color: var(--color-muted);
		background: #fff;
		font-size: 15px;
		text-align: center;
	}

	.status.error {
		color: var(--color-brand-hover);
		font-weight: 600;
	}

	.status strong {
		color: var(--color-text);
	}

	.results-panel {
		margin-top: 28px;
		padding: 0 clamp(12px, 3vw, 36px);
		border-radius: 24px;
		background: #f7f1eb;
	}

	@media (max-width: 740px) {
		.page {
			--home-header-height: 56px;
			--deck-top: 64px;
		}
	}

	@media (max-width: 560px) {
		.page {
			--home-gutter: 12px;
		}

		.hero {
			width: calc(100% - 16px);
			min-height: calc(100vh - 172px);
			gap: 28px;
			padding: 28px 10px;
			border-radius: 18px;
		}

		.hero.compact {
			padding: 22px 10px;
		}

		h1 {
			font-size: clamp(2.5rem, 12vw, 3.5rem);
		}

		.description {
			margin-top: 18px;
			font-size: 15px;
		}

		.search-card {
			padding: 6px;
			border-radius: 20px;
		}
	}
</style>
