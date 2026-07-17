from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
ASSET_DIR = ROOT / "store-assets" / "rustore" / "screenshots"
SOURCE_DIR = ASSET_DIR / "source"
WIDTH = 1080
HEIGHT = 1920
SCREEN_LEFT = 90
SCREEN_TOP = 500
SCREEN_WIDTH = 900
SCREEN_HEIGHT = 1350
SCREEN_CROP_RIGHT = 690
EMERALD = "#0B755A"
DARK = "#10372F"
MUTED = "#58736B"
FONT_REGULAR = Path("C:/Windows/Fonts/segoeui.ttf")
FONT_SEMIBOLD = Path("C:/Windows/Fonts/seguisb.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/segoeuib.ttf")


SLIDES = [
    (
        "01-overview.png",
        "01-overview.png",
        "Весь кредит — на одном экране",
        "Платёж, остаток, срок и эффект досрочного взноса видны сразу",
    ),
    (
        "02-scenarios.png",
        "02-scenarios.png",
        "Сравнивайте стратегии погашения",
        "Оцените экономию процентов, новый платёж и сокращение срока",
    ),
    (
        "03-early-payments.png",
        "03-early-payments.png",
        "Планируйте досрочные платежи",
        "Разовые взносы и регулярные правила — в одном разделе",
    ),
    (
        "04-goal-planner.png",
        "04-goal-planner.png",
        "Поставьте цель — получите план",
        "Приложение подберёт доплату и покажет дату закрытия и экономию",
    ),
    (
        "05-schedule.png",
        "05-schedule.png",
        "Проверяйте каждый платёж",
        "Карточки и компактная таблица платежей",
    ),
    (
        "06-settings.png",
        "06-settings.png",
        "Настройте расчёт как в договоре",
        "Ставка, даты, начисление процентов, комиссии и округление",
    ),
]


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), size, Image.Resampling.LANCZOS)


def rounded_image(image: Image.Image, size: tuple[int, int], radius: int) -> Image.Image:
    fitted = ImageOps.fit(image.convert("RGB"), size, Image.Resampling.LANCZOS)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    fitted.putalpha(mask)
    return fitted


def apply_current_version(image: Image.Image) -> Image.Image:
    """Синхронизирует видимую версию сохранённого интерфейса с package.json."""
    prepared = image.convert("RGB")
    draw = ImageDraw.Draw(prepared)
    draw.rectangle((68, 3, 306, 34), fill="#F8FBFA")
    draw.text(
        (72, 9),
        f"ФИНАНСОВЫЙ ПЛАН · V{APP_VERSION}",
        font=font(FONT_SEMIBOLD, 10),
        fill="#71857F",
    )
    return prepared


def wrap_pixels(draw: ImageDraw.ImageDraw, text: str, text_font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textbbox((0, 0), candidate, font=text_font)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def draw_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    text_font: ImageFont.FreeTypeFont,
    fill: str,
    max_width: int,
    spacing: int,
) -> int:
    x, y = xy
    lines = wrap_pixels(draw, text, text_font, max_width)
    line_height = text_font.size + spacing
    for index, line in enumerate(lines):
        draw.text((x, y + index * line_height), line, font=text_font, fill=fill)
    return y + len(lines) * line_height


def add_shadow(canvas: Image.Image, box: tuple[int, int, int, int], radius: int) -> None:
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(box, radius=radius, fill=(7, 68, 51, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    canvas.alpha_composite(shadow)


def build_slide(index: int, source_name: str, output_name: str, title: str, subtitle: str) -> Path:
    background = cover(Image.open(SOURCE_DIR / "background.png"), (WIDTH, HEIGHT)).convert("RGBA")
    veil = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 28))
    background.alpha_composite(veil)
    draw = ImageDraw.Draw(background)

    icon = rounded_image(Image.open(ROOT / "public" / "pwa-192.png"), (66, 66), 15)
    background.alpha_composite(icon, (72, 58))
    draw.text((154, 67), "CreditCalc", font=font(FONT_BOLD, 36), fill=DARK)
    draw.text((154, 106), "кредитный график", font=font(FONT_REGULAR, 25), fill=MUTED)

    badge = f"{index:02d} / {len(SLIDES):02d}"
    badge_font = font(FONT_SEMIBOLD, 25)
    badge_box = draw.textbbox((0, 0), badge, font=badge_font)
    badge_width = badge_box[2] - badge_box[0] + 38
    draw.rounded_rectangle((WIDTH - badge_width - 68, 66, WIDTH - 68, 116), radius=25, fill=EMERALD)
    draw.text((WIDTH - badge_width - 49, 73), badge, font=badge_font, fill="white")

    title_bottom = draw_lines(draw, title, (70, 170), font(FONT_BOLD, 68), DARK, 940, 8)
    draw_lines(draw, subtitle, (72, title_bottom + 18), font(FONT_REGULAR, 34), MUTED, 920, 8)

    frame_box = (SCREEN_LEFT - 12, SCREEN_TOP - 12, SCREEN_LEFT + SCREEN_WIDTH + 12, SCREEN_TOP + SCREEN_HEIGHT + 12)
    add_shadow(background, frame_box, 50)
    draw.rounded_rectangle(frame_box, radius=50, fill=(255, 255, 255, 255), outline=(211, 230, 223, 255), width=3)

    screenshot = apply_current_version(Image.open(SOURCE_DIR / source_name))
    screenshot = screenshot.crop((0, 0, min(SCREEN_CROP_RIGHT, screenshot.width), screenshot.height))
    screen = rounded_image(screenshot, (SCREEN_WIDTH, SCREEN_HEIGHT), 40)
    background.alpha_composite(screen, (SCREEN_LEFT, SCREEN_TOP))

    output = ASSET_DIR / output_name
    background.convert("RGB").save(output, "PNG", optimize=True, compress_level=9)
    return output


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for index, (source_name, output_name, title, subtitle) in enumerate(SLIDES, start=1):
        output = build_slide(index, source_name, output_name, title, subtitle)
        print(output)


if __name__ == "__main__":
    main()
