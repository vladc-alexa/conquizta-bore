# Extract crisp transparent RGBA PNG sprites from chroma-key green (#00FF00) raw renders
# with flood-fill background detection, smooth alpha feathering, green-spill suppression,
# and tight auto-cropping.
from pathlib import Path
from collections import deque
from PIL import Image

RAW_DIR = Path("public/art/pro_raw")
OUT_DIR = Path("public/art")

SPRITES = [
    "tower-intact-red",
    "tower-damaged-red",
    "tower-intact-blue",
    "tower-damaged-blue",
    "tower-ruins",
    "catapult-body",
]

BACKGROUNDS = [
    "siege-env",
    "turnul-env",
]

def find_raw(name: str) -> Path:
    for ext in (".png", ".jpg", ".jpeg"):
        p = RAW_DIR / f"{name}{ext}"
        if p.exists():
            return p
    raise FileNotFoundError(f"Missing raw asset for {name}")

def green_dominance(r: int, g: int, b: int) -> float:
    return g - max(r, b)

def extract_chroma_sprite(src: Path, dst: Path):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    # 1. Flood-fill from all 4 borders to identify background green pixels (protects interior foliage/moss)
    visited = [[False] * w for _ in range(h)]
    is_bg = [[False] * w for _ in range(h)]
    q = deque()

    def try_seed(x, y):
        if visited[y][x]:
            return
        r, g, b, _ = px[x, y]
        if green_dominance(r, g, b) > 28 and g > 90:
            visited[y][x] = True
            is_bg[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, _ = px[nx, ny]
                # Generous threshold for border-connected green screen
                if green_dominance(r, g, b) > 22 and g > 75:
                    visited[ny][nx] = True
                    is_bg[ny][nx] = True
                    q.append((nx, ny))

    # 2. Also clear enclosed pure neon-green holes (e.g. inside catapult wheel spokes / truss gaps)
    for y in range(h):
        for x in range(w):
            if not is_bg[y][x]:
                r, g, b, _ = px[x, y]
                if green_dominance(r, g, b) > 65 and g > 140 and r < 150 and b < 150:
                    is_bg[y][x] = True

    # 3. Apply soft alpha + despill on edge pixels adjacent to background
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_bg[y][x]:
                px[x, y] = (0, 0, 0, 0)
            else:
                dom = green_dominance(r, g, b)
                # Check if touching a background pixel (1-2px halo zone)
                near_bg = False
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and is_bg[ny][nx]:
                            near_bg = True
                            break
                    if near_bg:
                        break
                if near_bg and dom > 10:
                    # Smooth edge alpha & neutralize green spill
                    new_a = int(max(0, min(255, 255 - (dom - 10) * 6.0)))
                    new_g = min(g, max(r, b))
                    px[x, y] = (r, new_g, b, new_a)
                elif dom > 18:
                    # Subtle despill inside edge
                    new_g = int(g - (dom - 18) * 0.75)
                    px[x, y] = (r, max(0, new_g), b, a)

    # 4. Tight crop to visible non-transparent bounds with small 4px padding
    bbox = im.getbbox()
    if bbox:
        left = max(0, bbox[0] - 4)
        top = max(0, bbox[1] - 4)
        right = min(w, bbox[2] + 4)
        bottom = min(h, bbox[3] + 4)
        im = im.crop((left, top, right, bottom))

    # Downscale nicely for fast web loading while remaining crisp Retina resolution
    im.thumbnail((720, 720), Image.Resampling.LANCZOS)
    im.save(dst, "PNG", optimize=True)
    print(f"Extracted transparent sprite -> {dst} ({im.size[0]}x{im.size[1]})")

def copy_bg(src: Path, dst: Path):
    im = Image.open(src).convert("RGB")
    im.thumbnail((1600, 960), Image.Resampling.LANCZOS)
    im.save(dst, "JPEG", quality=90, optimize=True)
    print(f"Saved environment backdrop -> {dst} ({im.size[0]}x{im.size[1]})")

for name in SPRITES:
    extract_chroma_sprite(find_raw(name), OUT_DIR / f"{name}.png")

for name in BACKGROUNDS:
    copy_bg(find_raw(name), OUT_DIR / f"{name}.jpg")

print("Sprite & backdrop extraction complete!")
