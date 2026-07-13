"""Generate committed PWA PNG assets from the existing favicon geometry.

Requires Pillow. The maskable variant keeps the complete bank mark inside the
standard 40% radius safe zone and uses an opaque full-bleed background.
"""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DEEP = "#071a17"
GREEN = "#12b886"
LIGHT = "#e8fff7"


def scaled(point: tuple[float, float], size: int, factor: float = 1.0) -> tuple[int, int]:
    x, y = point
    return (
        round(size * (32 + (x - 32) * factor) / 64),
        round(size * (32 + (y - 32) * factor) / 64),
    )


def render(size: int, destination: str, *, maskable: bool = False) -> None:
    scale = 0.72 if maskable else 1.0
    image = Image.new("RGB", (size, size), DEEP)
    draw = ImageDraw.Draw(image)
    if not maskable:
        radius = round(size * 14 / 64)
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=DEEP)

    draw.rectangle((*scaled((13, 29), size, scale), *scaled((51, 51), size, scale)), fill=GREEN)
    draw.polygon([scaled(point, size, scale) for point in ((32, 10), (8, 27), (56, 27))], fill=LIGHT)
    draw.rectangle((*scaled((22, 34), size, scale), *scaled((42, 39), size, scale)), fill=DEEP)
    draw.rectangle((*scaled((22, 43), size, scale), *scaled((42, 47), size, scale)), fill=DEEP)
    image.save(PUBLIC / destination, format="PNG", optimize=True)


render(192, "pwa-192.png")
render(512, "pwa-512.png")
render(512, "pwa-maskable-512.png", maskable=True)
render(180, "apple-touch-icon.png")
