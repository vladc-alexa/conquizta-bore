// Download genuine CC0 photogrammetry textures from Poly Haven (stone wall, slate roof, oak wood, rusty iron)
// and real recorded CC0/public-domain medieval & siege audio effects from Wikimedia Commons.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEX_DIR = resolve(process.cwd(), "public/art/textures");
const SFX_DIR = resolve(process.cwd(), "public/sfx");
mkdirSync(TEX_DIR, { recursive: true });
mkdirSync(SFX_DIR, { recursive: true });

async function downloadPolyHavenTextures() {
  const res = await fetch("https://api.polyhaven.com/assets?t=textures", {
    headers: { "User-Agent": "StoneQuizAssetBuilder/1.0" },
  });
  const all = await res.json();
  const entries = Object.entries(all);

  const pickAsset = (patterns) => {
    for (const pat of patterns) {
      const hit = entries.find(([id, meta]) => {
        const hay = `${id} ${meta.name} ${(meta.tags || []).join(" ")}`.toLowerCase();
        return pat.test(hay);
      });
      if (hit) return hit[0];
    }
    return null;
  };

  const targets = {
    stone: pickAsset([/castle.*wall/, /medieval.*stone/, /stone.*wall/, /cobblestone/]),
    roof: pickAsset([/roof.*slate/, /slate.*roof/, /roof.*tile/, /shingle/]),
    wood: pickAsset([/weathered.*wood/, /oak.*wood/, /wood.*plank/, /bark.*brown/]),
    iron: pickAsset([/rust.*metal/, /corrugated.*iron/, /metal.*plate/, /iron/]),
    grass: pickAsset([/forest.*ground/, /rocky.*grass/, /grass.*ground/, /mud.*grass/]),
  };

  console.log("Selected Poly Haven CC0 textures:", targets);

  for (const [key, assetId] of Object.entries(targets)) {
    if (!assetId) continue;
    const fRes = await fetch(`https://api.polyhaven.com/files/${assetId}`, {
      headers: { "User-Agent": "StoneQuizAssetBuilder/1.0" },
    });
    const files = await fRes.json();
    const diffUrl =
      files?.Diffuse?.["1k"]?.jpg?.url ||
      files?.Diffuse?.["1k"]?.png?.url ||
      files?.col?.["1k"]?.jpg?.url;
    if (!diffUrl) {
      console.warn(`No 1k diffuse for ${assetId}`);
      continue;
    }
    const imgRes = await fetch(diffUrl);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(resolve(TEX_DIR, `${key}.jpg`), buf);
    console.log(`Saved CC0 texture ${key}.jpg (${Math.round(buf.length / 1024)} KB) from ${assetId}`);
  }
}

async function fetchWikimediaAudio(fileTitle, outName) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    fileTitle
  )}&prop=imageinfo&iiprop=url|mime|size&format=json`;
  const res = await fetch(api, { headers: { "User-Agent": "StoneQuizAssetBuilder/1.0" } });
  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {});
  const info = pages?.[0]?.imageinfo?.[0];
  if (!info?.url) {
    console.warn(`Audio not found: ${fileTitle}`);
    return null;
  }
  const aRes = await fetch(info.url, { headers: { "User-Agent": "StoneQuizAssetBuilder/1.0" } });
  if (!aRes.ok) {
    console.warn(`Failed downloading ${fileTitle}: HTTP ${aRes.status}`);
    return null;
  }
  const buf = Buffer.from(await aRes.arrayBuffer());
  const ext = info.url.split(".").pop().split("?")[0].toLowerCase();
  const outPath = resolve(SFX_DIR, `${outName}.${ext}`);
  writeFileSync(outPath, buf);
  console.log(`Saved real audio ${outName}.${ext} (${Math.round(buf.length / 1024)} KB)`);
  return `${outName}.${ext}`;
}

async function main() {
  await downloadPolyHavenTextures();

  // Search for a few more real sound effects (stone crumble, whoosh, wood crack)
  const searchOne = async (q) => {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=5&format=json&srsearch=${encodeURIComponent(
      q + " filetype:audio"
    )}`;
    const r = await fetch(u, { headers: { "User-Agent": "StoneQuizAssetBuilder/1.0" } });
    const d = await r.json();
    const hits = (d.query?.search || []).filter((s) => /\.(ogg|mp3|wav)$/i.test(s.title));
    return hits[0]?.title || null;
  };

  const audioJobs = [
    ["File:Explosion 10.ogg", "explosion"],
    ["File:Explosion-LS100155.ogg", "demolish"],
    ["File:Metal Hit (Gravity Sound).mp3", "metal_hit"],
    ["File:Shofar.ogg", "war_horn"],
  ];

  const crumbleTitle = await searchOne("rock fall OR landslide OR rubble");
  if (crumbleTitle) audioJobs.push([crumbleTitle, "crumble"]);
  const whooshTitle = await searchOne("whoosh OR fireball");
  if (whooshTitle) audioJobs.push([whooshTitle, "whoosh"]);

  for (const [title, name] of audioJobs) {
    try {
      await fetchWikimediaAudio(title, name);
    } catch (e) {
      console.warn(`Audio skip ${title}: ${e.message}`);
    }
  }
  console.log("Done downloading CC0 textures & real recorded SFX!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
