# Web fonts: self-hosted and subset

`fonts/subset.py` cuts every web font down to what the site draws and writes the
`@font-face` rules; see its docstring for when to rerun it:

```shell
cd src/frontend && uv run fonts/subset.py
```

## Inventory before

| Font                 | Served from                      | Axes                     | Glyphs | Hinted | Licence                |
| -------------------- | -------------------------------- | ------------------------ | ------ | ------ | ---------------------- |
| Inter (homepage)     | Google Fonts, latin + latin-ext  | wght 100–900             | 518    | yes    | OFL, no reserved name  |
| Inter Tight 900      | Google Fonts, latin + latin-ext  | static                   | 482    | yes    | OFL, no reserved name  |
| Press Start 2P       | Google Fonts, latin + latin-ext  | static                   | 225    | yes    | OFL, **reserved name** |
| Newsreader, italic   | `static/`, Google's latin subset | wght 200–800, opsz 6–72  | 262    | yes    | OFL, no reserved name  |
| Instrument Serif     | `static/`, Google's latin subset | static                   | 220    | yes    | OFL, no reserved name  |
| InterVariable (chat) | `static/`, the full rsms release | opsz 14–32, wght 100–900 | 2,937  | no     | OFL, no reserved name  |

Only the homepage, `/communities` and `/messages` load web fonts; every other route draws
in system fonts and still does. No page uses `hyphens: auto`, so U+2010 is not needed.

## What the site uses

From `qa/fonts/usage.mjs` (every route, seven widths, lazy sections scrolled into view) and a
scan of the database's text columns:

- Homepage Inter: weights 300–900 asked for, which resolve to the four declared faces
  (300, 400, 600, 700); `tabular-nums`; non-ASCII `© · é ø Ō – ’ … → ★`.
- Newsreader: weight 300 only, roman and italic, 32–72 px; `—`.
- Inter Tight 900, Press Start 2P (`×`), Instrument Serif (`✳`, which it lacks and has
  always drawn from a fallback).
- Chat Inter: CSS weights 400–800, and Markdown bold inside semibold computes to 900;
  11–38 px, the whole optical-size range; `tabular-nums`; stored messages add `→ ↑ ↓ − ∫`.

## What the subset keeps

- Characters: ASCII, Latin-1, curly quotes, dashes, ellipsis (the core, preloaded where
  the hero needs it) and Latin Extended-A plus the content characters above (the extended
  file, behind `unicode-range`). Each rule's `unicode-range` lists only what its file holds.
- Features: the browser defaults plus `tnum` where `tabular-nums` is set.
- Press Start 2P is renamed to StudySpot Pixel inside the font and in CSS, as its reserved
  name requires of a modified copy.

## Where this deviates from the brief, and why

Each was checked by rendering original and subset side by side in Chrome 156 (Linux) and
pixel-diffing:

| Brief asked for                 | Done instead                       | Why                                                                                                                                                               | Cost                              |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Drop hinting                    | Kept                               | Without it the Instrument Serif wordmark (up to 255 levels) and some Inter punctuation and accented capitals drew differently                                     | about 1–4% per file               |
| Limit axes to the ranges in use | Only the chat Inter (wght 400–900) | Limiting homepage Inter to 300–700, pinning Newsreader to 300 or limiting its opsz to 32–72 all changed glyphs (fontTools rescales deltas when the default moves) | Newsreader stays ~117 + 131 KB    |
| Core of ASCII and punctuation   | ASCII, Latin-1 and punctuation     | A browser shapes each file separately: with `é` elsewhere, `café` loses its f–é kerning. Google split Inter at the same place                                     | Inter core 35 KB instead of 25 KB |

The brief's character set does change one thing on purpose: characters outside it that
Google's latin slice used to cover, such as `€ ™ •`, now draw in the fallback font. None
appear in current content.

## Pixel diff

`qa/fonts/shots.mjs` photographs `/`, `/communities` and `/messages` at 390 and 1440 px a
screen at a time (34 shots), text only, plus a probe that sets every face in ASCII,
Latin-1, Latin Extended-A, CJK, a code span and bold inside italics.

- Two shots of the same baseline build differ by at most 28 pixels of 2 levels: the noise floor.
- `/communities`, `/messages`: identical.
- Homepage: identical except 48 pixels around the curly apostrophe in "you’re" (one card,
  both widths), sub-pixel, not explained; and 1 pixel of 1 level (noise).
- Probe: 0.39% of pixels, from `€` and `™` falling back (above) and the same apostrophe.

## Bytes

| Page           | Before (fonts at load) | After   |
| -------------- | ---------------------- | ------- |
| `/`            | 468,759                | 344,948 |
| `/communities` | 352,471                | 41,010  |
| `/messages`    | 352,471                | 41,010  |
| other routes   | 0                      | 0       |

The homepage also drops two Google Fonts stylesheets and the connections to two Google
origins. Its extended Inter file loads because a spot name contains `Ō`; no other extended
file loads on any page.

LCP showed no measurable change: on slow 3G it is 3.4 s either way, and on desktop the
order the two builds were measured in moved it by 300 ms, more than any difference between
them.

## Later

Embedding Inter's core in the global stylesheet would save its request; precaching the
extended files after idle would make the first accented name free.
