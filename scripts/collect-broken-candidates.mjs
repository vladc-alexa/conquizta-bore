/** collect-broken-candidates.mjs — Bucket 3 detector: published questions whose
 *  text is malformed (truncated head, scrambled word order, stray tokens/nicknames,
 *  corrupted options). Writes ids for scripts/repair-questions.mjs.
 *    node --env-file=.env scripts/collect-broken-candidates.mjs
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
const prisma = new PrismaClient();

const NICK = /^(st0?ner?|the?runner|ecountry|frankcastle|neovortex|dalmacijo|perseu|miorlau|cioflicel|khamikon|ionutign|malasorte|porumbi|berrybubble|lancelbot|jordash\d*|margi\d*|dragos\d+|danil\d+|ish2l|glggl3s|bolojanar|amenra|vladdd|costel)$/i;

function broken(s) {
  const t = (s || "").trim();
  if (!t) return "empty";
  const fa = (t.match(/[A-Za-zăâîșțĂÂÎȘȚ]/) || [""])[0];
  if (fa && fa === fa.toLowerCase()) return "lowercase-start"; // truncated head
  if (/^the\s+[A-Z]/.test(t)) return "stray-the";
  if (/,\s+(Din|Care|Ce|Cum|Unde|Cine|În|La)\b/.test(t)) return "two-heads";
  if (/~|\bmbinat\b|rCCL|\bllui\b|ind esti/.test(t)) return "garbage-token";
  if (/\b(stone|st0ne|st0ner|therunner|frankcastle|neovortex|dalmacijo|miorlau|cioflicel)\b/i.test(t)) return "nick-in-prompt";
  if (!/[?]$/.test(t) && t.split(/\s+/).length < 6) return "short-noQ";
  return null;
}

const rows = await prisma.question.findMany({ where: { isPublished: true }, include: { options: true } });
const cand = {};
const add = (id, w) => { (cand[id] ||= new Set()).add(w); };
const old = JSON.parse(fs.readFileSync("audit/recovery/merged/final-flags.json", "utf8"));
const KEEP = new Set(["confirmed", "escalated", "missed-by-flash", "unconfirmed"]);
const oldP = new Set(old.filter((r) => KEEP.has(r.decision)).map((r) => r.id));
for (const r of rows) {
  if (r.options.some((o) => NICK.test(o.text.trim()))) add(r.id, "stray-nick-option");
  const b = broken(r.prompt);
  if (b) add(r.id, b);
  if (oldP.has(r.id)) add(r.id, "old-flag");
}
fs.writeFileSync("audit/broken-candidates.txt", Object.keys(cand).join("\n"));
fs.writeFileSync("audit/broken-candidates.json", JSON.stringify(Object.fromEntries(Object.entries(cand).map(([k, v]) => [k, [...v]])), null, 0));
const byW = {};
for (const s of Object.values(cand)) for (const w of s) byW[w] = (byW[w] || 0) + 1;
console.log(`candidates: ${Object.keys(cand).length}`, byW);
await prisma.$disconnect();
