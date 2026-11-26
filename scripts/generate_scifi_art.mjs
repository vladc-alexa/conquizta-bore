// Generate Sci-Fi art assets for the Sci-Fi theme mode in public/art/scifi/ using Flux.
// Usage: node scripts/generate_scifi_art.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "public/art/scifi");
mkdirSync(OUT_DIR, { recursive: true });

const JOBS = [
  {
    name: "bg-panorama",
    w: 1280,
    h: 720,
    seed: 711,
    prompt:
      "futuristic sci-fi orbital citadel and neon cyber fortress on a dark rocky exoplanet cliff at twilight, glowing cyan and magenta energy shields, distant ringed gas giant planet in starry sky, holographic energy bridges, cinematic sci-fi concept art, no text no ui",
  },
  {
    name: "card-duel",
    w: 576,
    h: 768,
    seed: 712,
    prompt:
      "sci-fi fantasy card art, two futuristic armored cyber knights in profile clashing glowing plasma energy swords in the center with explosive cyan and crimson sparks, dark metallic arena background, ultra detailed digital painting, no text no borders",
  },
  {
    name: "card-siege",
    w: 576,
    h: 768,
    seed: 713,
    prompt:
      "sci-fi fantasy card art, futuristic heavy plasma siege cannon launching a blazing cyan-orange energy orb across a neon battlefield toward a towering steel fortress with three energy-shielded towers, sparks and dramatic lighting, no text no borders",
  },
  {
    name: "card-turnul",
    w: 576,
    h: 768,
    seed: 714,
    prompt:
      "sci-fi fantasy card art, colossal futuristic obsidian and neon-cyan spire tower rising into swirling orbital storm clouds with glowing holographic beacon at the summit and crackling blue plasma lightning, ultra detailed, no text no borders",
  },
  {
    name: "card-prc",
    w: 576,
    h: 768,
    seed: 715,
    prompt:
      "sci-fi fantasy card art, glowing holographic 3D star map and tactical cybernetic datapad resting on dark brushed titanium desk with neon cyan and amber light trails, futuristic strategy game art, no text no borders",
  },
  {
    name: "avatar-hero",
    w: 512,
    h: 512,
    seed: 716,
    prompt:
      "sci-fi RPG character portrait, noble bearded space knight commander wearing sleek dark titanium exo-armor with glowing cyan visor trim and crimson tactical cloak, dramatic neon rim lighting, centered face and shoulders, no text no frame",
  },
  {
    name: "bg-arena-fight",
    w: 1280,
    h: 720,
    seed: 717,
    prompt:
      "2D side-view futuristic sci-fi colosseum fighting game stage, flat metallic alloy combat deck in foreground flanked by glowing cyan plasma pylons and holographic banners, cheering spectators in upper cybernetic tiers under starry nebula sky, no characters in center, no text",
  },
  {
    name: "siege-env",
    w: 1280,
    h: 720,
    seed: 718,
    prompt:
      "photorealistic sci-fi alien mountain canyon battlefield at twilight, two wide flat dark basalt cliff plateaus on the far left and far right separated by a glowing misty plasma gorge in the center, ringed planet in sky, empty plateaus with no buildings no characters no text",
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateOne(job) {
  const outPath = resolve(OUT_DIR, `${job.name}.jpg`);
  if (existsSync(outPath)) {
    console.log(`Skip existing ${job.name}.jpg`);
    return;
  }
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    job.prompt
  )}?width=${job.w}&height=${job.h}&seed=${job.seed}&model=flux&nologo=true`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "StoneQuizSciFiArt/1.0" } });
      if (!res.ok) {
        console.warn(`[${job.name}] attempt ${attempt} HTTP ${res.status}`);
        await sleep(attempt * 3000);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8000) {
        await sleep(3000);
        continue;
      }
      writeFileSync(outPath, buf);
      console.log(`Generated scifi/${job.name}.jpg (${Math.round(buf.length / 1024)} KB)`);
      return;
    } catch (err) {
      console.warn(`[${job.name}] err: ${err.message}`);
      await sleep(3000);
    }
  }
  console.warn(`Could not generate scifi/${job.name}.jpg`);
}

async function main() {
  for (const job of JOBS) {
    await generateOne(job);
    await sleep(2200);
  }
  console.log("Sci-Fi art generation complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
