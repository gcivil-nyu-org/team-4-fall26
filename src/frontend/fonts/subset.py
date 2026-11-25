# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools[woff]==4.60.1"]
# ///
"""Cut the site's web fonts down to what it draws, and write their @font-face rules.

    cd src/frontend && uv run fonts/subset.py

Run by hand, never by the build. Commit what it writes:

- ``static/fonts/*.woff2``: each font as a small *core* (ASCII and the punctuation
  most pages use; preloaded) and *extended* files that the browser fetches only when
  a page draws one of their characters.
- ``src/lib/fonts/*.css``: the @font-face rules for those files. Each rule's
  ``unicode-range`` lists exactly the characters its file contains.

Rerun it when:

- a page starts using a font, weight, style, size range or OpenType feature it did
  not before (``qa/fonts/usage.mjs`` reports what is used today);
- content gains characters outside ``CORE``/``EXTENDED`` that should draw in the web
  font rather than a fallback (add them to ``CONTENT``); or
- a source font in ``fonts/source/`` is replaced.

The sources are the exact files the site rendered with before self-hosting, Google's
own served slices included, so the output draws the same glyphs. The CSS that loads
them keeps ``font-display: swap`` and every fallback font as they were.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts" / "source"
OUT_FONTS = ROOT / "static" / "fonts"
OUT_CSS = ROOT / "src" / "lib" / "fonts"
USAGE = ROOT / "qa" / "fonts" / "usage.json"

# ASCII, Latin-1 and the punctuation nearly every page sets: curly quotes, dashes
# and the ellipsis.
#
# Latin-1 is in the core, not the extended file, because a browser shapes each
# font file separately: with "é" in another file, "café" loses the kerning
# between "f" and "é" and the word draws differently. Google's Inter was split
# at the same place, so this keeps every page as it was. An ASCII-only core is
# smaller (qa/fonts/notes.md has the numbers) but shifts such words by a pixel.
CORE = frozenset(range(0x20, 0x7F)) | frozenset(range(0xA0, 0x100)) | {0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026}

# Latin Extended-A: names, places and reviews in other European languages.
EXTENDED = frozenset(range(0x100, 0x180))

# Characters in stored content that the prerendered pages do not show, found by
# scanning the database's text columns: arrows, a minus and an integral in chat
# messages. Kept wherever a source font draws them today.
CONTENT = frozenset({0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x222B})

# Turned on by default in browsers; dropping one would change shaping.
DEFAULT_FEATURES = ("ccmp", "locl", "rvrn", "calt", "liga", "clig", "rlig", "kern", "mark", "mkmk", "curs")


@dataclass(frozen=True)
class Source:
    """One input file, and the characters the site lets it draw today."""

    file: str
    # Its key in google-unicode-ranges.json, which records the unicode-range
    # Google served it under; None for a file the site declared without one.
    served: str | None = None


@dataclass(frozen=True)
class Face:
    """One font family/style, built from one or more sources."""

    slug: str
    family: str
    usage: str
    sources: Sequence[Source]
    # One @font-face per entry, each a CSS font-weight value.
    weights: Sequence[str]
    style: str = "normal"
    stylesheet: str = "home"
    # Variable axes: a number pins the axis, a pair limits its range.
    axes: dict[str, float | tuple[float, float]] = field(default_factory=dict)
    features: Sequence[str] = ()
    # The family name written into the font itself; set for fonts with a
    # Reserved Font Name, which must not be used by a modified version.
    rename: str | None = None


def ranges(text: str) -> frozenset[int]:
    """Parse a CSS unicode-range value into code points."""
    points: set[int] = set()
    for part in text.split(","):
        part = part.strip().removeprefix("U+")
        start, _, end = part.partition("-")
        points.update(range(int(start, 16), int(end or start, 16) + 1))
    return frozenset(points)


def css_range(points: Iterable[int]) -> str:
    ordered = sorted(points)
    spans: list[tuple[int, int]] = []
    for point in ordered:
        if spans and point == spans[-1][1] + 1:
            spans[-1] = (spans[-1][0], point)
        else:
            spans.append((point, point))
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans)


def used(usage_key: str) -> frozenset[int]:
    families = json.loads(USAGE.read_text(encoding="utf-8"))["families"]
    return frozenset(ord(char) for char in families[usage_key]["chars"])


def cut(face: Face, source: Source, wanted: frozenset[int]) -> tuple[bytes, frozenset[int]] | None:
    """Subset one source to `wanted`, returning the WOFF2 bytes and what it holds."""
    font = TTFont(SOURCE / source.file)
    allowed = frozenset(font.getBestCmap())
    if source.served is not None:
        served = json.loads((SOURCE / "google-unicode-ranges.json").read_text(encoding="utf-8"))
        allowed &= ranges(served[source.served])
    keep = wanted & allowed
    if not keep:
        return None

    options = subset.Options()
    options.layout_features = [*DEFAULT_FEATURES, *face.features]
    # Hinting stays. Without it Chrome on Linux drew the Instrument Serif wordmark
    # and some of Inter's punctuation and accented capitals a pixel differently,
    # and it is only a few percent of each file (qa/fonts/notes.md).
    options.hinting = True
    options.drop_tables += ["DSIG"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=keep)
    subsetter.subset(font)
    # After subsetting rather than before: there are fewer glyphs to instance, and
    # fontTools' subsetter trips over a freshly instanced font's lazy gvar.
    if face.axes:
        font = instancer.instantiateVariableFont(font, dict(face.axes), updateFontNames=False)

    if face.rename is not None:
        rename(font, face.rename)

    held = frozenset(font.getBestCmap())
    buffer = BytesIO()
    font.flavor = "woff2"
    font.save(buffer)
    return buffer.getvalue(), held


def rename(font: TTFont, family: str) -> None:
    """Give a modified font a new family name, as the OFL requires of one with a
    Reserved Font Name."""
    style = font["name"].getDebugName(2) or "Regular"
    names = {
        1: family,
        3: f"{family} {style}; subset for StudySpot",
        4: f"{family} {style}" if style != "Regular" else family,
        6: f"{family}-{style}".replace(" ", ""),
        16: family,
        17: style,
    }
    table = font["name"]
    for record in list(table.names):
        if record.nameID in names:
            table.removeNames(nameID=record.nameID)
    for name_id, value in names.items():
        table.setName(value, name_id, 3, 1, 0x409)
        table.setName(value, name_id, 1, 0, 0)


FACES: tuple[Face, ...] = (
    # Google's Inter, as the homepage loaded it: one variable file per slice,
    # declared at four weights, to which every weight the page asks for resolves.
    # The weight axis is left whole: limiting it to 300-700 moves its default off
    # the range's end, and fontTools' rescaled deltas then drew some glyphs a
    # pixel differently (qa/fonts/notes.md).
    Face(
        slug="inter",
        family="Inter",
        usage="Inter on home",
        sources=(Source("inter-latin.woff2", "Inter latin"), Source("inter-latin-ext.woff2", "Inter latin-ext")),
        weights=("300", "400", "600", "700"),
        features=("tnum",),
    ),
    Face(
        slug="inter-tight-900",
        family="Inter Tight",
        usage="Inter Tight on home",
        sources=(
            Source("inter-tight-900-latin.woff2", "Inter Tight latin"),
            Source("inter-tight-900-latin-ext.woff2", "Inter Tight latin-ext"),
        ),
        weights=("900",),
    ),
    # Press Start 2P reserves its name, so the subset is renamed inside and out.
    Face(
        slug="studyspot-pixel",
        family="StudySpot Pixel",
        usage="Press Start 2P on home",
        sources=(
            Source("press-start-2p-latin.woff2", "Press Start 2P latin"),
            Source("press-start-2p-latin-ext.woff2", "Press Start 2P latin-ext"),
        ),
        weights=("400",),
        rename="StudySpot Pixel",
    ),
    # Only weight 300 is set in Newsreader, at 32-72 px of optical size, but
    # neither axis is cut: pinning the weight or limiting optical size both
    # changed how glyphs drew (qa/fonts/notes.md), so the subset keeps them whole.
    Face(
        slug="newsreader",
        family="Newsreader",
        usage="Newsreader on home",
        sources=(Source("NewsreaderVariable.woff2"),),
        weights=("200 800",),
        stylesheet="global",
    ),
    Face(
        slug="newsreader-italic",
        family="Newsreader",
        usage="Newsreader on home",
        sources=(Source("NewsreaderVariable-Italic.woff2"),),
        weights=("200 800",),
        style="italic",
        stylesheet="global",
    ),
    Face(
        slug="instrument-serif",
        family="Instrument Serif",
        usage="Instrument Serif on home",
        sources=(Source("InstrumentSerif-Regular.woff2"),),
        weights=("400",),
        stylesheet="global",
    ),
    # The chat pages' Inter. Its CSS asks for 400-800, and Markdown bold inside
    # semibold text computes to 900. Text runs from 11 to 38 px, which spans the
    # whole optical-size axis, so that stays. Limiting weight to 400-900 is exact
    # here, because 400 is the axis default: checked at every weight and size.
    Face(
        slug="inter-variable",
        family="Inter",
        usage="Inter on other pages",
        sources=(Source("InterVariable.woff2"),),
        weights=("400 900",),
        stylesheet="chat",
        axes={"wght": (400, 900)},
        features=("tnum",),
    ),
)


def build() -> None:
    OUT_FONTS.mkdir(parents=True, exist_ok=True)
    OUT_CSS.mkdir(parents=True, exist_ok=True)
    for stale in OUT_FONTS.glob("*.woff2"):
        stale.unlink()

    stylesheets: dict[str, list[str]] = {}
    report: list[str] = []
    for face in FACES:
        content = used(face.usage) | CONTENT
        # Two sources are Google's latin and latin-ext slices. Everything kept
        # that the latin slice drew stays in the core, as it was -- including
        # the few Latin Extended-A letters Google put there, such as Œ, whose
        # glyphs differ slightly from the latin-ext slice's -- and the latin-ext
        # slice becomes the extended file. One source splits after Latin-1.
        core = CORE | EXTENDED | content if len(face.sources) > 1 else CORE
        parts = [("core", face.sources[0], core), ("ext", face.sources[-1], EXTENDED | content)]

        taken: set[int] = set()
        for part, source, wanted in parts:
            result = cut(face, source, frozenset(wanted - taken))
            if result is None:
                continue
            data, held = result
            held = frozenset(held - taken) if part != "core" else held
            taken |= held
            name = f"{face.slug}-{part}.woff2"
            (OUT_FONTS / name).write_bytes(data)
            report.append(f"{name:36} {len(data):>7} bytes  {len(held):>4} characters")
            for weight in face.weights:
                stylesheets.setdefault(face.stylesheet, []).append(
                    "@font-face {\n"
                    f"\tfont-family: '{face.family}';\n"
                    f"\tfont-style: {face.style};\n"
                    f"\tfont-weight: {weight};\n"
                    "\tfont-display: swap;\n"
                    f"\tsrc: url('/fonts/{name}') format('woff2');\n"
                    f"\tunicode-range: {css_range(held)};\n"
                    "}\n"
                )

    header = "/* Generated by fonts/subset.py; do not edit. Rerun it instead. */\n\n"
    for stylesheet, rules in stylesheets.items():
        (OUT_CSS / f"{stylesheet}.css").write_text(header + "\n".join(rules), encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    build()
