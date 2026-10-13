/**
 * normalize-text.mjs — Bucket 1: deterministic text repair for published questions.
 *
 * SAFE rules only (regex, no LLM, $0):
 *   PROMPTS : homoglyph fold + player-nickname removal + standalone 0 -> article "o"
 *   OPTIONS : homoglyph fold + standalone 0 -> article "o"  (NOTHING ELSE)
 *
 * Deliberately NOT done: "leet" digit->letter inside tokens. In a trivia DB,
 * alphanumeric tokens are usually real content (GPT-3, B12, CH4, C3H8, K-129,
 * GT350), so leet auto-fix corrupts far more than it repairs. Those go to review.
 *
 * SAFETY: dry-run by default. Nothing is written without --apply.
 *   node --env-file=.env scripts/normalize-text.mjs            # dry run -> audit/normalize-<ts>/
 *   node --env-file=.env scripts/normalize-text.mjs --apply    # writes + rollback.json
 * Repairs by row id only. Never re-imports. Never touches the report endpoint.
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join("audit", `normalize-${TS}`);
mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- rule data */

const HOMOGLYPHS = {
  "а": "a", "е": "e", "о": "o", "с": "c", "р": "p", "х": "x", "у": "y",
  "і": "i", "ѕ": "s", "ј": "j", "ԁ": "d", "ɡ": "g", "ν": "v", "ӏ": "l",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
  "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y", "Ѕ": "S", "І": "I", "Ј": "J",
};
const HOMO_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

// Measured player nicknames (from ~/cq2-logs-backup). Case-insensitive.
const NICKNAMES = new Set([
  "st0ne", "stone", "stoner", "stane", "stome", "zuu", "frankcastle", "neovortex",
  "therunner", "runner", "ecountry", "khamikon", "ionutign", "malasorte",
  "miorlau", "porumbi", "costel", "perseu", "vladdd", "cioflicel",
  "berrybubble", "lancelbot", "dalmacijo", "jordash", "margi",
  "egeo", "eistorie", "esport", "estiinta",
]);
const NICK_RE = new RegExp(`^(?:${[...NICKNAMES].join("|")})\\d*$`, "i");
const isKnownNick = (t) => NICKNAMES.has(t.toLowerCase()) || NICK_RE.test(t);

const STARTERS = new Set([
  "ce", "cine", "care", "cât", "cat", "câți", "cati", "câte", "cate",
  "câtă", "cata", "unde", "cum", "când", "cand", "cînd", "cît", "cit",
  "în", "in", "la", "din", "pe", "cu", "de", "prin", "între", "intre",
  "este", "sunt", "care", "cărei", "cărui", "câtor", "cei", "cea",
  "cel", "cele", "al", "ale", "ai", "căror", "câtorva",
]);

const hasDigitLetter = (t) => /\d/.test(t) && /[A-Za-zĂÂÎȘȚăâîșț]/.test(t);
const isCamel = (t) => /[a-zăâîșț][A-ZĂÂÎȘȚ]/.test(t);

/* --------------------------------------------------------------- normalizer */

const tidy = (s) => s.replace(/\s{2,}/g, " ").trim();

// standalone 0 that is really the Romanian article "o" (high-confidence shapes)
function fixArticleO(s) {
  return s
    .replace(/(?<=[a-zăâîșț])-0(?=[a-zăâîșț]|\s)/gu, "-o") // într-0, prin-0, dintr-0 ...
    .replace(/(?<=[a-zăâîșț])\s0\s(?=[a-zăâîșț])/gu, " o "); // este 0 comedie
}

function homoglyph(s) {
  if (!HOMO_RE.test(s)) return s;
  HOMO_RE.lastIndex = 0;
  return s.replace(HOMO_RE, (c) => HOMOGLYPHS[c]);
}

/**
 * @param {string} input
 * @param {"prompt"|"option"} scope
 */
function normalizeText(input, scope) {
  const rules = [];
  const review = [];
  let s = input;

  const h = homoglyph(s);
  if (h !== s) { s = h; rules.push("homoglyph"); }

  if (scope === "prompt") {
    // (a) nickname tokens anywhere (measured list only -> safe mid-sentence)
    const removed = [];
    const kept = s
      .split(/(\s+)/)
      .map((tok) => (tok.trim() && isKnownNick(tok.trim()) ? (removed.push(tok.trim()), "") : tok))
      .join("");
    if (removed.length) {
      s = tidy(kept);
      rules.push(`nickname-mid(${removed.join("/")})`);
    }

    // (b) leading prefixes: candidates = known nick | digit-bearing | CamelCase,
    //     accepted only if the remainder still starts with a real question word.
    const words = s.split(/\s+/);
    let cut = 0;
    while (cut < words.length && cut < 5) {
      const w = words[cut].replace(/^[^\p{L}\p{N}]+/u, "");
      if (isKnownNick(w) || hasDigitLetter(w) || isCamel(w)) cut++;
      else break;
    }
    if (cut > 0 && cut < words.length) {
      const rest = words.slice(cut).join(" ");
      const first = (rest.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-zăâîșț]/gi, "");
      const strictOnly = words.slice(0, cut).every((w) => isKnownNick(w.trim()) || hasDigitLetter(w));
      if (strictOnly || STARTERS.has(first)) {
        s = tidy(rest);
        rules.push(`nickname-prefix(${words.slice(0, cut).join(" ")})`);
      } else {
        review.push(`leading-camel kept: ${words.slice(0, cut).join(" ")}`);
      }
    }
  }

  const o = fixArticleO(s);
  if (o !== s) { s = o; rules.push("0->o"); }

  s = tidy(s);

  // review flags (never auto-fixed)
  if (/(?:^|[\s\-–—("'])0(?:$|[\s\-–—)"',.])/.test(s)) review.push("standalone 0 left (check)");
  if (scope === "option" && s.split(/\s+/).some((t) => isKnownNick(t))) review.push("nickname inside option");
  if (scope === "option" && hasDigitLetter(s.split(/\s+/)[0] ?? "")) review.push("option starts with alnum token");

  return { out: s, rules: rules.length ? rules : (s !== input ? ["whitespace"] : []), review };
}

/* ------------------------------------------------------------------- csv io */

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((v) => {
          const x = String(v ?? "");
          return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
        })
        .join(",")
    )
    .join("\n");

/* --------------------------------------------------------------------- main */

const rows = await prisma.question.findMany({
  where: { isPublished: true },
  include: { options: { orderBy: { position: "asc" } } },
  orderBy: { createdAt: "asc" },
});

const diff = [["id", "field", "before", "after", "rules"]];
const review = [["id", "field", "current", "note"]];
const changes = [];

for (const q of rows) {
  const p = normalizeText(q.prompt, "prompt");
  if (p.out && p.out !== q.prompt) {
    diff.push([q.id, "prompt", q.prompt, p.out, p.rules.join("+")]);
    changes.push({ kind: "q", id: q.id, field: "prompt", before: q.prompt, after: p.out });
  }
  p.review.forEach((n) => review.push([q.id, "prompt", q.prompt, n]));

  for (const opt of q.options) {
    const r = normalizeText(opt.text, "option");
    if (r.out && r.out !== opt.text) {
      diff.push([q.id, `opt${opt.position}`, opt.text, r.out, r.rules.join("+")]);
      changes.push({ kind: "o", id: opt.id, field: `opt${opt.position}`, before: opt.text, after: r.out });
    }
    r.review.forEach((n) => review.push([q.id, `opt${opt.position}`, opt.text, n]));
  }
}

writeFileSync(join(OUT, "diff.csv"), csv(diff));
writeFileSync(join(OUT, "review.csv"), csv(review));

const byRule = {};
for (const d of diff.slice(1)) byRule[d[4]] = (byRule[d[4]] ?? 0) + 1;

console.log(`OUT ${OUT}`);
console.log(`questions scanned : ${rows.length}`);
console.log(`field changes     : ${changes.length} (across ${new Set(changes.map((c) => c.id)).size} rows)`);
console.log(`review flags      : ${review.length - 1}`);
console.log("by rule:", JSON.stringify(byRule));
console.log(`\n${APPLY ? "APPLYING..." : "DRY RUN — rerun with --apply to write"}`);

if (APPLY) {
  writeFileSync(join(OUT, "rollback.json"), JSON.stringify(changes, null, 2));
  await prisma.$transaction(
    changes.map((c) =>
      c.kind === "q"
        ? prisma.question.update({ where: { id: c.id }, data: { prompt: c.after } })
        : prisma.questionOption.update({ where: { id: c.id }, data: { text: c.after } })
    )
  );
  console.log(`APPLIED ${changes.length} field(s). rollback -> ${join(OUT, "rollback.json")}`);
}

await prisma.$disconnect();
