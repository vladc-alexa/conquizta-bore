// Translate data/questions-en.json (500 MC) and data/questions-numeric-en.json (60 numeric)
// into Romanian (data/questions-ro.json and data/questions-numeric-ro.json) using batched
// Google Translate public endpoint with delimiter packing so all 560 questions translate cleanly & fast.
//
// Usage: node scripts/translate_questions_ro.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MC_IN = resolve(process.cwd(), "data/questions-en.json");
const MC_OUT = resolve(process.cwd(), "data/questions-ro.json");
const NUM_IN = resolve(process.cwd(), "data/questions-numeric-en.json");
const NUM_OUT = resolve(process.cwd(), "data/questions-numeric-ro.json");

const CATEGORY_MAP_RO = {
  "General Knowledge": "Cultură Generală",
  "Entertainment: Books": "Divertisment: Cărți",
  "Entertainment: Film": "Divertisment: Filme",
  "Entertainment: Music": "Divertisment: Muzică",
  "Entertainment: Musicals & Theatres": "Divertisment: Teatru și Musical",
  "Entertainment: Television": "Divertisment: Televiziune",
  "Entertainment: Video Games": "Divertisment: Jocuri Video",
  "Entertainment: Board Games": "Divertisment: Jocuri de Societate",
  "Entertainment: Comics": "Divertisment: Benzi Desenate",
  "Entertainment: Japanese Anime & Manga": "Divertisment: Anime și Manga",
  "Entertainment: Cartoon & Animations": "Divertisment: Desene Animate",
  "Science & Nature": "Știință și Natură",
  "Science: Computers": "Știință: Calculatoare",
  "Science: Mathematics": "Știință: Matematică",
  "Science: Gadgets": "Știință: Gadgeturi",
  "Mythology": "Mitologie",
  "Sports": "Sport",
  "Geography": "Geografie",
  "History": "Istorie",
  "Politics": "Politică",
  "Art": "Artă",
  "Celebrities": "Celebrități",
  "Animals": "Animale",
  "Vehicles": "Vehicule",
  "Science": "Știință",
  "Technology": "Tehnologie",
  "Entertainment": "Divertisment",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateChunk(texts, sl = "en", tl = "ro") {
  // Pack strings separated by unique newline marker unlikely to be altered
  const SEP = "\n|||QSEP|||\n";
  const joined = texts.join(SEP);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(joined)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) {
    throw new Error(`Translate HTTP ${res.status}`);
  }
  const data = await res.json();
  const full = Array.isArray(data?.[0]) ? data[0].map((seg) => seg?.[0] ?? "").join("") : "";
  const parts = full.split(/\s*\|\|\|\s*QSEP\s*\|\|\|\s*/i).map((s) => s.trim());
  if (parts.length !== texts.length) {
    // Fallback: translate items individually if separator count drifted
    const individual = [];
    for (const item of texts) {
      const u2 = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(item)}`;
      const r2 = await fetch(u2, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r2.ok) {
        individual.push(item);
        continue;
      }
      const d2 = await r2.json();
      const s2 = Array.isArray(d2?.[0]) ? d2[0].map((seg) => seg?.[0] ?? "").join("").trim() : item;
      individual.push(s2 || item);
      await sleep(80);
    }
    return individual;
  }
  return parts;
}

async function translateBatchArray(items, batchSize = 18) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    let translated = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        translated = await translateChunk(slice);
        break;
      } catch (err) {
        console.warn(`Batch ${i} attempt ${attempt + 1} failed: ${err.message}`);
        await sleep(1200 * (attempt + 1));
      }
    }
    if (!translated) translated = slice;
    for (let j = 0; j < slice.length; j++) {
      out[i + j] = translated[j] || slice[j];
    }
    if ((i / batchSize) % 10 === 0) {
      console.log(`Translated ${Math.min(i + batchSize, items.length)} / ${items.length} strings...`);
    }
    await sleep(180);
  }
  return out;
}

async function main() {
  // 1. Multiple choice 500 questions
  const mcRaw = JSON.parse(readFileSync(MC_IN, "utf8"));
  const mcList = mcRaw.questions ?? [];
  console.log(`Translating ${mcList.length} multiple-choice questions to Romanian...`);

  // Flatten prompts + 4 options per question -> 2500 short strings
  const mcStrings = [];
  for (const q of mcList) {
    mcStrings.push(q.prompt);
    for (const opt of q.options) {
      mcStrings.push(opt);
    }
  }

  const mcTranslated = await translateBatchArray(mcStrings, 25);
  const mcRo = [];
  let cursor = 0;
  for (const q of mcList) {
    const promptRo = mcTranslated[cursor++];
    const optsRo = [
      mcTranslated[cursor++],
      mcTranslated[cursor++],
      mcTranslated[cursor++],
      mcTranslated[cursor++],
    ];
    mcRo.push({
      id: q.id,
      categoryEn: q.category,
      category: CATEGORY_MAP_RO[q.category] || q.category,
      difficulty: q.difficulty ?? 2,
      prompt: promptRo,
      options: optsRo,
      correctIndex: q.correctIndex,
      source: q.source || "opentdb",
    });
  }
  writeFileSync(MC_OUT, JSON.stringify({ count: mcRo.length, lang: "ro", updatedAt: new Date().toISOString(), questions: mcRo }, null, 2));
  console.log(`Saved ${mcRo.length} Romanian MC questions to ${MC_OUT}`);

  // 2. Numeric 60 questions
  if (existsSync(NUM_IN)) {
    const numRaw = JSON.parse(readFileSync(NUM_IN, "utf8"));
    const numList = numRaw.questions ?? [];
    console.log(`Translating ${numList.length} numeric questions to Romanian...`);
    const prompts = numList.map((q) => q.prompt);
    const translatedPrompts = await translateBatchArray(prompts, 20);
    const numRo = numList.map((q, idx) => ({
      id: q.id,
      categoryEn: q.category,
      category: CATEGORY_MAP_RO[q.category] || q.category,
      prompt: translatedPrompts[idx],
      answer: q.answer,
    }));
    writeFileSync(NUM_OUT, JSON.stringify({ count: numRo.length, lang: "ro", updatedAt: new Date().toISOString(), questions: numRo }, null, 2));
    console.log(`Saved ${numRo.length} Romanian numeric questions to ${NUM_OUT}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
