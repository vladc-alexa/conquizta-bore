# Build ultra-realistic, 3D-lit photogrammetry medieval castle towers, damaged/ruined towers,
# curtain walls, siege catapult (chassis + pivoting arm), and graded battlefield environment
# using real Poly Haven CC0 photographic textures (stone, slate roof, weathered wood, iron, terrain).
from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

TEX_DIR = Path("public/art/textures")
RAW_DIR = Path("public/art/pro_raw")
OUT_DIR = Path("public/art")


def load_tex(name: str, size=(512, 512)) -> np.ndarray:
    im = Image.open(TEX_DIR / f"{name}.jpg").convert("RGB").resize(size, Image.Resampling.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


STONE_TEX = load_tex("stone", (512, 512))
ROOF_TEX = load_tex("roof", (512, 512))
WOOD_TEX = load_tex("wood", (512, 512))
IRON_TEX = load_tex("iron", (512, 512))
GRASS_TEX = load_tex("grass", (512, 512))


def tile_sample(tex: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    th, tw, _ = tex.shape
    ix = (np.floor(u * tw).astype(np.int32)) % tw
    iy = (np.floor(v * th).astype(np.int32)) % th
    return tex[iy, ix]


def build_siege_environment():
    """Crop watermark from Flux valley image, warm-grade to dramatic sunset, blend rocky cliff plateaus."""
    raw_path = RAW_DIR / "siege-env.jpg"
    if raw_path.exists():
        im = Image.open(raw_path).convert("RGB")
        # Crop bottom 44px (removes watermark) & top 24px (removes letterbox bar)
        w, h = im.size
        im = im.crop((0, 24, w, h - 46)).resize((1280, 620), Image.Resampling.LANCZOS)
    else:
        im = Image.open(OUT_DIR / "bg-castle-panorama.jpg").convert("RGB").resize((1280, 620), Image.Resampling.LANCZOS)

    arr = np.asarray(im, dtype=np.float32) / 255.0
    H, W, _ = arr.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    yn = yy / H
    xn = xx / W

    # Warm golden-crimson sunset atmospheric grading
    sun_dx = xn - 0.5
    sun_dy = yn - 0.28
    sun_glow = np.exp(-(sun_dx * sun_dx * 3.8 + sun_dy * sun_dy * 6.5))
    arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.12 + sun_glow * 0.34, 0, 1)
    arr[:, :, 1] = np.clip(arr[:, :, 1] * 0.96 + sun_glow * 0.21, 0, 1)
    arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.80 + sun_glow * 0.06, 0, 1)

    # Subtle golden valley mist band in the mid-lower center
    mist = np.exp(-((yn - 0.66) ** 2) / 0.018) * np.exp(-((xn - 0.5) ** 2) / 0.14) * 0.26
    arr[:, :, 0] = np.clip(arr[:, :, 0] + mist * 1.0, 0, 1)
    arr[:, :, 1] = np.clip(arr[:, :, 1] + mist * 0.82, 0, 1)
    arr[:, :, 2] = np.clip(arr[:, :, 2] + mist * 0.58, 0, 1)

    # Render realistic rocky cliff plateaus on left and right for the castles & catapults
    # Plateau top sits cleanly around y = 0.80 * H with natural craggy edges dipping into the central valley
    cliff_y = np.full((W,), H * 0.80, dtype=np.float32)
    for x in range(W):
        t = x / W
        if 0.34 < t < 0.66:
            # Valley dip in the center
            s = math.sin((t - 0.34) / 0.32 * math.pi)
            cliff_y[x] = H * (0.80 + 0.14 * s)
        # Subtle organic crag roughness
        cliff_y[x] += math.sin(x * 0.045) * 3.2 + math.cos(x * 0.11) * 1.8

    ground_mask = yy >= cliff_y[None, :]
    # Sample real photogrammetry rocky terrain + castle rock strata
    terrain = tile_sample(GRASS_TEX, xn * 3.2, yn * 2.2)
    rock = tile_sample(STONE_TEX, xn * 3.6, yn * 2.6) * 0.72
    depth = np.clip((yy - cliff_y[None, :]) / (H * 0.18), 0, 1)
    cliff_col = terrain * (1 - depth[:, :, None] * 0.65) + rock * (depth[:, :, None] * 0.65)
    # Lush mossy grass rim along the plateau top edge
    rim = np.exp(-((yy - cliff_y[None, :] - 4.0) ** 2) / 42.0) * ground_mask
    cliff_col[:, :, 0] = np.clip(cliff_col[:, :, 0] * 0.75 + rim * 0.06, 0, 1)
    cliff_col[:, :, 1] = np.clip(cliff_col[:, :, 1] * 0.84 + rim * 0.16, 0, 1)
    cliff_col[:, :, 2] = np.clip(cliff_col[:, :, 2] * 0.65 + rim * 0.03, 0, 1)
    # Darken lower cliff face for grounded depth
    cliff_col *= (1.0 - depth[:, :, None] * 0.45)

    # Smooth antialiased blend at cliff silhouette
    edge_alpha = np.clip((yy - cliff_y[None, :] + 2.0) / 4.0, 0, 1)[:, :, None]
    arr = arr * (1 - edge_alpha) + cliff_col * edge_alpha

    out = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")
    out.save(OUT_DIR / "siege-env.jpg", "JPEG", quality=92, optimize=True)
    print("Saved photorealistic siege-env.jpg")


def build_tower_sprite(team: str, damaged: bool, out_name: str):
    """Render a 3D cylindrical photogrammetry medieval stone tower sprite with RGBA transparency."""
    W, H = 260, 440
    rgba = np.zeros((H, W, 4), dtype=np.float32)

    cx = W * 0.5
    base_y = H - 14
    shaft_top = 152
    shaft_bot = base_y
    shaft_r_top = 58.0
    shaft_r_bot = 66.0  # slight medieval batter / taper for realism!

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    # Team accent tints
    if team == "red":
        roof_tint = np.array([0.85, 0.34, 0.30], dtype=np.float32)
        flag_col = np.array([0.76, 0.12, 0.14], dtype=np.float32)
        light_dir_x = 0.58  # sunlit on right facing center sunset
    else:
        roof_tint = np.array([0.30, 0.48, 0.86], dtype=np.float32)
        flag_col = np.array([0.14, 0.34, 0.78], dtype=np.float32)
        light_dir_x = -0.58  # sunlit on left facing center sunset

    # 1. Cylindrical Stone Tower Shaft with real photogrammetry castle_wall_slates
    t_y = np.clip((yy - shaft_top) / (shaft_bot - shaft_top), 0, 1)
    r_at_y = shaft_r_top + (shaft_r_bot - shaft_r_top) * t_y
    dx = xx - cx
    in_shaft = (yy >= shaft_top) & (yy <= shaft_bot) & (np.abs(dx) <= r_at_y)

    # Cylindrical UV projection & true 3D surface normal
    nx = np.clip(dx / np.maximum(r_at_y, 1.0), -1.0, 1.0)
    nz = np.sqrt(np.maximum(0.0, 1.0 - nx * nx))
    u_cyl = (np.arcsin(nx) / math.pi + 0.5) * 1.15
    v_cyl = t_y * 1.75
    stone = tile_sample(STONE_TEX, u_cyl, v_cyl)

    # Slight warm/cool stone tone shift by faction
    if team == "blue":
        stone = stone * np.array([0.88, 0.93, 1.02], dtype=np.float32)
    else:
        stone = stone * np.array([1.03, 0.97, 0.90], dtype=np.float32)

    # 3D Sunset Key Light + Sky Ambient + Rim + Bottom Ground AO + Top Corbel Shadow
    ndotl = np.clip(nx * light_dir_x + nz * 0.78, 0.0, 1.0)
    rim = np.power(1.0 - nz, 2.4) * np.clip(nx * light_dir_x * 1.6, 0.0, 1.0)
    top_ao = 0.52 + 0.48 * np.clip((yy - shaft_top) / 26.0, 0, 1)
    bot_ao = 0.65 + 0.35 * np.clip((shaft_bot - yy) / 38.0, 0, 1)
    # Stone normal bump contrast from texture luminance
    lum = stone[:, :, 0] * 0.3 + stone[:, :, 1] * 0.59 + stone[:, :, 2] * 0.11
    lit_stone = stone * (0.28 + 0.88 * ndotl[:, :, None]) * top_ao[:, :, None] * bot_ao[:, :, None]
    # Add warm golden sunset rim highlight
    lit_stone[:, :, 0] += rim * 0.42
    lit_stone[:, :, 1] += rim * 0.28
    lit_stone[:, :, 2] += rim * 0.12

    rgba[in_shaft, :3] = np.clip(lit_stone[in_shaft], 0, 1)
    rgba[in_shaft, 3] = 1.0

    # 2. Recessed Arched Stone Windows with Warm Torch Glow
    for wy, wh, ww in [(208, 34, 15), (298, 34, 15)]:
        win_mask = (
            (np.abs(dx) <= ww * 0.5) & (yy >= wy) & (yy <= wy + wh)
        ) | (
            ((dx) ** 2 + (yy - wy) ** 2 <= (ww * 0.5) ** 2) & (yy <= wy)
        )
        # Outer carved stone frame reveal
        frame_mask = (
            (np.abs(dx) <= ww * 0.5 + 4) & (yy >= wy - 2) & (yy <= wy + wh + 4)
        ) | (
            ((dx) ** 2 + (yy - wy) ** 2 <= (ww * 0.5 + 4) ** 2) & (yy <= wy)
        )
        frame_only = frame_mask & (~win_mask) & in_shaft
        rgba[frame_only, :3] *= 0.55
        # Glowing amber torch window interior
        glow_y = np.clip((yy - (wy - ww * 0.5)) / (wh + ww * 0.5), 0, 1)
        win_col = np.zeros_like(rgba[:, :, :3])
        win_col[:, :, 0] = 0.98 - 0.38 * glow_y
        win_col[:, :, 1] = 0.78 - 0.46 * glow_y
        win_col[:, :, 2] = 0.32 - 0.24 * glow_y
        # Dark iron mullion bars
        bar = (np.abs(dx) < 1.3) | (np.abs(yy - (wy + wh * 0.45)) < 1.3)
        win_col[bar] *= 0.22
        rgba[win_mask, :3] = win_col[win_mask]
        rgba[win_mask, 3] = 1.0

    # 3. Projecting Corbelled Stone Battlements / Crenellations
    parapet_top = 122
    parapet_bot = 156
    parapet_r = 68.0
    in_parapet = (yy >= parapet_top) & (yy <= parapet_bot) & (np.abs(dx) <= parapet_r)
    # 5 Stone Merlons along the top
    merlon_top = 104
    merlon_mask = np.zeros((H, W), dtype=bool)
    for mx in np.linspace(-58, 58, 5):
        merlon_mask |= (yy >= merlon_top) & (yy <= parapet_top + 2) & (np.abs(dx - mx) <= 10.5)
    crown_mask = in_parapet | merlon_mask

    nx_p = np.clip(dx / parapet_r, -1.0, 1.0)
    nz_p = np.sqrt(np.maximum(0.0, 1.0 - nx_p * nx_p))
    ndotl_p = np.clip(nx_p * light_dir_x + nz_p * 0.82, 0.0, 1.0)
    p_stone = tile_sample(STONE_TEX, (nx_p + 1) * 0.55, (yy - merlon_top) / 140.0)
    if team == "blue":
        p_stone = p_stone * np.array([0.90, 0.95, 1.04], dtype=np.float32)
    lit_p = p_stone * (0.34 + 0.86 * ndotl_p[:, :, None])
    # Machicolation dark shadow arches under parapet rim
    corbel = (yy >= parapet_bot - 10) & (yy <= parapet_bot) & (((dx + 64) % 16) < 7)
    lit_p[corbel] *= 0.42
    rgba[crown_mask, :3] = np.clip(lit_p[crown_mask], 0, 1)
    rgba[crown_mask, 3] = 1.0

    # 4. Steep Conical Shingled Slate Roof (real grey_roof_01 photogrammetry texture!)
    roof_peak_y = 26
    roof_base_y = 112
    roof_half_w = 64.0
    t_r = (yy - roof_peak_y) / (roof_base_y - roof_peak_y)
    r_lim = t_r * roof_half_w
    in_roof = (yy >= roof_peak_y) & (yy <= roof_base_y) & (np.abs(dx) <= r_lim)
    # Slightly behind merlons so battlements overlap the eaves naturally!
    roof_vis = in_roof & (~merlon_mask)
    nx_r = np.clip(dx / np.maximum(r_lim, 1.0), -1.0, 1.0)
    nz_r = np.sqrt(np.maximum(0.0, 1.0 - nx_r * nx_r))
    ndotl_r = np.clip(nx_r * light_dir_x + nz_r * 0.72 + 0.15, 0.0, 1.0)
    roof_tex = tile_sample(ROOF_TEX, (nx_r + 1.0) * 0.75, t_r * 1.4)
    lit_roof = (roof_tex * 0.65 + roof_tex * roof_tint * 0.75) * (0.30 + 0.95 * ndotl_r[:, :, None])
    # Gold roof trim rim at eaves
    eaves = roof_vis & (yy >= roof_base_y - 4)
    lit_roof[eaves] = np.array([0.85, 0.66, 0.28], dtype=np.float32)
    rgba[roof_vis, :3] = np.clip(lit_roof[roof_vis], 0, 1)
    rgba[roof_vis, 3] = 1.0

    # 5. If DAMAGED (Blow 1 of 2): Carve organic jagged blasted crater + broken battlement + soot + glowing fire core!
    if damaged:
        side_sign = 1 if team == "red" else -1
        bx = cx + side_sign * 34
        by = 205
        ang = np.arctan2(yy - by, xx - bx)
        jagged = 30.0 + 7.5 * np.sin(ang * 5.0 + 0.6) + 4.5 * np.cos(ang * 11.0 - 0.3) + 2.5 * np.sin(ang * 17.0)
        dist = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)

        # Dark scorch & soot plume rising above the impact crater
        soot_dx = (xx - (cx + side_sign * 20)) / 36.0
        soot_dy = (yy - (by - 28)) / 62.0
        soot = np.exp(-(soot_dx * soot_dx + soot_dy * soot_dy)) * (rgba[:, :, 3] > 0)
        rgba[:, :, :3] *= (1.0 - soot[:, :, None] * 0.65)

        # Deep shadowed & glowing interior cavity inside the masonry breach
        inner_breach = (dist < jagged) & in_shaft
        fire_core = np.clip(1.0 - dist / (jagged * 0.92), 0, 1)
        rgba[inner_breach, 0] = np.clip(0.14 + np.power(fire_core[inner_breach], 1.1) * 0.95, 0, 1)
        rgba[inner_breach, 1] = np.clip(0.05 + np.power(fire_core[inner_breach], 1.9) * 0.65, 0, 1)
        rgba[inner_breach, 2] = np.clip(0.03 + np.power(fire_core[inner_breach], 3.2) * 0.18, 0, 1)
        rgba[inner_breach, 3] = 1.0

        # Jagged blasted-out chunk on the outer silhouette edge (organic curved bite, never a straight line!)
        outer_x = cx + side_sign * 56
        outer_ang = np.arctan2(yy - by, xx - outer_x)
        outer_r = 26.0 + 6.0 * np.sin(outer_ang * 6.0) + 3.5 * np.cos(outer_ang * 11.0)
        outer_blast = np.sqrt((xx - outer_x) ** 2 + (yy - by) ** 2) < outer_r
        rgba[outer_blast, 3] = 0.0

        # Organic shattered parapet corner (chipped circular bite out of upper right/left merlon)
        px = cx + side_sign * 54
        py = 114
        pang = np.arctan2(yy - py, xx - px)
        prad = 25.0 + 5.0 * np.sin(pang * 7.0) + 3.0 * np.cos(pang * 13.0)
        parapet_chip = np.sqrt((xx - px) ** 2 + (yy - py) ** 2) < prad
        rgba[parapet_chip, 3] = 0.0

    # Convert to Pillow for crisp flagpole, realistic folded banner, stone cracks, and subtle outline
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(im)

    # Golden finial & flagpole
    pole_x = int(cx)
    draw.line([(pole_x, 28), (pole_x, 4)], fill=(235, 194, 96, 255), width=3)
    draw.ellipse([pole_x - 4, 2, pole_x + 4, 10], fill=(252, 220, 128, 255), outline=(90, 56, 14, 255))

    # Realistic waving cloth silk banner
    fdir = 1 if team == "red" else -1
    f_rgb = tuple(int(c * 255) for c in flag_col)
    f_dark = tuple(int(c * 170) for c in flag_col)
    pts = [
        (pole_x + fdir * 2, 7),
        (pole_x + fdir * 22, 10),
        (pole_x + fdir * 42, 6 if not damaged else 12),
        (pole_x + fdir * 34, 17),
        (pole_x + fdir * 42, 26 if not damaged else 22),
        (pole_x + fdir * 20, 24),
        (pole_x + fdir * 2, 26),
    ]
    draw.polygon(pts, fill=(*f_rgb, 255), outline=(230, 185, 85, 255))
    # Banner cloth fold shadow
    draw.line([(pole_x + fdir * 18, 9), (pole_x + fdir * 16, 24)], fill=(*f_dark, 210), width=3)

    if damaged:
        # Jagged dark structural masonry cracks running down the stonework
        crack_pts = [
            [(int(cx) - 4, 212), (int(cx) - 18, 246), (int(cx) - 8, 274), (int(cx) - 24, 318)],
            [(int(cx) + 12, 224), (int(cx) + 2, 262), (int(cx) + 16, 298)],
            [(int(cx) - 26, 158), (int(cx) - 14, 186), (int(cx) - 28, 208)],
        ]
        for line in crack_pts:
            draw.line(line, fill=(18, 12, 10, 235), width=3)

    im.save(OUT_DIR / f"{out_name}.png", "PNG", optimize=True)
    print(f"Built photorealistic {out_name}.png ({im.size[0]}x{im.size[1]})")


def build_ruins_sprite():
    """Photorealistic demolished stone tower ruins with fallen masonry heap & glowing embers."""
    W, H = 240, 130
    rgba = np.zeros((H, W, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx = W * 0.5
    base_y = H - 10

    # Jagged broken stone rubble mound profile
    profile = np.zeros((W,), dtype=np.float32)
    for x in range(W):
        dx = abs(x - cx) / (W * 0.44)
        if dx < 1.0:
            hill = (1.0 - dx * dx) * 58.0
            # Left & right jagged standing wall stubs
            stub_l = 32.0 * math.exp(-((x - (cx - 48)) ** 2) / 140.0)
            stub_r = 26.0 * math.exp(-((x - (cx + 44)) ** 2) / 160.0)
            crag = 7.0 * math.sin(x * 0.22) + 4.5 * math.cos(x * 0.41)
            profile[x] = base_y - max(0.0, hill + stub_l + stub_r + crag)
        else:
            profile[x] = base_y + 10

    mask = (yy >= profile[None, :]) & (yy <= base_y)
    stone = tile_sample(STONE_TEX, xx / 180.0, yy / 150.0)
    # Darken & scorch masonry ruins
    h_frac = np.clip((base_y - yy) / 70.0, 0, 1)
    lit = stone * (0.42 + 0.48 * h_frac[:, :, None])
    # Glowing fiery embers nestled in the center rubble
    ember = np.exp(-(((xx - cx) ** 2) / 700.0 + ((yy - (base_y - 24)) ** 2) / 180.0))
    lit[:, :, 0] = np.clip(lit[:, :, 0] + ember * 0.85, 0, 1)
    lit[:, :, 1] = np.clip(lit[:, :, 1] + ember * 0.34, 0, 1)
    lit[:, :, 2] = np.clip(lit[:, :, 2] + ember * 0.06, 0, 1)

    rgba[mask, :3] = lit[mask]
    rgba[mask, 3] = 1.0

    im = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(im)
    # Splintered charred wooden beams jutting from ruins
    draw.line([(72, 92), (118, 46)], fill=(48, 28, 16, 255), width=6)
    draw.line([(168, 96), (132, 54)], fill=(42, 24, 14, 255), width=5)
    im.save(OUT_DIR / "tower-ruins.png", "PNG", optimize=True)
    print("Built photorealistic tower-ruins.png")


def build_catapult_sprites():
    """Build separate photorealistic wood+iron catapult CHASSIS and pivoting THROWING ARM sprites!"""
    # 1. CHASSIS (facing RIGHT)
    W, H = 220, 150
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wood_im = Image.open(TEX_DIR / "wood.jpg").convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    wood_im = ImageEnhance.Brightness(wood_im).enhance(1.65)
    wood_im = ImageEnhance.Color(wood_im).enhance(1.25)
    # Warm weathered oak tint
    w_arr = np.asarray(wood_im, dtype=np.float32)
    w_arr[:, :, 0] = np.clip(w_arr[:, :, 0] * 1.28 + 38, 0, 255)
    w_arr[:, :, 1] = np.clip(w_arr[:, :, 1] * 0.96 + 18, 0, 255)
    w_arr[:, :, 2] = np.clip(w_arr[:, :, 2] * 0.62 + 6, 0, 255)
    oak = Image.fromarray(w_arr.astype(np.uint8), "RGB")

    iron_im = Image.open(TEX_DIR / "iron.jpg").convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    iron_im = ImageEnhance.Brightness(iron_im).enhance(0.9)

    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    # Heavy horizontal oak sill beam
    md.rounded_rectangle([30, 102, 188, 122], radius=4, fill=255)
    # Angled heavy A-frame upright timbers
    md.polygon([(68, 104), (104, 34), (124, 34), (92, 104)], fill=255)
    md.polygon([(142, 104), (112, 34), (128, 34), (164, 104)], fill=255)
    # Crossbar & tension brace
    md.rectangle([82, 46, 142, 62], fill=255)
    md.rectangle([72, 82, 152, 95], fill=255)

    im.paste(oak, (0, 0), mask)
    draw = ImageDraw.Draw(im)

    # Dark bevel shadows & forged iron reinforcement brackets + rivets
    draw.rounded_rectangle([30, 102, 188, 122], radius=4, outline=(28, 16, 8, 255), width=3)
    draw.polygon([(68, 104), (104, 34), (124, 34), (92, 104)], outline=(28, 16, 8, 255), width=2)
    draw.polygon([(142, 104), (112, 34), (128, 34), (164, 104)], outline=(28, 16, 8, 255), width=2)

    # Forged iron brackets & rivets
    for bx, by, bw, bh in [(98, 34, 30, 18), (64, 98, 24, 26), (144, 98, 24, 26), (104, 80, 22, 18)]:
        draw.rectangle([bx, by, bx + bw, by + bh], fill=(74, 78, 86, 255), outline=(22, 24, 28, 255), width=2)
        for rx, ry in [(bx + 5, by + 5), (bx + bw - 5, by + 5), (bx + 5, by + bh - 5), (bx + bw - 5, by + bh - 5)]:
            draw.ellipse([rx - 2, ry - 2, rx + 2, ry + 2], fill=(210, 190, 140, 255))

    # Coiled hemp torsion rope skein at the pivot hub (x=114, y=94)
    for i in range(6):
        rx = 101 + i * 4
        draw.line([(rx, 86), (rx + 2, 114)], fill=(196, 162, 102, 255), width=3)
        draw.line([(rx + 1, 86), (rx + 3, 114)], fill=(120, 92, 48, 255), width=1)

    # Heavy spoked wooden wheels with forged iron tires
    for wx in (62, 160):
        wy = 122
        r = 24
        draw.ellipse([wx - r, wy - r, wx + r, wy + r], fill=(42, 44, 50, 255), outline=(18, 18, 22, 255), width=2)
        draw.ellipse([wx - r + 4, wy - r + 4, wx + r - 4, wy + r - 4], fill=(112, 68, 32, 255), outline=(36, 20, 10, 255), width=2)
        draw.ellipse([wx - r + 10, wy - r + 10, wx + r - 10, wy + r - 10], fill=(0, 0, 0, 0))
        # 8 spokes
        for s in range(8):
            ang = s * math.pi / 4
            draw.line(
                [(wx + math.cos(ang) * 5, wy + math.sin(ang) * 5), (wx + math.cos(ang) * (r - 5), wy + math.sin(ang) * (r - 5))],
                fill=(96, 56, 26, 255),
                width=4,
            )
        # Iron wheel hub & brass axle cap
        draw.ellipse([wx - 7, wy - 7, wx + 7, wy + 7], fill=(70, 74, 82, 255), outline=(22, 24, 28, 255), width=2)
        draw.ellipse([wx - 3, wy - 3, wx + 3, wy + 3], fill=(225, 185, 92, 255))

    im.save(OUT_DIR / "catapult-chassis.png", "PNG", optimize=True)

    # 2. PIVOTING OAK THROWING ARM (pivot at right-center x=140, y=30; sling cup at left x=22, y=28)
    AW, AH = 160, 60
    arm = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arm)
    # Tapered oak throwing beam
    ad.polygon([(24, 24), (146, 22), (146, 37), (24, 34)], fill=(122, 74, 34, 255), outline=(30, 16, 8, 255))
    # Iron straps along arm
    for sx in (52, 94, 130):
        ad.rectangle([sx, 22, sx + 9, 37], fill=(74, 78, 86, 255), outline=(20, 22, 26, 255), width=2)
    # Forged iron & leather sling cup on the left end
    ad.pieslice([4, 10, 40, 46], 110, 320, fill=(68, 38, 18, 255), outline=(210, 170, 92, 255), width=2)
    ad.ellipse([132, 22, 148, 38], fill=(82, 86, 94, 255), outline=(24, 24, 28, 255), width=2)
    arm.save(OUT_DIR / "catapult-arm.png", "PNG", optimize=True)
    print("Built photorealistic catapult-chassis.png & catapult-arm.png")


def build_castle_wall_sprite():
    """Photorealistic crenellated medieval stone curtain wall connecting the 3 castle towers."""
    W, H = 260, 110
    rgba = np.zeros((H, W, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    wall_top = 34
    in_wall = (yy >= wall_top) & (yy <= H - 4)
    merlons = (yy >= 16) & (yy <= wall_top + 2) & (((xx + 8) % 34) < 20)
    mask = in_wall | merlons

    stone = tile_sample(STONE_TEX, xx / 200.0, yy / 150.0)
    top_ao = 0.72 + 0.28 * np.clip((yy - wall_top) / 18.0, 0, 1)
    bot_ao = 0.62 + 0.38 * np.clip((H - yy) / 26.0, 0, 1)
    lit = stone * top_ao[:, :, None] * bot_ao[:, :, None] * 0.88

    rgba[mask, :3] = np.clip(lit[mask], 0, 1)
    rgba[mask, 3] = 1.0

    # Arched heavy oak castle portcullis gate in center of curtain wall
    gx = W * 0.5
    gy = H - 4
    in_gate = (np.abs(xx - gx) <= 22) & (yy >= gy - 46) & (yy <= gy)
    in_arch = ((xx - gx) ** 2 + (yy - (gy - 46)) ** 2 <= 22 ** 2) & (yy <= gy - 46)
    gate = in_gate | in_arch
    wood = tile_sample(WOOD_TEX, xx / 90.0, yy / 90.0) * np.array([0.75, 0.55, 0.35], dtype=np.float32)
    rgba[gate, :3] = np.clip(wood[gate], 0, 1)

    im = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(im)
    # Iron portcullis grille bars
    for bx in range(int(gx - 18), int(gx + 19), 9):
        draw.line([(bx, int(gy - 60)), (bx, int(gy))], fill=(32, 34, 40, 220), width=2)
    for by in range(int(gy - 52), int(gy), 14):
        draw.line([(int(gx - 22), by), (int(gx + 22), by)], fill=(32, 34, 40, 220), width=2)

    im.save(OUT_DIR / "castle-wall.png", "PNG", optimize=True)
    print("Built photorealistic castle-wall.png")


if __name__ == "__main__":
    build_siege_environment()
    build_tower_sprite("red", False, "tower-intact-red")
    build_tower_sprite("red", True, "tower-damaged-red")
    build_tower_sprite("blue", False, "tower-intact-blue")
    build_tower_sprite("blue", True, "tower-damaged-blue")
    build_ruins_sprite()
    build_catapult_sprites()
    build_castle_wall_sprite()
    print("ALL photorealistic PBR sprites built cleanly!")
