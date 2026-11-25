# Homepage QA principles

Rules taken from the reference reading for the homepage polish pass. Each rule is one I apply
and check against; where a page did not say what the brief expected, that is noted.

## tj-zhang.com — Frontend for systems engineers

The page is about state ownership and data flow, not the critical rendering path or byte budgets.
Rules that carry over to Svelte:

- Derive display values during render (`$derived`), never copy props into state and sync them.
- Put side effects in effects keyed on committed input, not in render.
- Keep props immutable so derived values never change their own inputs.
- Re-read an external snapshot after subscribing, so an update between read and subscribe is not lost.
- Keep UI-only state local unless it must survive a reload.

The rendering-path rules the brief attributes to it (measure first, bytes and round trips are
budgets) are applied anyway, from the brief itself: every change here has a before/after number
in `metrics.md`.

## calculus-of-interfaces.vercel.app

A research prototype compiling a layout into one function from props to positions. It states no
polish rules. What I take from it is the framing only: a view is a function of state over time, so
scroll-driven views must be pure functions of scroll position (no accumulated state, no reads that
depend on the previous frame's writes).

## emilkowal.ski — 7 practical animation tips

- Pressed controls scale to 0.97 on `:active`.
- Never enter from `scale(0)`; start at 0.9 or above with opacity.
- Entrances and exits use ease-out; never ease-in for UI.
- Use custom curves; the built-in keywords are too weak.
- UI motion stays under 300 ms (a 180 ms select beats a 400 ms one).
- Popovers scale from their trigger, not their centre.
- A 2 px blur can mask a crossfade that still looks wrong.

## emilkowal.ski — Agents with taste

- Easing by intent: entering or exiting → ease-out; moving on screen → ease-in-out; hover → ease;
  constant motion → linear.
- Durations: micro-interactions 100–150 ms, dropdowns 150–250 ms, modals and drawers 200–300 ms.
- Exits about 20% faster than entrances; bigger travel takes longer.
- 44 px minimum hit area, extended with a pseudo-element.
- `tabular-nums` on numbers that change; `…` not three dots.
- Match fallback metrics to avoid font-swap layout shift.

## animations.dev and its vocabulary

- Be able to say why a motion exists; if the only answer is "it looks cool" and it is frequent, cut it.
- The more often someone sees an animation, the shorter and subtler it should be.
- Animate only transform and opacity; 60 fps is the baseline.
- Keep motion interruptible: transitions, not keyframes, for anything that can be re-triggered.
- Spatial consistency: an element keeps its identity and position across states.
- Parallax and scroll reveal with restraint.
- Reduced motion means gentler, not absent: keep opacity, drop movement.

## jakub.kr — Shared layout animations

- Morph between states (FLIP: First, Last, Invert, Play) instead of a hard cut where the element is the same thing.
- One shared identity per element per state, or the morph breaks.
- Interpolate radius, size and position together.
- In Svelte the equivalents are `animate:flip`, crossfade, or the View Transitions API — no new library.

## make-interfaces-feel-better (skill, installed locally)

- Concentric radii: outer = inner + padding.
- Optical over geometric alignment for icons in buttons.
- Shadows for elevation, borders for structure.
- `text-wrap: balance` on headings, `pretty` on body copy.
- Scale on press 0.96, never below 0.95.
- Never `transition: all`; name the properties.
- `will-change` only on composited properties and only while animating.
- 44×44 px hit areas on touch; hover styles gated behind `(hover: hover) and (pointer: fine)`.
- Review motion at 10% speed and walk every state: hover, focus, active, loading, empty.

## wattenberger.com

No motion or scroll guidance on the page itself. The storytelling rule the brief wants is taken as
stated there: scroll is the narrative, and the reader always knows where they are. On this page
that means the card deck and the pinned phone must never leave the reader unsure whether they are
scrolling the page or an inner element.

## maggieappleton.com — Fortune telling, and aiforui.dev

- Make one small thing feel real, rather than many things vaguely.
- Design the failure states; they reveal more than the happy path (loading, error, offline, slow 3G).
- Too many animations make an interface feel cheap; encode taste as rules so the same easing
  correction is never made twice.
- Review generated motion slowly before trusting it.

## ForesightJS

`js.foresight` (MIT) predicts intent from pointer trajectory, Tab order and scroll, and on touch
falls back to viewport entry or touchstart. Adopt only if it measurably speeds navigation to
`/spots`, `/communities`, `/board` and the map beyond SvelteKit's existing
`data-sveltekit-preload-data="hover"`; otherwise skip it. The decision and its numbers go in
`metrics.md`.
