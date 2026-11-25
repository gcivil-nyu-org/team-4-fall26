# Homepage metrics

Measured with `qa/measure.mjs` against `vite preview` of a production build, in the installed
Google Chrome 156 on the real GPU (`--use-angle=gl`), cache disabled.

- **desktop**: 1440×900, no throttling.
- **slow-3g**: 390×844 touch phone, 400 kbit/s each way, 400 ms RTT, 4× CPU slowdown.

"At load" covers the first 10 s with no scrolling; "scrolled" adds a slow scroll to the bottom
(on slow-3g most of what the scroll requests is still downloading when the run ends, so that
column undercounts there). Long tasks are counted over the first 10 s; with the hero animating
they vary by ±10–15% between runs, so differences smaller than that are noise. LCP varies by
about ±50 ms on desktop.

INP is not reported: the script makes no interactions, so there is nothing for it to measure.

## Why not Playwright's Chromium

The first baseline came from Playwright's bundled Chromium and is discarded. On this machine it
has no WebGL2 (the maps throw, so no tiles are fetched) and its GPU process stalls the first
canvas call of every page for 6–15 s. That stall showed up as about 6 s of "rasterise" in the
hero canvas and 17 s of long tasks, which looked like a site bug and is not one: in Chrome the
same code takes 29 ms. A fix written against it (one shared canvas for the hero's icons) was
measured, shown to change nothing in a real browser, and reverted.

## Results

| Step | Profile | LCP ms | CLS | Long tasks (ms) | Requests | Bytes at load | JS | Fonts | API | Tiles | Images |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | desktop | 844 | 0.0021 | 8 (1585) | 60 | 1,689,545 | 465,036 | 468,759 | 41,349 | 448,983 | 207,976 |
| 03 phone loads when near | desktop | 812 | 0.0021 | 3 (942) | 41 | 890,306 | 162,154 | 468,759 | 4,427 | 0 | 207,978 |
| baseline | slow-3g | 3416 | 0.0004 | 164 (14449) | 50 | 1,066,964 | 465,036 | 468,759 | 41,349 | 34,378 | 0 |
| 03 phone loads when near | slow-3g | 3404 | 0.0004 | 186 (13904) | 37 | 682,328 | 162,154 | 468,759 | 4,427 | 0 | 0 |

Baseline is commit 72c050a (the homepage build fix, otherwise the branch as it was).
