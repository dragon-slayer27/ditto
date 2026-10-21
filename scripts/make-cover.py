"""Builds the 1000x420 cover image for the DEV post from the icon and a real screenshot."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "site" / "assets"
FONTS = Path("C:/Windows/Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    for candidate in (FONTS / name, Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def main() -> None:
    W, H = 2000, 840  # drawn at 2x, saved at 1000x420
    img = Image.new("RGB", (W, H), (251, 248, 241))
    d = ImageDraw.Draw(img)

    shot = Image.open(ASSETS / "screens" / "bank-done.png").convert("RGB")
    shot = shot.crop((150, 0, 1280, 640)).resize((1130, 640), Image.LANCZOS)
    x, y = 820, 150
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([x + 10, y + 24, x + 1130 + 10, y + 640 + 24], 28, fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    img.paste((180, 170, 150), mask=shadow)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.size[0], shot.size[1]], 24, fill=255)
    img.paste(shot, (x, y), mask)

    icon = Image.open(ASSETS / "icon.png").convert("RGBA").resize((150, 150), Image.LANCZOS)
    img.paste(icon, (90, 110), icon)
    d.text((270, 118), "Ditto", font=font("segoeuib.ttf", 120), fill=(31, 41, 55))
    d.text((92, 300), "Type it once.", font=font("segoeuib.ttf", 74), fill=(31, 41, 55))
    d.text((92, 390), "Gemma 4 on your laptop", font=font("seguisb.ttf", 54), fill=(63, 98, 18))
    d.text((92, 456), "fills every form after that.", font=font("seguisb.ttf", 54), fill=(63, 98, 18))
    d.text((92, 600), "114 test fields · 112 right · 0 silent mistakes", font=font("segoeui.ttf", 38), fill=(75, 85, 99))
    d.text((92, 656), "Local · open model · never submits for you", font=font("segoeui.ttf", 38), fill=(75, 85, 99))

    img.resize((1000, 420), Image.LANCZOS).save(ASSETS / "cover.png", optimize=True)
    print("wrote", ASSETS / "cover.png")


if __name__ == "__main__":
    main()
