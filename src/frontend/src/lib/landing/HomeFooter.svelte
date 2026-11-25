<script lang="ts">
	import { resolve } from '$app/paths';

	/*
		Poke's footer, measure for measure: four columns of links on warm paper,
		a bank of clouds rising out of the paper above them, a line saying where it was
		designed that opens the local weather, and a huge logo cut off by the
		bottom of the page.
	*/

	const REPOSITORY = 'https://github.com/gcivil-nyu-org/team-4-fall26';

	type Link = { label: string; href: string; external?: boolean };

	const COLUMNS: readonly { title: string; links: readonly Link[] }[] = [
		{
			title: 'Product',
			links: [
				{ label: 'Log in', href: resolve('/account') },
				{ label: 'Map', href: `${resolve('/')}?view=map` },
				{ label: 'Communities', href: resolve('/communities') },
				{ label: 'Board', href: resolve('/board') }
			]
		},
		{
			title: 'Resources',
			links: [
				{ label: 'Source code', href: REPOSITORY, external: true },
				{ label: 'Report a bug', href: `${REPOSITORY}/issues`, external: true },
				{ label: 'NYC Open Data', href: 'https://opendata.cityofnewyork.us', external: true }
			]
		},
		{
			title: 'Project',
			links: [
				{ label: 'About', href: `${REPOSITORY}#readme`, external: true },
				{ label: 'Team', href: `${REPOSITORY}/graphs/contributors`, external: true }
			]
		},
		{
			title: 'Legal',
			links: [{ label: 'Licence', href: `${REPOSITORY}/blob/develop/LICENSE`, external: true }]
		}
	];

	/*
		The clouds: three layers of cumulus at different depths. Each cloud is a
		cluster of puffs -- biggest in the middle, smaller at the shoulders --
		on a flat base, with a soft shadow under it. Every number comes from a
		fixed formula, so the sky is the same on every visit.
	*/
	type Puff = { x: number; y: number; r: number };
	type Cloud = { puffs: Puff[]; x: number; base: number; width: number };

	/** A repeatable number in [0, 1) for the nth draw of a given salt. */
	function noise(n: number, salt: number): number {
		const value = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
		return value - Math.floor(value);
	}

	function cumulus(x: number, base: number, width: number, salt: number): Cloud {
		const count = 5 + Math.floor(noise(1, salt) * 4);
		const puffs = Array.from({ length: count }, (_, i) => {
			const t = (i + 0.5) / count;
			// Tallest near the middle, a little off-centre so no two look alike.
			const lift = 1 - Math.abs(t - 0.42 - noise(2, salt) * 0.16) * 1.5;
			const r = width * (0.13 + 0.12 * Math.max(0.2, lift)) * (0.85 + noise(i + 3, salt) * 0.3);
			return { x: x - width / 2 + t * width, y: base - r * 0.55, r };
		});
		return { puffs, x, base, width };
	}

	/** A layer of clouds spread across the 1600-wide strip, edge to edge. */
	function layer(count: number, base: number, width: number, salt: number): Cloud[] {
		return Array.from({ length: count }, (_, i) => {
			const x = -60 + ((i + noise(i, salt) * 0.6) * 1720) / count;
			const size = width * (0.75 + noise(i + 7, salt) * 0.5);
			return cumulus(x, base + noise(i + 11, salt) * 14, size, salt * 31 + i);
		});
	}

	const FAR = layer(8, 118, 230, 1);
	const MIDDLE = layer(6, 178, 330, 2);
	const NEAR = layer(6, 246, 430, 3);
	/**
	 * Each layer is shaded by one gradient from its tops to its base, shared by
	 * every puff, so overlapping puffs merge into one body instead of reading
	 * as separate balls.
	 */
	const LAYERS = [
		{ name: 'far', clouds: FAR, top: 20, base: 130 },
		{ name: 'middle', clouds: MIDDLE, top: 50, base: 192 },
		{ name: 'near', clouds: NEAR, top: 80, base: 262 }
	] as const;

	const year = new Date().getFullYear();
</script>

<footer class="footer">
	<!-- A sky of clouds between the section above and the links. -->
	<svg
		class="clouds"
		viewBox="0 0 1600 300"
		preserveAspectRatio="xMidYMax slice"
		aria-hidden="true"
	>
		<defs>
			<!-- A pale sky behind them, clear where it meets the section above. -->
			<linearGradient id="cloud-sky" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0" stop-color="#e4eaee" stop-opacity="0" />
				<stop offset="0.35" stop-color="#e4eaee" stop-opacity="0.9" />
				<stop offset="0.7" stop-color="#ecede9" stop-opacity="0.9" />
				<stop offset="1" stop-color="#f8f6f1" stop-opacity="0" />
			</linearGradient>
			<!-- Sunlit white on top, warm grey underneath. -->
			{#each LAYERS as { name, top, base } (name)}
				<linearGradient
					id="cloud-body-{name}"
					gradientUnits="userSpaceOnUse"
					x1="0"
					x2="0"
					y1={top}
					y2={base}
				>
					<stop offset="0" stop-color="#ffffff" />
					<stop offset="0.45" stop-color="#fdfcf9" />
					<stop offset="0.8" stop-color={name === 'near' ? '#efebe3' : '#e6e0d5'} />
					<stop offset="1" stop-color={name === 'near' ? '#e4ddd1' : '#d2c9b9'} />
				</linearGradient>
			{/each}
			<radialGradient id="cloud-sun" cx="0.5" cy="0.5" r="0.5">
				<stop offset="0" stop-color="#ffe6bd" stop-opacity="0.85" />
				<stop offset="0.45" stop-color="#ffefd6" stop-opacity="0.45" />
				<stop offset="1" stop-color="#f8f6f1" stop-opacity="0" />
			</radialGradient>
			<!-- The paper rising through the near bank, so it melts into the footer. -->
			<linearGradient id="cloud-mist" x1="0" x2="0" y1="0" y2="1">
				<stop offset="0" stop-color="#f8f6f1" stop-opacity="0" />
				<stop offset="0.45" stop-color="#f8f6f1" stop-opacity="0.9" />
				<stop offset="1" stop-color="#f8f6f1" />
			</linearGradient>
			<filter id="cloud-soft" x="-20%" y="-40%" width="140%" height="180%">
				<feGaussianBlur stdDeviation="1.2" />
			</filter>
			<filter id="cloud-haze" x="-20%" y="-40%" width="140%" height="180%">
				<feGaussianBlur stdDeviation="3" />
			</filter>
			<filter id="cloud-shadow" x="-30%" y="-100%" width="160%" height="300%">
				<feGaussianBlur stdDeviation="10" />
			</filter>
		</defs>

		<rect x="-100" y="0" width="1800" height="300" fill="url(#cloud-sky)" />
		<circle class="sun" cx="1180" cy="110" r="190" fill="url(#cloud-sun)" />

		{#each LAYERS as { name, clouds } (name)}
			<g class="layer {name}" filter={name === 'far' ? 'url(#cloud-haze)' : 'url(#cloud-soft)'}>
				{#each clouds as cloud, i (i)}
					<ellipse
						class="shadow"
						cx={cloud.x}
						cy={cloud.base + 6}
						rx={cloud.width * 0.48}
						ry={cloud.width * 0.07}
						filter="url(#cloud-shadow)"
					/>
					{#each cloud.puffs as puff, j (j)}
						<circle cx={puff.x} cy={puff.y} r={puff.r} fill="url(#cloud-body-{name})" />
					{/each}
				{/each}
			</g>
		{/each}

		<rect class="mist" x="-100" y="175" width="1800" height="125" fill="url(#cloud-mist)" />
	</svg>

	<div class="inner">
		<nav class="columns" aria-label="Footer">
			{#each COLUMNS as column (column.title)}
				<div class="column">
					<p class="title">{column.title}</p>
					{#each column.links as link (link.label)}
						{#if link.external}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- another site -->
							<a href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
						{:else}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
							<a href={link.href}>{link.label}</a>
						{/if}
					{/each}
				</div>
			{/each}
		</nav>

		<p class="legal">
			<span>© {year}</span>
			<span class="rule" aria-hidden="true"></span>
			<a href="https://www.google.com/search?q=new+york+weather" target="_blank" rel="noreferrer"
				>Designed in New York, NY</a
			>
		</p>

		<p class="logo">
			<span class="wordmark">StudySpot</span>
		</p>
	</div>
</footer>

<style>
	.footer {
		position: relative;
		z-index: 1;
		/*
			Its own formatting context, so the clouds' negative bottom margin
			cannot leak out of the footer.
		*/
		display: flow-root;
		/* Warm paper, flat, so the clouds in the same colour melt into it. */
		background: #f8f6f1;
		color: #000;
	}

	/*
		Clouds instead of a gap, starting where the section above ends. Both
		are the same paper colour, so the join between them does not show.
	*/
	.clouds {
		display: block;
		width: 100%;
		height: 300px;
		margin-bottom: -50px;
		pointer-events: none;
	}

	.shadow {
		fill: #d8d0c2;
		opacity: 0.4;
	}

	/* Further away is paler, smaller-looking and slower: parallax as they drift. */
	.layer {
		animation: drift 70s ease-in-out infinite alternate;
	}

	.far {
		opacity: 0.6;
		animation-duration: 140s;
		animation-direction: alternate-reverse;
	}

	.middle {
		opacity: 0.85;
		animation-duration: 95s;
	}

	.near {
		animation-duration: 60s;
		animation-direction: alternate-reverse;
	}

	.sun {
		animation: glow 9s ease-in-out infinite alternate;
	}

	@keyframes drift {
		from {
			transform: translateX(-70px);
		}

		to {
			transform: translateX(70px);
		}
	}

	@keyframes glow {
		to {
			opacity: 0.7;
		}
	}

	.inner {
		/* Clips the big logo at the bottom; the footer itself must not, or the clouds would be cut. */
		overflow: hidden;
		width: min(1200px, 100%);
		margin: 0 auto;
		padding: 0 40px;
	}

	.columns {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		padding-top: 40px;
	}

	.column {
		display: grid;
		align-content: start;
		justify-items: start;
		gap: 20px;
	}

	.title,
	.column a,
	.legal {
		margin: 0;
		font-size: 15px;
		font-weight: 500;
		letter-spacing: -0.001em;
		line-height: 1;
	}

	.title {
		color: rgb(0 0 0 / 50%);
	}

	.column a {
		color: #000;
	}

	.column a:hover,
	.legal a:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.legal {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 56px;
		color: rgb(0 0 0 / 50%);
	}

	.legal a {
		color: inherit;
	}

	.rule {
		width: 2px;
		height: 12px;
		background: rgb(0 0 0 / 15%);
	}

	.column a:focus-visible,
	.legal a:focus-visible {
		border-radius: 2px;
		outline: 2px solid #000;
		outline-offset: 3px;
	}

	/* Huge, faded, and cut off by the bottom of the page. */
	.logo {
		margin: 64px 0 -0.28em;
		text-align: center;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(48px, 20vw, 250px);
		line-height: 1;
		white-space: nowrap;
		filter: drop-shadow(0 1px 0 rgb(255 255 255 / 90%));
	}

	.wordmark {
		background: linear-gradient(180deg, #a3a19c 15%, #c9c6bf 55%, rgb(244 241 234 / 0%) 95%);
		background-clip: text;
		color: transparent;
		letter-spacing: -0.02em;
	}

	@media (prefers-reduced-motion: reduce) {
		.layer,
		.sun {
			animation: none;
		}
	}

	@media (max-width: 760px) {
		.inner {
			padding: 0 32px;
		}

		.columns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			row-gap: 56px;
		}

		.logo {
			margin-top: 48px;
		}
	}
</style>
