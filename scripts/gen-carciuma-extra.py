import base64
import importlib.util
import pathlib
import sys

spec = importlib.util.spec_from_file_location("gen", "scripts/gen-carciuma-art.py")
gen = importlib.util.module_from_spec(spec)
sys.modules["gen"] = gen
spec.loader.exec_module(gen)

for slug in ("doru", "roxana"):
    desc = gen.PATRONS[slug]
    print(f"patron {slug} idle")
    raw = gen.call([{"text": f"Character sprite: {desc}. {gen.CHROMA} {gen.STYLE}"}])
    gen.save(raw, f"patron-{slug}-idle")
    for mood, mood_desc in gen.MOODS.items():
        print(f"patron {slug} {mood}")
        parts = [
            {
                "text": (
                    "Keep this exact character, same pose, same framing, same lighting, same flat "
                    f"green background. Change ONLY the facial expression and head angle to {mood_desc}. "
                    "Do not add props, do not move the body. " + gen.STYLE
                )
            },
            {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(raw).decode()}},
        ]
        try:
            gen.save(gen.call(parts), f"patron-{slug}-{mood}")
        except Exception as exc:
            print(f"  !! {slug}/{mood}: {exc}", file=sys.stderr)

print("table")
gen.save(gen.call([{"text": gen.TABLE}]), "table")
print("done")
