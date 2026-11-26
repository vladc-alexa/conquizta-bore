# Generate crisp Sci-Fi theme artwork in public/art/scifi/ (using PIL + NumPy)
# so every mode card, hero avatar, fight stage, and siege battlefield has a distinct
# futuristic neon-cyberpunk / orbital Sci-Fi look when toggling from Rocky-Stone to Sci-Fi.
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path("public/art/scifi")
OUT.mkdir(parents=True, exist_ok=True)
ART = Path("public/art")


def sci_fi_grade(src_path: Path, dst_path: Path, accent="cyan", draw_overlay=None):
    im = Image.open(src_path).convert("RGB")
    arr = np.asarray(im, dtype=np.float32) / 255.0
    H, W, _ = arr.shape

    # Shift warm medieval tones into sleek deep-space indigo, brushed titanium, and neon cyan/magenta
    lum = arr[:, :, 0] * 0.299 + arr[:, :, 1] * 0.587 + arr[:, :, 2] * 0.114
    out = np.zeros_like(arr)
    if accent == "cyan":
        out[:, :, 0] = np.clip(lum * 0.35 + arr[:, :, 2] * 0.45, 0, 1)
        out[:, :, 1] = np.clip(lum * 0.85 + arr[:, :, 0] * 0.12, 0, 1)
        out[:, :, 2] = np.clip(lum * 1.18 + 0.14, 0, 1)
    elif accent == "plasma":
        out[:, :, 0] = np.clip(arr[:, :, 0] * 0.72 + lum * 0.38, 0, 1)
        out[:, :, 1] = np.clip(lum * 0.55 + arr[:, :, 2] * 0.32, 0, 1)
        out[:, :, 2] = np.clip(lum * 1.05 + 0.16, 0, 1)
    else:
        out[:, :, 0] = np.clip(lum * 0.45 + arr[:, :, 0] * 0.28, 0, 1)
        out[:, :, 1] = np.clip(lum * 0.92 + 0.06, 0, 1)
        out[:, :, 2] = np.clip(lum * 1.22 + 0.18, 0, 1)

    # Subtle futuristic holographic scanlines
    scan = np.ones((H, 1, 1), dtype=np.float32)
    scan[::4, 0, 0] = 0.88
    out *= scan

    res = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")
    if draw_overlay:
        draw_overlay(res)
    res.save(dst_path, "JPEG", quality=90, optimize=True)
    print(f"Saved {dst_path.name} ({res.size[0]}x{res.size[1]})")


def overlay_hex_hud(im: Image.Image, color=(56, 189, 248)):
    draw = ImageDraw.Draw(im, "RGBA")
    W, H = im.size
    # Perspective cyber grid near bottom
    for y in range(int(H * 0.74), H, 18):
        draw.line([(0, y), (W, y)], fill=(*color, 35), width=1)
    for x in range(-W, W * 2, 48):
        draw.line([(W // 2, int(H * 0.62)), (x, H)], fill=(*color, 28), width=1)
    # Glowing corner telemetry brackets
    m = 14
    l = 28
    for (x0, y0, dx, dy) in [(m, m, 1, 1), (W - m, m, -1, 1), (m, H - m, 1, -1), (W - m, H - m, -1, -1)]:
        draw.line([(x0, y0), (x0 + dx * l, y0)], fill=(*color, 180), width=2)
        draw.line([(x0, y0), (x0, y0 + dy * l)], fill=(*color, 180), width=2)


def build_scifi_planet_bg():
    # Crop watermark off Flux bg-panorama.jpg if present and add glowing orbital rings + starfield
    bg_p = OUT / "bg-panorama.jpg"
    if bg_p.exists():
        im = Image.open(bg_p).convert("RGB")
        w, h = im.size
        im = im.crop((0, 0, w, max(100, h - 38))).resize((1280, 720), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(im, "RGBA")
        # Subtle starry sheen
        rng = np.random.default_rng(42)
        for _ in range(90):
            sx = int(rng.integers(0, 1280))
            sy = int(rng.integers(0, 260))
            draw.ellipse([sx, sy, sx + 2, sy + 2], fill=(186, 230, 253, 180))
        im.save(bg_p, "JPEG", quality=92, optimize=True)
        print("Polished scifi/bg-panorama.jpg")


def build_scifi_siege_env():
    # Alien exoplanet canyon at orbital dusk with ringed planet in sky
    im = Image.open(ART / "siege-env.jpg").convert("RGB").resize((1280, 620), Image.Resampling.LANCZOS)
    arr = np.asarray(im, dtype=np.float32) / 255.0
    H, W, _ = arr.shape
    lum = arr[:, :, 0] * 0.3 + arr[:, :, 1] * 0.59 + arr[:, :, 2] * 0.11
    sci = np.zeros_like(arr)
    sci[:, :, 0] = np.clip(lum * 0.32 + arr[:, :, 2] * 0.25, 0, 1)
    sci[:, :, 1] = np.clip(lum * 0.72 + 0.04, 0, 1)
    sci[:, :, 2] = np.clip(lum * 1.15 + 0.14, 0, 1)
    # Glowing cyan plasma river mist in center valley
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xn = xx / W
    yn = yy / H
    plasma = np.exp(-((yn - 0.76) ** 2) / 0.012) * np.exp(-((xn - 0.5) ** 2) / 0.08) * 0.38
    sci[:, :, 1] = np.clip(sci[:, :, 1] + plasma * 0.85, 0, 1)
    sci[:, :, 2] = np.clip(sci[:, :, 2] + plasma * 1.15, 0, 1)

    res = Image.fromarray((np.clip(sci, 0, 1) * 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(res, "RGBA")
    # Distant ringed exoplanet in sky
    px, py, pr = 640, 145, 76
    draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(30, 64, 115, 195), outline=(125, 211, 252, 160), width=2)
    draw.arc([px - 150, py - 24, px + 150, py + 24], 10, 170, fill=(125, 211, 252, 175), width=4)
    draw.arc([px - 170, py - 30, px + 170, py + 30], 15, 165, fill=(56, 189, 248, 110), width=2)
    res.save(OUT / "siege-env.jpg", "JPEG", quality=92, optimize=True)
    print("Saved scifi/siege-env.jpg")


if __name__ == "__main__":
    build_scifi_planet_bg()
    build_scifi_siege_env()
    sci_fi_grade(ART / "card-duel.jpg", OUT / "card-duel.jpg", "plasma", lambda im: overlay_hex_hud(im, (232, 121, 249)))
    sci_fi_grade(ART / "card-siege.jpg", OUT / "card-siege.jpg", "plasma", lambda im: overlay_hex_hud(im, (56, 189, 248)))
    sci_fi_grade(ART / "card-crown.jpg", OUT / "card-turnul.jpg", "cyan", lambda im: overlay_hex_hud(im, (56, 189, 248)))
    sci_fi_grade(ART / "card-map.jpg", OUT / "card-prc.jpg", "cyan", lambda im: overlay_hex_hud(im, (34, 211, 238)))
    sci_fi_grade(ART / "avatar-knight.jpg", OUT / "avatar-hero.jpg", "cyan", lambda im: overlay_hex_hud(im, (56, 189, 248)))
    sci_fi_grade(ART / "bg-arena-fight.jpg", OUT / "bg-arena-fight.jpg", "cyan", lambda im: overlay_hex_hud(im, (56, 189, 248)))
    print("All Sci-Fi art assets ready!")
