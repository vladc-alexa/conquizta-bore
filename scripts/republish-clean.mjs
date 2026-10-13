/** republish-clean.mjs — after stripping the [gemini] tags, publish only the
 *  deactivated questions that are genuinely clean. Deliberately conservative:
 *  canonical eligibility (as scripts/publish_questions.mjs) AND a prompt-sanity
 *  gate AND not previously flagged/unpublished by any audit or remediation pass.
 *
 *   node --env-file=.env scripts/republish-clean.mjs          # dry run
 *   node --env-file=.env scripts/republish-clean.mjs --apply  # publish + rollback
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join("audit", `republish-clean-${TS}`);
fs.mkdirSync(OUT, { recursive: true });

const BAD = /gemini|gresit|greșit|local-ai|qwen|mistral|gemma|nașpa|naspă|naspa|coronect|răspuns corect|correct:|\bai\b|=>/i;
const NICK = /\b(st0?ner?|therunner|ecountry|frankcastle|neovortex|dalmacijo|miorlau|cioflicel|perseu|porumbi|costel|khamikon|jordash|malasorte|zuu|tunaru|neoyortex)\b/i;
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

// ids previously flagged or unpublished on purpose — never auto-republish these
const exclude = new Set();
const add = (arr, f = (x) => x) => arr.forEach((x) => { const v = f(x); if (v) exclude.add(v); });
try { add(JSON.parse(fs.readFileSync("audit/recovery/merged/final-flags.json", "utf8")), (e) => (/confirm|escalat|missed|unconfirm/.test(e.decision) ? e.id : null)); } catch {}
for (const d of fs.readdirSync("audit")) {
  const p = "audit/" + d;
  try {
    if (d.startsWith("five-answers")) add(JSON.parse(fs.readFileSync(path.join(p, "rollback.json"), "utf8")), (e) => e.id);
    if (d.startsWith("repair")) add(JSON.parse(fs.readFileSync(path.join(p, "plan.json"), "utf8")), (e) => (e.action === "review" || e.action === "drop" ? e.id : null));
    if (d.startsWith("reconstruct")) add(JSON.parse(fs.readFileSync(path.join(p, "plan.json"), "utf8")), (e) => (e.status !== "ready" ? e.id : null));
  } catch {}
}

const users = await prisma.user.findMany({ select: { displayName: true } });
const players = new Set(users.map((u) => norm(u.displayName)));

const rows = await prisma.question.findMany({
  where: { isPublished: false },
  select: { id: true, prompt: true, options: { select: { text: true, isCorrect: true } } },
});

const pass = [];
const reasons = {};
for (const q of rows) {
  if (exclude.has(q.id)) { reasons.excluded = (reasons.excluded || 0) + 1; continue; }
  const p = q.prompt.trim();
  const qm = (p.match(/\?/g) || []).length;
  const promptOk =
    p.length >= 12 && /^[A-ZĂÂÎȘȚ]/.test(p) && !BAD.test(p) && !NICK.test(p) &&
    !/[\[\]~]/.test(p) && !/\bthe\b/i.test(p) && !/\b(stone|st0ne|st0ner)\b/i.test(p) &&
    qm === 1 && /\?["'”]?$/.test(p) && p.split(/\s+/).length >= 4 &&
    !/(?<=[a-zăâîșț])-0(?=[a-zăâîșț]|\s)|\s0\s(?=[a-zăâîșț])/.test(p);
  if (!promptOk) { reasons.prompt = (reasons.prompt || 0) + 1; continue; }
  const optOk = q.options.every((o) => o.text.trim() && !BAD.test(o.text) && !/[\[\]]/.test(o.text) && !NICK.test(o.text) && !norm(o.text).split(/\s+/).some((w) => w.length > 2 && players.has(w)));
  const nc = q.options.filter((o) => o.isCorrect).length;
  const shape = (q.options.length === 4 && nc === 1) || (q.options.length === 1 && nc === 1 && /^-?\d+$/.test(q.options[0].text.trim()));
  const dup = new Set(q.options.map((o) => o.text.trim())).size !== q.options.length;
  if (!optOk || !shape || dup) { reasons.options = (reasons.options || 0) + 1; continue; }
  pass.push(q.id);
}
console.log(`OUT ${OUT}`);
console.log(`deactivated: ${rows.length} | excluded(known-bad): ${reasons.excluded || 0} | fail-prompt: ${reasons.prompt || 0} | fail-options: ${reasons.options || 0}`);
console.log(`CLEAN & publishable: ${pass.length}`);
const sample = await prisma.question.findMany({ where: { id: { in: pass.slice(0, 12) } }, select: { prompt: true } });
sample.forEach((s) => console.log("   ", s.prompt.slice(0, 74)));
fs.writeFileSync(path.join(OUT, "rollback.json"), JSON.stringify(pass.map((id) => ({ id, isPublished: false })), null, 2));
if (APPLY) {
  const r = await prisma.question.updateMany({ where: { id: { in: pass } }, data: { isPublished: true } });
  console.log(`PUBLISHED ${r.count}. rollback -> ${path.join(OUT, "rollback.json")}`);
} else console.log("DRY RUN — rerun with --apply");
await prisma.$disconnect();
