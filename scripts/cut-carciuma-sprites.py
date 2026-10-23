#!/usr/bin/env python3
"""Cut the generated patrons out of their green screen and off their table edge.

Raw art lives in /tmp/carciuma-raw (ART_OUT=/tmp/carciuma-raw python3 scripts/gen-carciuma-art.py).
This pass keys the flat sage backdrop and crops where the painted table begins,
so each sprite ends exactly at the table surface it will be composited onto.
"""
import pathlib
from collections import deque

import numpy as np
from PIL import Image

RAW = pathlib.Path("/tmp/carciuma-raw")
OUT = pathlib.Path("public/carciuma")
OUT.mkdir(parents=True, exist_ok=True)
GREEN = np.array([161, 196, 91])


def key_green(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    a = np.array(im).astype(np.int16)
    h, w = a.shape[:2]
    dist = np.sqrt(((a[:, :, :3] - GREEN) ** 2).sum(axis=2))
    green = dist < 72
    green = np.logical_or(
        green,
        np.logical_and(
            np.logical_and(a[:, :, 1] > 95, a[:, :, 1] > a[:, :, 0] * 1.45),
            a[:, :, 1] > a[:, :, 2] * 1.45,
        ),
    )

    reach = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or reach[y, x]:
            continue
        reach[y, x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not reach[ny, nx] and green[ny, nx]:
                q.append((nx, ny))

    alpha = np.where(np.logical_and(reach, green), 0, 255).astype(np.uint8)
    a[:, :, 3] = alpha
    out = Image.fromarray(a.astype(np.uint8), "RGBA")

    arr = np.array(out).astype(np.int16)
    band = np.logical_and.reduce(
        (
            arr[:, :, 3] > 0,
            arr[:, :, 0] > arr[:, :, 1],
            arr[:, :, 1] >= arr[:, :, 2],
            (arr[:, :, 0] - arr[:, :, 2]) > 25,
            arr[:, :, 0] < 190,
        )
    )
    frac = band.mean(axis=1)
    cut = len(frac)
    for y in range(len(frac) - 1, max(len(frac) // 2, 0), -1):
        if frac[y] > 0.5:
            cut = y
        else:
            cut = min(len(frac), y + 4)
            break
    # kill the semi-transparent green halo the keying leaves on the edge
    a2 = np.array(out)
    a2[:, :, 3] = np.where(a2[:, :, 3] < 200, 0, 255)
    out = Image.fromarray(a2, "RGBA")
    out = out.crop((0, 0, w, max(cut, 40)))
    bbox = out.split()[3].getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def main() -> None:
    for p in sorted(RAW.glob("patron-*.webp")):
        im = key_green(Image.open(p))
        im.save(OUT / p.name, "WEBP", quality=92, method=6)
        print(f"{p.name} -> {im.size}")


if __name__ == "__main__":
    main()
