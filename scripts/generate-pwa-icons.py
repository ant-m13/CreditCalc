"""Generate every committed CreditCalc raster icon from one canonical geometry.

Requires Pillow. Web icons use an opaque full-bleed background. Android gets
legacy, round, adaptive foreground, monochrome and splash resources.
"""

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
DEEP = "#071a17"
GREEN = "#12b886"
LIGHT = "#e8fff7"
DESIGN_SIZE = 1024
OVERSAMPLE = 4
ANDROID_DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


def scaled(point: tuple[float, float], size: int, factor: float = 1.0) -> tuple[int, int]:
    x, y = point
    return (
        round(size * (DESIGN_SIZE / 2 + (x - DESIGN_SIZE / 2) * factor) / DESIGN_SIZE),
        round(size * (DESIGN_SIZE / 2 + (y - DESIGN_SIZE / 2) * factor) / DESIGN_SIZE),
    )


def scaled_radius(radius: float, size: int, factor: float = 1.0) -> int:
    return round(size * radius * factor / DESIGN_SIZE)


def draw_mark(image: Image.Image, size: int, factor: float, *, monochrome: bool = False) -> None:
    draw = ImageDraw.Draw(image)
    roof = LIGHT
    panel = LIGHT if monochrome else GREEN
    detail = LIGHT
    line = LIGHT if monochrome else DEEP

    draw.polygon(
        [scaled(point, size, factor) for point in ((512, 176), (150, 424), (874, 424))],
        fill=roof,
    )
    draw.rounded_rectangle(
        (*scaled((220, 442), size, factor), *scaled((804, 832), size, factor)),
        radius=scaled_radius(64, size, factor),
        fill=panel,
    )
    for center, width in (((300, 548), 370), ((300, 642), 292), ((300, 736), 214)):
        _, center_y = center
        dot_radius = scaled_radius(24, size, factor)
        dot_center = scaled(center, size, factor)
        draw.ellipse(
            (
                dot_center[0] - dot_radius,
                dot_center[1] - dot_radius,
                dot_center[0] + dot_radius,
                dot_center[1] + dot_radius,
            ),
            fill=detail,
        )
        if not monochrome:
            draw.rounded_rectangle(
                (
                    *scaled((354, center_y - 26), size, factor),
                    *scaled((354 + width, center_y + 26), size, factor),
                ),
                radius=scaled_radius(26, size, factor),
                fill=line,
            )


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def square_mark(size: int, *, factor: float, background: str | None, monochrome: bool = False) -> Image.Image:
    canvas_size = size * OVERSAMPLE
    mode = "RGB" if background else "RGBA"
    color = background if background else (0, 0, 0, 0)
    image = Image.new(mode, (canvas_size, canvas_size), color)
    draw_mark(image, canvas_size, factor, monochrome=monochrome)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def render_web(size: int, destination: str, *, maskable: bool = False) -> None:
    save(square_mark(size, factor=0.86 if maskable else 1.0, background=DEEP), PUBLIC / destination)


def render_android_icons() -> None:
    for density, (legacy_size, adaptive_size) in ANDROID_DENSITIES.items():
        destination = ANDROID_RES / f"mipmap-{density}"
        save(square_mark(legacy_size, factor=0.86, background=DEEP), destination / "ic_launcher.png")

        round_icon = square_mark(legacy_size, factor=0.78, background=DEEP).convert("RGBA")
        alpha = Image.new("L", (legacy_size, legacy_size), 0)
        ImageDraw.Draw(alpha).ellipse((0, 0, legacy_size - 1, legacy_size - 1), fill=255)
        round_icon.putalpha(alpha)
        save(round_icon, destination / "ic_launcher_round.png")

        save(square_mark(adaptive_size, factor=0.84, background=None), destination / "ic_launcher_foreground.png")
        save(square_mark(adaptive_size, factor=0.84, background=None, monochrome=True), destination / "ic_launcher_monochrome.png")


def render_android_splashes() -> None:
    for destination in ANDROID_RES.glob("**/splash.png"):
        with Image.open(destination) as current:
            width, height = current.size
        image = Image.new("RGB", (width, height), DEEP)
        mark_size = round(min(width, height) * 0.34)
        mark = square_mark(mark_size, factor=0.86, background=DEEP)
        image.paste(mark, ((width - mark_size) // 2, (height - mark_size) // 2))
        save(image, destination)


render_web(192, "pwa-192.png")
render_web(512, "pwa-512.png")
render_web(512, "pwa-maskable-512.png", maskable=True)
render_web(180, "apple-touch-icon.png")

if ANDROID_RES.exists():
    render_android_icons()
    render_android_splashes()
