#!/usr/bin/env python3
"""Generate La Carciuma art with Gemini (nano-banana).

  background.webp        empty tavern + wooden table
  patron-<slug>-<mood>.webp   waist-up patron, green keyed out

Moods: idle, grin, drunk, out. Variants are made image-to-image from the idle
sprite so the character stays the same. Run: python3 scripts/gen-carciuma-art.py
"""
import base64
import io
import json
import os
import pathlib
import sys
import time

import requests
from PIL import Image

KEY = os.environ.get("GEMINI_IMAGE_KEY") or os.environ.get("GOOGLE_API_KEY")
MODEL = "gemini-2.5-flash-image"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
OUT = pathlib.Path(os.environ.get("ART_OUT", "public/carciuma"))
OUT.mkdir(parents=True, exist_ok=True)

STYLE = (
    "2D adventure game art in the style of a modern Monkey Island remaster: "
    "smooth hand-painted digital illustration, clean confident ink outlines, "
    "soft painterly shading, warm lantern light, muted teal-and-amber palette. "
    "Absolutely not pixel art, no dithering, no text, no watermark."
)

BACKGROUND = (
    "Wide 16:9 tavern interior at night, camera at seated eye level looking across a "
    "big scarred wooden table that fills the lower third of the frame, the table is "
    "EMPTY (no people, no glasses). Behind the table: plaster wall with dark timber "
    "beams, two hanging iron lanterns with warm glow, shelves of dusty bottles, a small "
    "window with deep blue night sky, a barrel and a broom in the corner. " + STYLE
)

PATRONS = {
    "costel": (
        "waist-up portrait of an old Romanian peasant drinker, about 70, weathered sunburnt "
        "face with deep wrinkles, big grey walrus moustache, flat wool cap, brown embroidered "
        "vest over a cream shirt, seated at a table, facing the viewer, hands resting forward, "
        "kind tired eyes"
    ),
    "bogdan": (
        "waist-up portrait of a huge bald blacksmith in his forties, thick black beard, broken "
        "nose, bushy eyebrows, red linen shirt with rolled sleeves, leather apron strap, seated "
        "at a table facing the viewer, massive shoulders, warm grin"
    ),
    "mirela": (
        "waist-up portrait of a sharp-eyed tavern keeper woman in her fifties, dark hair pulled "
        "back in a bun with a few loose strands, gold hoop earrings, deep green dress with a "
        "laced bodice, arms crossed on a table, facing the viewer, knowing smirk"
    ),
    "doru": (
        "waist-up portrait of a lean young carter in his late twenties, short ruffled dark hair, "
        "stubble, patched leather jacket over a grey woollen shirt, seated at a table facing the "
        "viewer, restless crooked grin"
    ),
    "roxana": (
        "waist-up portrait of a cheerful village woman in her thirties, long chestnut braid over "
        "one shoulder, rosy cheeks, embroidered white blouse with red thread, red headscarf, "
        "seated at a table facing the viewer, bright laugh"
    ),
}

TABLE = (
    "Game asset: a round wooden card table seen from a slightly raised front angle, like the "
    "table in an online poker room. Thick polished walnut rim with a carved edge, dark green "
    "felt surface in the middle with a subtle stitch border, four small brass cup holders in "
    "the felt, completely EMPTY (no people, no cards, no chips, no glasses). Centred, whole "
    "table visible, symmetric ellipse. Flat uniform sage-green backdrop, nothing else in "
    "frame. " + STYLE
)

MOODS = {
    "grin": "a huge toothy laugh, eyes squeezed shut with joy, head tilted slightly back",
    "drunk": "very drunk: flushed red cheeks and nose, glassy half-closed eyes, lopsided silly grin, hair mussed",
    "out": "passed out cold: eyes closed, head slumped back, mouth hanging open, completely limp",
}

BACKS = {
    "doru": (
        "seen from BEHIND (back of the head and shoulders only, no face visible): a lean man in "
        "his thirties with short dark hair, brown leather jacket, sitting at a table, shoulders "
        "hunched forward"
    ),
    "roxana": (
        "seen from BEHIND (back of the head and shoulders only, no face visible): a woman in her "
        "thirties with a long dark braid down her back, rust-red blouse, sitting at a table"
    ),
}

CHROMA = (
    "The subject is cut out on a completely flat, uniform, bright chroma-key green (#00FF00) "
    "background with no gradient, no shadow on the background, no props behind the character. "
    "Character fully inside the frame, centered, waist-up, generous margins."
)


def call(parts, tries=3):
    body = {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0.9}}
    for attempt in range(tries):
        r = requests.post(URL, params={"key": KEY}, json=body, timeout=180)
        if r.status_code == 200:
            data = r.json()
            for cand in data.get("candidates", []):
                for p in cand.get("content", {}).get("parts", []):
                    blob = p.get("inlineData") or p.get("inline_data")
                    if blob and blob.get("data"):
                        return base64.b64decode(blob["data"])
            print("  no image in response:", json.dumps(data)[:400], file=sys.stderr)
        else:
            print(f"  HTTP {r.status_code}: {r.text[:300]}", file=sys.stderr)
        time.sleep(4 * (attempt + 1))
    raise RuntimeError("generation failed")


def key_out_green(raw: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    px = img.load()
    w, h = img.size
    # flood fill from the border so green inside the character (a bottle, an
    # eye) survives; tolerance is generous because the model is never exact.
    from collections import deque

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))

    def is_green(r, g, b):
        return g > 90 and g > r * 1.5 and g > b * 1.5

    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        r, g, b, a = px[x, y]
        if not is_green(r, g, b):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    # trim to content, keep a little air
    bbox = img.split()[3].getbbox()
    if bbox:
        img = img.crop(bbox)
    return img


def save(img, name: str, max_w: int = 900):
    if isinstance(img, (bytes, bytearray)):
        img = Image.open(io.BytesIO(img)).convert("RGB")
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    path = OUT / f"{name}.webp"
    img.save(path, "WEBP", quality=88, method=6)
    print(f"  -> {path} {img.size}")


def main():
    if not KEY:
        sys.exit("GEMINI_IMAGE_KEY missing")

    print("background")
    raw = call([{"text": BACKGROUND}])
    bg = Image.open(io.BytesIO(raw)).convert("RGB")
    save(bg, "background", max_w=1600)

    for slug, desc in PATRONS.items():
        print(f"patron {slug} idle")
        raw = call([{"text": f"Character sprite: {desc}. {CHROMA} {STYLE}"}])
        sprite = key_out_green(raw)
        save(sprite, f"patron-{slug}-idle")
        for mood, mood_desc in MOODS.items():
            print(f"patron {slug} {mood}")
            b64 = base64.b64encode(raw).decode()
            parts = [
                {"text": (
                    "Keep this exact character, same pose, same framing, same lighting, same flat "
                    f"green background. Change ONLY the facial expression and head angle to {mood_desc}. "
                    "Do not add props, do not move the body. " + STYLE
                )},
                {"inline_data": {"mime_type": "image/png", "data": b64}},
            ]
            try:
                vraw = call(parts)
                save(vraw, f"patron-{slug}-{mood}")
            except Exception as exc:  # keep going: idle still works
                print(f"  !! {slug}/{mood} failed: {exc}", file=sys.stderr)

    print("table")
    traw = call([{"text": TABLE}])
    save(traw, "table")

    for slug, desc in BACKS.items():
        print(f"back {slug}")
        raw = call([{"text": f"Character sprite: {desc}. {CHROMA} {STYLE}"}])
        save(raw, f"patron-{slug}-back")

    print("done")


if __name__ == "__main__":
    main()
