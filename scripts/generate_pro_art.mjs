// Generate photorealistic medieval siege towers, catapults, and environments sequentially using Flux.
// Usage: node scripts/generate_pro_art.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "public/art/pro_raw");
mkdirSync(OUT_DIR, { recursive: true });

const JOBS = [
  {
    name: "siege-env",
    w: 1280,
    h: 720,
    seed: 101,
    prompt:
      "photorealistic epic medieval mountain valley battlefield at golden crimson sunset, two wide flat grassy rocky cliff plateaus on the far left and far right separated by a misty river gorge in the center, dramatic sunlit clouds, atmospheric valley fog, cinematic film photography, empty grassy hilltops with no castles no buildings no people no text",
  },
  {
    name: "tower-intact-red",
    w: 576,
    h: 768,
    seed: 202,
    prompt:
      "photorealistic 2D front elevation medieval stone castle watchtower isolated centered on solid pure flat neon green #00FF00 greenscreen background, weathered grey limestone masonry blocks, crenelated stone battlements, dark slate conical roof, warm torchlit arched arrow slit windows, crimson red royal silk banner fluttering at the top, sunset side lighting, crisp game sprite silhouette, no ground, no scenery, pure green screen",
  },
  {
    name: "tower-damaged-red",
    w: 576,
    h: 768,
    seed: 203,
    prompt:
      "photorealistic 2D front elevation heavily damaged medieval stone castle watchtower isolated centered on solid pure flat neon green #00FF00 greenscreen background, weathered grey limestone masonry with huge jagged boulder impact crater breached into the upper wall, deep cracks, black scorch marks, glowing orange flames and fire burning inside the shattered battlements, torn crimson banner, dark slate roof cracked, crisp game sprite silhouette, no scenery, pure green screen",
  },
  {
    name: "tower-intact-blue",
    w: 576,
    h: 768,
    seed: 304,
    prompt:
      "photorealistic 2D front elevation medieval granite fortress tower isolated centered on solid pure flat neon green #00FF00 greenscreen background, dark grey carved granite blocks, stone battlements and machicolations, royal cobalt blue tiled conical roof, glowing amber arched windows, royal blue and gold heraldic flag fluttering at the spire, warm sunset lighting, crisp game sprite silhouette, no ground, no scenery, pure green screen",
  },
  {
    name: "tower-damaged-blue",
    w: 576,
    h: 768,
    seed: 305,
    prompt:
      "photorealistic 2D front elevation heavily damaged medieval granite fortress tower isolated centered on solid pure flat neon green #00FF00 greenscreen background, dark grey carved granite blocks with massive smashed crater in upper wall, shattered royal cobalt blue roof tiles, cracked stone battlements, charred black soot, bright orange fire and glowing embers burning inside the wall breach, torn blue banner, crisp game sprite silhouette, pure green screen",
  },
  {
    name: "tower-ruins",
    w: 640,
    h: 480,
    seed: 406,
    prompt:
      "photorealistic 2D side view completely demolished medieval stone tower ruins isolated centered on solid pure flat neon green #00FF00 greenscreen background, jagged broken lower limestone wall stubs, pile of shattered carved stone blocks and rubble, splintered charred wooden beams, glowing red fire embers on flat base, crisp game sprite, no background scenery, pure green screen",
  },
  {
    name: "catapult-body",
    w: 640,
    h: 480,
    seed: 507,
    prompt:
      "photorealistic 2D exact side profile medieval wooden siege catapult onager facing right, isolated centered on solid pure flat neon green #00FF00 greenscreen background, weathered dark oak heavy timber frame with forged iron plates and rivets, iron rimmed spoked wooden wheels, coiled hemp torsion rope, wooden throwing arm cocked back with leather sling holding a glowing flaming stone boulder, crisp game sprite silhouette, no ground shadow, pure green screen",
  },
  {
    name: "turnul-env",
    w: 1280,
    h: 720,
    seed: 608,
    prompt:
      "photorealistic cinematic medieval twilight mountain sky vista, dramatic swirling indigo and amber storm clouds, distant snow dusted craggy alpine peaks, golden sunbeams and lightning glow breaking through clouds, warm atmospheric mist, dark stone parapet silhouettes at far edges, epic fantasy film photography, no text no ui no characters",
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateOne(job) {
  const outPath = resolve(OUT_DIR, `${job.name}.jpg`);
  if (existsSync(outPath)) {
    console.log(`Skip existing ${job.name}.jpg`);
    return outPath;
  }

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    job.prompt
  )}?width=${job.w}&height=${job.h}&seed=${job.seed}&model=flux&nologo=true`;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 StoneQuizAssetGen/1.0" },
      });
      if (!res.ok) {
        console.warn(`[${job.name}] attempt ${attempt} HTTP ${res.status}, waiting ${attempt * 4}s...`);
        await sleep(attempt * 4000);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8000) {
        console.warn(`[${job.name}] attempt ${attempt} tiny response (${buf.length}B), retrying...`);
        await sleep(4000);
        continue;
      }
      writeFileSync(outPath, buf);
      console.log(`Generated ${job.name}.jpg (${Math.round(buf.length / 1024)} KB)`);
      return outPath;
    } catch (err) {
      console.warn(`[${job.name}] attempt ${attempt} error: ${err.message}`);
      await sleep(4000);
    }
  }
  console.warn(`WARN: Could not generate ${job.name}, continuing...`);
  return null;
}

async function main() {
  for (const job of JOBS) {
    await generateOne(job);
    await sleep(3500);
  }
  console.log("Finished Flux asset pass!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
