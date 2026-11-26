/** reconstruct-from-logs.mjs — recover the true prompt for questions held in the
 *  Bucket-3 "review" pile, using the original game logs (~/cq2-logs-backup).
 *  The same question appears many times; the parser stored a corrupted variant,
 *  but a clean variant often exists in the logs.
 *
 *  node --env-file=.env scripts/reconstruct-from-logs.mjs            # dry run
 *  node --env-file=.env scripts/reconstruct-from-logs.mjs --apply    # write + rollback
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PLAN = arg("plan", "audit/repair-2026-10-13T15-31-14/plan.json");
const LOGDIR = arg("logs", path.join(os.homedir(), "cq2-logs-backup"));
const OUT = path.join("audit", "reconstruct-" + new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(OUT, { recursive: true });

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
// strong question starters only (weak "de/cu/al" caused cut-at-wrong-token bugs)
const STRONG = new Set("ce care cine cum cand cat cati cate cata unde la din pe in un o este sunt intre dupa pentru sub peste spre prin".split(" "));
const NICKW = new Set("st0ne stone st0ner stoner stane stome therunner runner ecountry frankcastle neovortex dalmacijo miorlau cioflicel perseu khamikon ionutign malasorte porumbi miha margi jordash berrybubble lancelbot zuu vladdd falath".split(" "));
const hasNick = (s) => s.split(/\s+/).some((t) => NICKW.has(norm(t)));
const hasDigitWord = (s) => s.split(/\s+/).some((t) => /[a-zăâîșț]/i.test(t) && /[0-9]/.test(t));

const logLines = [];
for (const f of fs.readdirSync(LOGDIR)) {
  if (!f.endsWith(".txt")) continue;
  for (const ln of fs.readFileSync(path.join(LOGDIR, f), "utf8").split(/\r?\n/)) {
    const m = ln.match(/\]\s*Q:\s*(.+)$/);
    if (m) logLines.push(m[1].trim());
  }
}
const normLog = logLines.map(norm);

function cutPrefix(line) {
  const toks = line.split(/\s+/);
  for (let i = 0; i < toks.length && i < 6; i++) if (STRONG.has(norm(toks[i]))) return toks.slice(i).join(" ");
  let i = 0;
  while (i < toks.length && (NICKW.has(norm(toks[i])) || hasDigitWord(toks[i]))) i++;
  return toks.slice(i).join(" ");
}

const IMP = new Set("scrie scrieti calculeaza alege indica numeste completati dati precizeaza determinati".split(" "));
const bad = (s) => {
  if (!s || s.length < 12) return "too-short";
  if (/^the\b/i.test(s) || /\bthe\b/i.test(s)) return "stray-the";
  if (hasNick(s)) return "nick";
  if (hasDigitWord(s)) return "digit-word";
  if (((s.match(/\?/g) || []).length) > 1) return "multi-question";
  if (((s.match(/"/g) || []).length) % 2 !== 0) return "unbalanced-quote";
  if (/(?<=[a-zăâîșț])-0(?=[a-zăâîșț]|\s)|\s0\s(?=[a-zăâîșț])/.test(s)) return "article-0-unfixed";
  const first = norm(s.split(/\s+/)[0]);
  if (!STRONG.has(first) && !IMP.has(first)) return "weak-head";
  const fa = (s.match(/[A-Za-zăâîșțĂÂÎȘȚ]/) || [""])[0];
  if (fa && fa === fa.toLowerCase() && !IMP.has(first)) return "lowercase-start";
  return null;
};

const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
const reviewIds = plan.filter((p) => p.action === "review").map((p) => p.id);

const out = [];
for (const id of reviewIds) {
  const q = await prisma.question.findUnique({ where: { id }, select: { id: true, prompt: true } });
  if (!q) continue;
  const w = norm(q.prompt).split(" ");
  const tail = w.slice(-5).join(" ");
  let best = null, bestScore = -1e9, bestLine = "";
  for (let i = 0; i < normLog.length; i++) {
    const idx = normLog[i].indexOf(tail);
    if (idx < 0) continue;
    const cut = cutPrefix(logLines[i]);
    const err = bad(cut);
    const endsTail = norm(cut).endsWith(tail);
    // prefer: valid, tail-at-end, fewest extra tokens (tightest fit)
    const score = (err ? -1000 : 500) + (endsTail ? 500 : 0) - cut.split(/\s+/).length;
    if (score > bestScore) { bestScore = score; best = { cut, err, endsTail }; bestLine = logLines[i]; }
  }
  if (!best) { out.push({ id, old: q.prompt, fixed: "", status: "no-source" }); continue; }
  const changed = norm(best.cut) !== norm(q.prompt);
  const status = best.err ? "reject:" + best.err : !changed ? "unchanged" : !best.endsTail ? "partial" : "ready";
  out.push({ id, old: q.prompt, fixed: status === "ready" ? best.cut : "", status, source: bestLine });
}

const cnt = {};
const seen = new Set();
for (const r of out) {
  if (r.status === "ready") {
    const k = norm(r.fixed);
    if (seen.has(k)) r.status = "duplicate";
    else seen.add(k);
  }
  const k = r.status.split(":")[0];
  cnt[k] = (cnt[k] || 0) + 1;
}
console.log("review:", reviewIds.length, "| log lines:", logLines.length, "| status:", JSON.stringify(cnt));
fs.writeFileSync(path.join(OUT, "plan.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(OUT, "plan.csv"),
  "id,status,old,fixed,source\n" + out.map((r) => [r.id, r.status, r.old, r.fixed, r.source].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
console.log("out:", OUT);

if (APPLY) {
  const rollback = []; let up = 0;
  for (const r of out) { if (r.status !== "ready") continue; rollback.push({ id: r.id, prompt: r.old }); await prisma.question.update({ where: { id: r.id }, data: { prompt: r.fixed } }); up++; }
  fs.writeFileSync(path.join(OUT, "rollback.json"), JSON.stringify(rollback, null, 2));
  console.log(`APPLIED: repaired=${up} (held ${out.length - up})`);
} else console.log("DRY RUN — rerun with --apply");
await prisma.$disconnect();
