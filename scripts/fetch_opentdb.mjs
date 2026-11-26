// Fetch 500 unique English multiple-choice trivia questions from Open Trivia Database
// (with automatic fallback to The Trivia API v2 if rate-limited), decode HTML entities,
// deduplicate, and save to data/questions-en.json.
//
// Usage: node scripts/fetch_opentdb.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TARGET = 500;
const OUT_PATH = resolve(process.cwd(), "data/questions-en.json");

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
    .replace(/&deg;/g, "°")
    .replace(/&eacute;/g, "é")
    .replace(/&aacute;/g, "á")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&ouml;/g, "ö")
    .replace(/&auml;/g, "ä")
    .replace(/&pi;/g, "π")
    .replace(/&shy;/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function diffToInt(d) {
  if (d === "easy") return 1;
  if (d === "medium") return 2;
  if (d === "hard") return 3;
  return 2;
}

async function fetchFromOpenTDB(seen, collected) {
  console.log("Requesting OpenTDB session token...");
  const tokenRes = await fetch("https://opentdb.com/api_token.php?command=request");
  if (!tokenRes.ok) throw new Error(`Token request failed: ${tokenRes.status}`);
  const tokenJson = await tokenRes.json();
  const token = tokenJson.token;
  if (!token) throw new Error("No OpenTDB token returned");

  let attempts = 0;
  while (collected.length < TARGET && attempts < 18) {
    attempts++;
    const needed = Math.min(50, TARGET - collected.length);
    const url = `https://opentdb.com/api.php?amount=${needed}&type=multiple&token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (res.status === 429) {
      console.log(`OpenTDB 429 rate limit, waiting 6s... (${collected.length}/${TARGET})`);
      await sleep(6000);
      continue;
    }
    if (!res.ok) {
      console.log(`OpenTDB HTTP ${res.status}, stopping OpenTDB pass.`);
      break;
    }
    const data = await res.json();
    if (data.response_code === 5) {
      console.log(`OpenTDB response_code 5 (rate limit), waiting 6s...`);
      await sleep(6000);
      continue;
    }
    if (data.response_code !== 0 || !Array.isArray(data.results) || data.results.length === 0) {
      console.log(`OpenTDB response_code=${data.response_code}, ending OpenTDB pass.`);
      break;
    }

    for (const item of data.results) {
      const prompt = decodeHtml(item.question);
      const key = prompt.toLowerCase();
      if (!prompt || seen.has(key)) continue;
      const correct = decodeHtml(item.correct_answer);
      const incorrect = (item.incorrect_answers || []).map(decodeHtml).filter(Boolean);
      if (!correct || incorrect.length !== 3) continue;
      seen.add(key);
      collected.push({
        id: `opentdb-${collected.length + 1}`,
        category: decodeHtml(item.category) || "General Knowledge",
        difficulty: diffToInt(item.difficulty),
        prompt,
        options: [correct, ...incorrect],
        correctIndex: 0,
        source: "opentdb",
      });
      if (collected.length >= TARGET) break;
    }
    console.log(`OpenTDB batch ${attempts}: ${collected.length}/${TARGET} questions`);
    if (collected.length < TARGET) {
      await sleep(5300);
    }
  }
}

async function fetchFromTheTriviaApi(seen, collected) {
  let attempts = 0;
  while (collected.length < TARGET && attempts < 16) {
    attempts++;
    const needed = Math.min(50, TARGET - collected.length);
    const res = await fetch(`https://the-trivia-api.com/v2/questions?limit=${needed}`);
    if (!res.ok) {
      console.log(`The Trivia API HTTP ${res.status}`);
      break;
    }
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    for (const item of items) {
      const prompt = String(item?.question?.text ?? "").trim();
      const key = prompt.toLowerCase();
      if (!prompt || seen.has(key)) continue;
      const correct = String(item.correctAnswer ?? "").trim();
      const incorrect = (item.incorrectAnswers || []).map((s) => String(s ?? "").trim()).filter(Boolean);
      if (!correct || incorrect.length !== 3) continue;
      seen.add(key);
      collected.push({
        id: `trivia-${collected.length + 1}`,
        category: String(item.category ?? "General Knowledge").replace(/_/g, " "),
        difficulty: diffToInt(item.difficulty),
        prompt,
        options: [correct, ...incorrect],
        correctIndex: 0,
        source: "the-trivia-api",
      });
      if (collected.length >= TARGET) break;
    }
    console.log(`The Trivia API batch ${attempts}: ${collected.length}/${TARGET} questions`);
    await sleep(400);
  }
}

async function main() {
  const seen = new Set();
  const collected = [];

  try {
    await fetchFromOpenTDB(seen, collected);
  } catch (err) {
    console.warn("OpenTDB error:", err.message);
  }

  if (collected.length < TARGET) {
    console.log(`Topping up from The Trivia API (${collected.length}/${TARGET})...`);
    try {
      await fetchFromTheTriviaApi(seen, collected);
    } catch (err) {
      console.warn("The Trivia API error:", err.message);
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ count: collected.length, updatedAt: new Date().toISOString(), questions: collected }, null, 2));
  console.log(`Saved ${collected.length} questions to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
