#!/usr/bin/env python3
"""Regenerate static/cat*.png from the sprite pack.

The dashboard/kiosk cats are consolidated sheets sliced out of the "Free
pack" cats. Run this to switch color variants or tweak which clips are
included. Requires Pillow (only for this dev-time step; the dashboard
itself needs nothing).

    python3 build_cat.py                 # builds all variants (orange/grey/white)
    python3 build_cat.py "cat 1.png"     # just grey tabby -> static/cat.png
    python3 build_cat.py "cat 1.9.png"   # just white -> static/cat.png
    python3 build_cat.py --icons         # PWA icons for the phone app
"""
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, "Free pack")
OUT = os.path.join(HERE, "static", "cat.png")
S = 32  # source frame size

# name -> (source file, output file). "orange" is the default/dashboard cat
# and always writes static/cat.png; the others back the cats-screen variety.
VARIANTS = {
    "orange": ("cat 1.6.png", "cat.png"),
    "grey":   ("cat 1.png", "cat-grey.png"),
    "white":  ("cat 1.9.png", "cat-white.png"),
}

# (name, source_row, frame_count) -> output rows, in this order.
# Keep in sync with CLIPS in static/pet.js.
# NOTE: in the source pack, row 6 walks facing LEFT and row 7 walks facing
# RIGHT (opposite of what you'd guess) - mixing these up makes the cat
# visually walk backwards ("moonwalking") whenever it moves horizontally.
CLIPS = [
    ("walk_down", 4, 4), ("walk_up", 5, 4),
    ("walk_right", 7, 8), ("walk_left", 6, 8),
    ("sit", 1, 8), ("groom", 36, 9), ("meow", 28, 3),
]


BG = (241, 235, 221, 255)  # --bg from style.css
ICON_SIZES = [(192, "icon-192.png"), (512, "icon-512.png"), (180, "icon-180.png")]


def build_icons():
    """PWA icons for the phone app: the sit frame on the dashboard's cream,
    nearest-neighbour upscaled so it stays crisp pixel art.

    Padded to ~60% of the canvas so it survives Android's maskable crop.
    """
    sheet = Image.open(OUT).convert("RGBA")
    face = sheet.crop((0, 4 * S, S, 5 * S))          # first frame of the sit row
    face = face.crop(face.getbbox())                  # drop the transparent margin
    for size, name in ICON_SIZES:
        canvas = Image.new("RGBA", (size, size), BG)
        # ~78% of the canvas, integer-scaled so the pixels stay square.
        mult = max(1, int(size * 0.78) // max(face.width, face.height))
        w, h = face.width * mult, face.height * mult
        canvas.alpha_composite(
            face.resize((w, h), Image.NEAREST),
            ((size - w) // 2, (size - h) // 2),
        )
        path = os.path.join(HERE, "static", name)
        canvas.convert("RGB").save(path)
        print(f"wrote {path}  ({size}x{size})")


def build_sheet(src_name, out_name):
    src = Image.open(os.path.join(PACK, src_name)).convert("RGBA")
    maxf = max(n for _, _, n in CLIPS)
    sheet = Image.new("RGBA", (maxf * S, len(CLIPS) * S), (0, 0, 0, 0))
    for i, (_, r, n) in enumerate(CLIPS):
        sheet.paste(src.crop((0, r * S, n * S, (r + 1) * S)), (0, i * S))
    out = os.path.join(HERE, "static", out_name)
    sheet.save(out)
    print(f"wrote {out} from '{src_name}'  ({sheet.width}x{sheet.height})")


def main():
    if "--icons" in sys.argv[1:]:
        build_icons()
        return

    if len(sys.argv) > 1:
        build_sheet(sys.argv[1], "cat.png")
        return

    for src_name, out_name in VARIANTS.values():
        build_sheet(src_name, out_name)


if __name__ == "__main__":
    main()
