// Fetch 1,000 brand-new unique English multiple-choice trivia questions (deduplicated against existing data/questions-en.json)
// using The Trivia API v2 (fast, clean UTF-8) + Open Trivia DB fallback, then split into 10 translation chunks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ADD_TARGET = 1000;
const EN_PATH = resolve(process.cwd(), "data/questions-en.json");
const CHUNK_DIR = "C:/Users/User/.gemini/antigravity/brain/97613a72-fd11-4fc2-8737-e0ee9e7cef47/scratch/tr2";

const TRIVIA_API_CAT_MAP = {
  music: "Entertainment: Music",
  sport_and_leisure: "Sports",
  film_and_tv: "Entertainment: Film",
  arts_and_literature: "Entertainment: Books",
  history: "History",
  society_and_culture: "General Knowledge",
  science: "Science & Nature",
  geography: "Geography",
  food_and_drink: "General Knowledge",
  general_knowledge: "General Knowledge",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function diffToInt(d) {
  if (d === "easy") return 1;
  if (d === "medium") return 2;
  if (d === "hard") return 3;
  return 2;
}

function decodeHtml(str) {
  return String(str ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&hellip;/g, "...")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "—")
    .replace(/&eacute;/g, "é")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

async function main() {
  const existingRaw = JSON.parse(readFileSync(EN_PATH, "utf8"));
  const existing = existingRaw.questions ?? [];
  const seen = new Set(existing.map((q) => String(q.prompt).toLowerCase().trim()));
  const added = [];
  let nextNum = existing.length + 1;

  // Pass 1: The Trivia API v2 (fast, diverse categories)
  const categories = Object.keys(TRIVIA_API_CAT_MAP);
  for (let round = 0; round < 35 && added.length < ADD_TARGET; round++) {
    const cat = categories[round % categories.length];
    const url = `https://the-trivia-api.com/v2/questions?limit=50&categories=${encodeURIComponent(cat)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Trivia API HTTP ${res.status}, pausing...`);
        await sleep(1000);
        continue;
      }
      const items = await res.json();
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const prompt = String(item?.question?.text ?? "").trim();
        const key = prompt.toLowerCase();
        if (!prompt || prompt.length < 10 || seen.has(key)) continue;
        const correct = String(item.correctAnswer ?? "").trim();
        const incorrect = (item.incorrectAnswers || []).map((s) => String(s ?? "").trim()).filter(Boolean);
        if (!correct || incorrect.length !== 3) continue;
        // Avoid duplicate options inside same question
        if (new Set([correct, ...incorrect].map((s) => s.toLowerCase())).size !== 4) continue;

        seen.add(key);
        added.push({
          id: `trivia-${nextNum++}`,
          category: TRIVIA_API_CAT_MAP[item.category] || "General Knowledge",
          difficulty: diffToInt(item.difficulty),
          prompt,
          options: [correct, ...incorrect],
          correctIndex: 0,
          source: "the-trivia-api",
        });
        if (added.length >= ADD_TARGET) break;
      }
      if ((round + 1) % 5 === 0 || added.length >= ADD_TARGET) {
        console.log(`The Trivia API pass ${round + 1}: +${added.length}/${ADD_TARGET} new unique questions`);
      }
      await sleep(220);
    } catch (err) {
      console.warn(`Trivia API err: ${err.message}`);
      await sleep(600);
    }
  }

  // Pass 2: Open Trivia DB top-up if still short of 1,000
  if (added.length < ADD_TARGET) {
    console.log(`Topping up remaining ${ADD_TARGET - added.length} from OpenTDB...`);
    const tokenRes = await fetch("https://opentdb.com/api_token.php?command=request");
    const token = (await tokenRes.json())?.token;
    let attempts = 0;
    while (added.length < ADD_TARGET && attempts < 20 && token) {
      attempts++;
      const res = await fetch(`https://opentdb.com/api.php?amount=50&type=multiple&token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        await sleep(5500);
        continue;
      }
      const data = await res.json();
      if (data.response_code === 5) {
        await sleep(5500);
        continue;
      }
      if (data.response_code !== 0 || !Array.isArray(data.results)) break;
      for (const item of data.results) {
        const prompt = decodeHtml(item.question);
        const key = prompt.toLowerCase();
        if (!prompt || seen.has(key)) continue;
        const correct = decodeHtml(item.correct_answer);
        const incorrect = (item.incorrect_answers || []).map(decodeHtml).filter(Boolean);
        if (!correct || incorrect.length !== 3) continue;
        seen.add(key);
        added.push({
          id: `opentdb-${nextNum++}`,
          category: decodeHtml(item.category) || "General Knowledge",
          difficulty: diffToInt(item.difficulty),
          prompt,
          options: [correct, ...incorrect],
          correctIndex: 0,
          source: "opentdb",
        });
        if (added.length >= ADD_TARGET) break;
      }
      console.log(`OpenTDB pass ${attempts}: +${added.length}/${ADD_TARGET}`);
      if (added.length < ADD_TARGET) await sleep(5300);
    }
  }

  // Save updated English bank (existing 500 + new 1,000 = 1,500)
  const combined = [...existing, ...added];
  writeFileSync(
    EN_PATH,
    JSON.stringify({ count: combined.length, updatedAt: new Date().toISOString(), questions: combined }, null, 2)
  );

  // Stage 10 chunks of 100 new questions for parallel Romanian translation
  mkdirSync(CHUNK_DIR, { recursive: true });
  writeFileSync(resolve(CHUNK_DIR, "new_mc_en.json"), JSON.stringify(added));
  for (let i = 0; i < 10; i++) {
    const slice = added.slice(i * 100, (i + 1) * 100).map((q) => ({ id: q.id, p: q.prompt, o: q.options }));
    writeFileSync(resolve(CHUNK_DIR, `mc_${i}.json`), JSON.stringify(slice));
  }
  console.log(`DONE! Added ${added.length} new unique EN questions (total EN MC: ${combined.length}) and wrote 10 translation chunks.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
