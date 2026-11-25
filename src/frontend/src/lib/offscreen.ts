import type { Attachment } from 'svelte/attachments';

/**
 * Marks an element `data-offscreen` while it is out of view, for CSS to pause
 * its animations with `animation-play-state: paused`.
 *
 * Browsers keep running CSS animations that nobody can see, and an animated
 * SVG transform or a pseudo-element's opacity is restyled on the main thread
 * every frame, wherever the reader is on the page. Paused, they cost nothing
 * and pick up where they stopped when they come back into view.
 */
export const pauseOffscreen: Attachment<HTMLElement> = (element) => {
	const watch = new IntersectionObserver(([entry]) => {
		element.toggleAttribute('data-offscreen', !entry.isIntersecting);
	});
	watch.observe(element);
	return () => watch.disconnect();
};
