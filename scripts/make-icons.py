"""Draws Ditto's icon (a ditto mark above a form line) at every size Chrome needs."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "icons"
SITE = ROOT / "site" / "assets"

BG = (63, 98, 18, 255)        # moss green
MARK = (254, 243, 199, 255)   # cream
LINE = (163, 230, 53, 255)    # lime


def draw(size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(112 * s), fill=BG)
    w = int(70 * s)
    for x in (205, 330):
        top = (x * s, 120 * s)
        bottom = ((x - 42) * s, 318 * s)
        d.line([top, bottom], fill=MARK, width=w)
        r = w / 2
        for cx, cy in (top, bottom):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=MARK)
    lw = int(30 * s)
    y = 392 * s
    d.line([(132 * s, y), (380 * s, y)], fill=LINE, width=lw)
    for cx in (132 * s, 380 * s):
        d.ellipse([cx - lw / 2, y - lw / 2, cx + lw / 2, y + lw / 2], fill=LINE)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SITE.mkdir(parents=True, exist_ok=True)
    big = draw()
    for px in (16, 32, 48, 128):
        big.resize((px, px), Image.LANCZOS).save(OUT / f"icon{px}.png")
    big.resize((256, 256), Image.LANCZOS).save(SITE / "icon.png")
    big.resize((64, 64), Image.LANCZOS).save(SITE / "favicon.png")
    print("icons written to", OUT, "and", SITE)


if __name__ == "__main__":
    main()
