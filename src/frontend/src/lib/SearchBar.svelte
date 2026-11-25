<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** What the box shows. The page owns it; this component never stores it. */
		value: string;
		/** Every keystroke, so the page's copy is never behind the box. */
		onInput: (query: string) => void;
		onSearch: (query: string) => void;
		/** Extra controls inside the box, before the search button. */
		children?: Snippet;
	};

	let { value, onInput, onSearch, children }: Props = $props();
	let input: HTMLInputElement;

	/** ⌘K on a Mac, Ctrl+K elsewhere: jump to the box with its text selected. */
	function shortcut(event: KeyboardEvent): void {
		if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey)
			return;
		event.preventDefault();
		input.focus();
		input.select();
	}

	/**
	 * An empty submit is a real request, not a no-op.
	 *
	 * Clearing the text and pressing Search is how you say "no query any more",
	 * and swallowing it meant a deleted word went on applying to everything the
	 * page did next.
	 */
	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		onSearch(value.trim());
	}
</script>

<svelte:window onkeydown={shortcut} />

<form role="search" onsubmit={handleSubmit}>
	<label for="spot-search">
		<span class="sr-only">Where</span>
		<input
			id="spot-search"
			name="q"
			{value}
			oninput={(event) => onInput(event.currentTarget.value)}
			placeholder="Try a café, a library, or a neighborhood …"
			autocomplete="off"
			aria-keyshortcuts="Meta+K Control+K"
			bind:this={input}
		/>
	</label>

	{@render children?.()}

	<button type="submit" class="submit" aria-label="Search">
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="11" cy="11" r="6.5"></circle>
			<path d="m16 16 4 4"></path>
		</svg>
	</button>
</form>

<style>
	/* Kagi's box: one long pill, the lens inside it on the right. */
	form {
		display: flex;
		width: 100%;
		height: 56px;
		align-items: center;
		gap: 4px;
		padding: 0 8px 0 24px;
		border: 1px solid var(--ln-border, rgb(255 255 255 / 8%));
		border-radius: 999px;
		background: var(--ln-surface, #141516);
		box-shadow: 0 10px 40px rgb(0 0 0 / 45%);
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}

	form:focus-within {
		border-color: rgb(113 112 255 / 55%);
		box-shadow:
			0 0 0 4px rgb(113 112 255 / 12%),
			0 10px 40px rgb(0 0 0 / 45%);
	}

	label {
		display: flex;
		min-width: 0;
		flex: 1;
	}

	input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ln-text, #f7f8f8);
		font-size: 16px;
	}

	input::placeholder {
		color: var(--ln-faint, #62666d);
	}

	.submit {
		display: grid;
		width: 40px;
		height: 40px;
		flex: none;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--ln-muted, #8a8f98);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.submit:hover {
		background: var(--ln-raised, #1c1d1f);
		color: var(--ln-text, #f7f8f8);
	}

	.submit:focus-visible {
		outline: 2px solid var(--ln-brand-hover, #7170ff);
		outline-offset: 2px;
	}

	svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-width: 1.6;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
