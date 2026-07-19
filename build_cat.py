#!/usr/bin/env python3
"""Regenerate static/cat.png from the sprite pack.

The dashboard cat is a consolidated sheet sliced out of the "Free pack" cats.
Run this to switch color variant or tweak which clips are included.
Requires Pillow (only for this dev-time step; the dashboard itself needs nothing).

    python3 build_cat.py                 # default: orange tabby (cat 1.6)
    python3 build_cat.py "cat 1.png"     # grey tabby
    python3 build_cat.py "cat 1.9.png"   # white
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, "Free pack")
OUT = os.path.join(HERE, "static", "cat.png")
S = 32  # source frame size

# (name, source_row, frame_count) -> output rows, in this order.
# Keep in sync with CLIPS in static/pet.js.
CLIPS = [
    ("walk_down", 4, 4), ("walk_up", 5, 4),
    ("walk_right", 6, 8), ("walk_left", 7, 8),
    ("sit", 1, 8), ("groom", 36, 9), ("meow", 28, 3),
]


def main():
    variant = sys.argv[1] if len(sys.argv) > 1 else "cat 1.6.png"
    src = Image.open(os.path.join(PACK, variant)).convert("RGBA")
    maxf = max(n for _, _, n in CLIPS)
    sheet = Image.new("RGBA", (maxf * S, len(CLIPS) * S), (0, 0, 0, 0))
    for i, (_, r, n) in enumerate(CLIPS):
        sheet.paste(src.crop((0, r * S, n * S, (r + 1) * S)), (0, i * S))
    sheet.save(OUT)
    print(f"wrote {OUT} from '{variant}'  ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
