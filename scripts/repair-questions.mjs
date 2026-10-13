/** repair-questions.mjs — LLM repair/drop for malformed published questions.
 *  node --env-file=.env scripts/repair-questions.mjs --only-ids audit/broken-candidates.txt --n 5
 *  node --env-file=.env scripts/repair-questions.mjs --only-ids audit/broken-candidates.txt
 *  node --env-file=.env scripts/repair-questions.mjs --only-ids audit/broken-candidates.txt --apply
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const ONLY_FILE = arg("only-ids", "");
const BATCH = parseInt(arg("batch", "10"), 10);
const MODEL = arg("model", "deepseek-v4-pro");
const N = parseInt(arg("n", "0"), 10);
const APPLY = argv.includes("--apply");
const MIN_CONF = parseFloat(arg("min-conf", "0.7"));

const SYSTEM = `Ești editor de întrebări de trivia în limba română. Primești enunțuri CORUPTE: fragmente în ordine greșită, cuvânt de întrebare lipsă la început, tokeni străini (nume de jucători, "the", "~", fragmente).
Reconstruiește enunțul corect în română, folosind și opțiunile ca context. NU inventa fapte noi, NU schimba sensul, NU adăuga explicații.
Dacă enunțul sau opțiunile sunt ireparabile (informație cheie lipsă, opțiuni corupte), acțiunea e "drop".
Răspunde EXCLUSIV cu JSON:
{"results":[{"id":"<id>","action":"repair|drop","prompt":"<enunțul reparat, o singură propoziție>","confidence":<0..1>,"reason":"<max 15 cuvinte>"}]}
Include un obiect pentru FIECARE id primit, în aceeași ordine.`;

function userMsg(items) {
  return "Repară aceste întrebări:\n\n" + items.map((q) => {
    const opts = q.options.slice().sort((a, b) => a.position - b.position)
      .map((o, i) => `  ${i}. ${o.text}${o.isCorrect ? "   <-- CORECT" : ""}`).join("\n");
    return `id: ${q.id}\nQ: ${q.prompt}\n${opts}`;
  }).join("\n\n");
}

async function call(items) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: 32000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg(items) }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || "";
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
  const byId = new Map();
  for (const r of parsed?.results || []) if (r && r.id) byId.set(r.id, r);
  return { byId, usage: j.usage || {} };
}

const NICK = /\b(stone|st0ne|st0ner|therunner|frankcastle|neovortex|dalmacijo|miorlau|cioflicel|perseu)\b/i;
const STOP = new Set("care cine cand când unde cum este sunt fost are avea aveau intr într dintre cele cea cel cei un o al ale din pe la in în cu de si și sau dar mai nu dupa după pentru intre între peste sub spre fara fără cat cât cati câți cate câte era lor lui se sa să fie fost prin acest aceasta acesti aceste".split(/\s+/));
const fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, " ");
const words = (s) => fold(s).split(/[\s-]+/).filter((w) => w.length >= 4);

function validate(orig, rp, opts) {
  if (!rp || typeof rp !== "string") return "empty";
  const t = rp.trim();
  if (t.length < 10) return "too-short";
  const fa = (t.match(/[A-Za-zăâîșțĂÂÎȘȚ]/) || [""])[0];
  if (fa && fa === fa.toLowerCase()) return "still-lowercase";
  if (NICK.test(t)) return "nick-left";
  if (t.split(/\s+/).length < orig.split(/\s+/).length * 0.5) return "too-short-vs-orig";
  // anti-hallucination: no new content word may appear that is absent from the original + options
  const known = new Set([...words(orig), ...opts.flatMap((o) => words(o))]);
  const novel = words(t).filter((w) => !known.has(w) && !STOP.has(w));
  if (novel.length) return "invented:" + novel.slice(0, 3).join("/");
  // possible misaligned fragment: an option's text now sits inside the prompt
  const ft = fold(t);
  for (const o of opts) { const ot = fold(o).trim(); if (ot.length >= 4 && ft.includes(ot)) return "option-in-prompt:" + ot.slice(0, 20); }
  return null;
}

(async () => {
  const only = ONLY_FILE ? fs.readFileSync(ONLY_FILE, "utf8").split(/\s+/).filter((s) => /^[0-9a-f-]{36}$/i.test(s)) : [];
  if (!only.length) { console.error("need --only-ids <file>"); process.exit(1); }
  const rows = await prisma.question.findMany({ where: { id: { in: only }, isPublished: true }, include: { options: true } });
  const sample = N > 0 ? rows.slice(0, N) : rows;
  const outDir = path.join("audit", "repair-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`candidates=${rows.length} processing=${sample.length} batch=${BATCH} model=${MODEL}`);

  const plan = [];
  for (let i = 0; i < sample.length; i += BATCH) {
    const items = sample.slice(i, i + BATCH);
    process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(sample.length / BATCH)} (${items.length}) … `);
    let res;
    try { res = await call(items); } catch (e) { console.log("ERR " + e.message); for (const q of items) plan.push({ id: q.id, prompt: q.prompt, action: "drop", confidence: 0, reason: "api-error", repaired: "" }); continue; }
    for (const q of items) {
      const v = res.byId.get(q.id) || { action: "drop", confidence: 0, reason: "no-verdict", prompt: "" };
      const rp = (v.prompt || "").trim();
      let action = v.action === "repair" ? "repair" : "drop";
      let reason = (v.reason || "").slice(0, 60);
      if (action === "repair") {
        const bad = validate(q.prompt, rp, q.options.map((o) => o.text));
        if (bad) { if (/^(invented|option-in-prompt)/.test(bad)) { action = "review"; reason = "human:" + bad; } else { action = "drop"; reason = "reject:" + bad; } }
        else if (rp === q.prompt.trim() || (v.confidence || 0) < MIN_CONF) { action = "review"; reason = "low-conf/noop:" + (v.confidence || 0).toFixed(2); }
      }
      plan.push({ id: q.id, prompt: q.prompt, action, confidence: v.confidence || 0, reason, repaired: rp });
    }
    console.log("ok");
    fs.writeFileSync(path.join(outDir, "plan.partial.json"), JSON.stringify(plan, null, 2));
  }

  const cnt = {};
  for (const p of plan) cnt[p.action] = (cnt[p.action] || 0) + 1;
  fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(outDir, "plan.csv"),
    "id,action,confidence,prompt,repaired,reason\n" +
    plan.map((p) => [p.id, p.action, p.confidence, p.prompt, p.repaired, p.reason].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
  console.log(`actions: ${JSON.stringify(cnt)}`);
  console.log(`out: ${outDir}`);

  if (APPLY) {
    const rollback = [];
    let up = 0, unpub = 0;
    for (const p of plan) {
      if (p.action === "repair") { rollback.push({ id: p.id, prompt: p.prompt }); await prisma.question.update({ where: { id: p.id }, data: { prompt: p.repaired } }); up++; }
      else if (p.action === "drop") { rollback.push({ id: p.id, isPublished: true }); await prisma.question.update({ where: { id: p.id }, data: { isPublished: false } }); unpub++; }
    }
    fs.writeFileSync(path.join(outDir, "rollback.json"), JSON.stringify(rollback, null, 2));
    console.log(`APPLIED: repaired=${up} unpublished=${unpub}`);
  } else console.log("DRY RUN — rerun with --apply");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
