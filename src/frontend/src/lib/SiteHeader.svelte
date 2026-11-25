<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { displayName } from './accounts';
	import { session as shared, type Session } from './session.svelte';

	type Props = {
		/** Replaceable so a test can render the header in any state. */
		session?: Session;
		/**
		 * What the Map tab should do on a page that is already showing
		 * results. Given, the tab switches them to the map; left out, it is a
		 * link to the homepage's map view.
		 */
		onMap?: () => void;
	};

	let { session = shared, onMap }: Props = $props();
	const menuId = $props.id();
	let mobileMenu: HTMLDivElement;

	/** Back to this page after logging in, rather than to the homepage. */
	const here = $derived(page.url.pathname + page.url.search);
</script>

{#snippet destinations()}
	<a class="nav-link" data-sveltekit-reload href={resolve('/communities')}>Communities</a>
	<a class="nav-link" href={resolve('/board')}>Board</a>
	{#if onMap}
		<!--
				A button, because from here it goes nowhere: the results are on
				this page already and navigating would lose the search.
			-->
		<button
			class="nav-link"
			type="button"
			onclick={() => {
				mobileMenu?.hidePopover();
				onMap?.();
			}}>Map</button
		>
	{:else}
		<!--
				From anywhere else it is a real link home, and says in the URL
				what it is going there for -- which also makes the map view
				something that can be sent to someone.
			-->
		<a class="nav-link" href="{resolve('/')}?view=map">Map</a>
	{/if}
	<!-- Community messages are open to any signed-in account. -->
	{#if session.status === 'signed-in'}
		<a class="nav-link" href={resolve('/messages')}>Messages</a>
	{/if}
	<!--
			Both are for students alone: favourites are private to the account
			that saved them, and the directory lists students. A business
			account is shown neither.
		-->
	{#if session.status === 'signed-in' && session.account?.account_type === 'student'}
		<a class="nav-link" href={resolve('/favourites')}>Favourites</a>
		<a class="nav-link" href={resolve('/people')}>People</a>
	{/if}
	<!--
			Nothing until the session is known, so a prerendered "Log in" never
			flashes at someone who is already logged in. With accounts switched
			off (as in local development) both are still shown, and both lead to
			pages that say accounts are off rather than to a dead button.
		-->
	{#if session.status === 'signed-in' && session.account}
		<a class="sign-in account" href={resolve('/account')}>
			<span class="avatar" aria-hidden="true">
				{displayName(session.account).charAt(0).toUpperCase()}
			</span>
			<span class="name">{displayName(session.account)}</span>
		</a>
	{:else if session.status === 'signed-out' || session.status === 'disabled'}
		{#if session.status === 'disabled'}
			<a class="nav-link" href={resolve('/account')}>Log in</a>
		{:else}
			<button class="nav-link" type="button" onclick={() => session.logIn(here)}>Log in</button>
		{/if}
		<a class="sign-in" href={resolve(`/signup?returnTo=${encodeURIComponent(here)}`)}>Sign up</a>
	{/if}
{/snippet}

<header>
	<a class="brand" href={resolve('/')} aria-label="StudySpot home">StudySpot</a>
	<nav aria-label="Main navigation">
		<div class="wide-links">{@render destinations()}</div>
		<button class="menu-trigger" popovertarget={menuId} aria-label="Site navigation">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5h12M2 10.5h12"></path></svg>
		</button>
		<div id={menuId} bind:this={mobileMenu} popover="auto" class="compact-links">
			{@render destinations()}
		</div>
	</nav>
</header>

<style>
	/*
		Linear's bar: a wordmark on the left; small, quiet links on the right
		that light up in a pill on hover; then a light "Sign up" pill. Colours come from the page, so the same bar sits on
		dark and light pages alike.
	*/
	header {
		--bar-text: var(--site-header-text, var(--color-text));
		--bar-muted: var(--site-header-muted, #6b6f76);
		--bar-hover: var(--site-header-hover, rgb(0 0 0 / 5%));
		--bar-rule: var(--site-header-rule, rgb(0 0 0 / 10%));
		--bar-cta: var(--site-header-cta, #08090a);
		--bar-cta-text: var(--site-header-cta-text, #f7f8f8);
		display: flex;
		width: 100%;
		height: 60px;
		align-items: center;
		justify-content: space-between;
		margin: 0 auto;
		font-size: 13px;
	}

	.brand {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		padding: 0 8px;
		margin-left: -8px;
		border-radius: 6px;
		color: var(--site-brand-color, var(--bar-text));
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.03em;
	}

	nav,
	.wide-links {
		display: flex;
		align-items: center;
	}

	.nav-link,
	.sign-in {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		border: 0;
		border-radius: 9999px;
		background: transparent;
		color: var(--bar-muted);
		font: inherit;
		line-height: 1.5;
		cursor: pointer;
		transition:
			color 120ms ease,
			background-color 120ms ease;
	}

	.nav-link:hover {
		background: var(--bar-hover);
		color: var(--bar-text);
	}

	.sign-in {
		margin-left: 8px;
		background: var(--bar-cta);
		color: var(--bar-cta-text);
		font-weight: 510;
	}

	.sign-in:hover {
		opacity: 0.88;
	}

	.account {
		gap: 8px;
		max-width: 220px;
		padding-left: 4px;
	}

	.avatar {
		display: inline-grid;
		width: 24px;
		height: 24px;
		flex: none;
		place-items: center;
		border-radius: 50%;
		background: var(--color-brand-hover);
		color: #fff;
		font-size: 11px;
		font-weight: 650;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.brand:focus-visible,
	.nav-link:focus-visible,
	.sign-in:focus-visible,
	.menu-trigger:focus-visible {
		outline: 2px solid var(--bar-text);
		outline-offset: 2px;
	}

	.menu-trigger,
	.compact-links {
		display: none;
	}

	.menu-trigger {
		width: 40px;
		height: 40px;
		place-items: center;
		margin-right: -8px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--bar-text);
		cursor: pointer;
	}

	.menu-trigger svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-width: 1.5;
	}

	@media (max-width: 740px) {
		header {
			height: 56px;
		}

		.wide-links {
			display: none;
		}

		.menu-trigger {
			display: inline-grid;
		}

		.compact-links:popover-open {
			position: fixed;
			display: grid;
			width: min(15rem, calc(100vw - 20px));
			max-height: calc(100dvh - 60px);
			margin: 0;
			padding: 6px;
			overflow: auto;
			border: 1px solid var(--site-menu-border, var(--bar-rule));
			border-radius: 12px;
			background: var(--site-menu-bg, white);
			box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
			gap: 2px;
			inset: 52px 10px auto auto;
		}

		.compact-links :is(.nav-link, .sign-in) {
			max-width: 100%;
			justify-content: flex-start;
			margin: 0;
			border-radius: 8px;
		}
	}
</style>
