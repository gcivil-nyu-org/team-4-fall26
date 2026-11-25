"""Pixel-diff two screenshots for the qa/ before/after pairs.

    uv run --with pillow python qa/pixeldiff.py before.png after.png [diff.png]

Prints how many pixels differ, the largest per-channel difference, and the box
that holds every difference. With a third path it writes a picture of the
differences: the after image dimmed, with changed pixels in magenta.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops


def main(before_path: str, after_path: str, diff_path: str | None) -> int:
    before = Image.open(before_path).convert("RGB")
    after = Image.open(after_path).convert("RGB")
    if before.size != after.size:
        print(f"size differs: {before.size} vs {after.size}")
        return 1

    delta = ImageChops.difference(before, after)
    box = delta.getbbox()
    width, height = before.size
    if box is None:
        print(f"identical: 0 of {width * height} pixels differ")
        return 0

    changed = 0
    largest = 0
    for red, green, blue in delta.getdata():
        peak = max(red, green, blue)
        if peak:
            changed += 1
            largest = max(largest, peak)
    print(
        f"{changed} of {width * height} pixels differ "
        f"({100 * changed / (width * height):.3f}%), largest channel delta {largest}, box {box}"
    )

    if diff_path is not None:
        mask = delta.convert("L").point(lambda value: 255 if value else 0)
        picture = Image.blend(after, Image.new("RGB", after.size), 0.7)
        picture.paste((255, 0, 255), mask=mask)
        picture.save(Path(diff_path))
    return 2


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        print(__doc__)
        sys.exit(64)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None))
