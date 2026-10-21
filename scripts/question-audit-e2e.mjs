// E2E for the question edit trail ("who edited this question?").
// Usage: BASE=http://127.0.0.1:3215 DATABASE_URL=... node scripts/question-audit-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3215";
const PW = "audit-e2e-pass";
const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};
let fail = 0;
const ok = (c, m, extra) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${!c && extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  if (!c) fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(cookie, path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: cookie ?? "", ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${email} -> ${r.status}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

const tag = randomUUID().slice(0, 8);
const mkUser = (suffix, flags = {}) =>
  prisma.user.create({
    data: {
      email: `audit-${tag}-${suffix}`,
      displayName: `aud-${tag}-${suffix}`.slice(0, 32),
      passwordHash: hash(PW),
      ...flags,
    },
    select: { id: true, displayName: true, email: true },
  });

async function main() {
  const admin = await mkUser("admin", { isAdmin: true });
  const editor = await mkUser("ed", { canEditQuestions: true });
  const plain = await mkUser("plain");
  const ca = await login(admin.email);
  const ce = await login(editor.email);
  const cp = await login(plain.email);

  // --- fixtures: one question created by the admin through the import path ---
  const prompt = `audit-${tag} Care e capitala Franței?`;
  const imp = await api(ca, "/api/admin/questions/import", {
    method: "POST",
    body: JSON.stringify({ csv: `${prompt};Paris;Lyon;Nisa;Lille;A`, dryRun: false }),
  });
  ok(imp.status === 200 && imp.body?.imported === 1, "admin imports a question", imp.body);
  const q = await prisma.question.findFirst({ where: { prompt }, select: { id: true } });
  ok(!!q, "question landed in the DB", q);

  // --- the trail already says who created it -------------------------------
  const h0 = await api(ce, `/api/admin/questions/${q.id}/edits`);
  ok(h0.status === 200 && h0.body?.edits?.length === 1, "one trail row after import", h0.body);
  ok(h0.body?.edits?.[0]?.editorName === admin.displayName, "import is attributed to the admin", h0.body?.edits?.[0]);
  ok(h0.body?.edits?.[0]?.action === "import", "action is import", h0.body?.edits?.[0]?.action);

  // --- an editor edits it: prompt + correct answer ------------------------
  const upd = await api(ce, `/api/admin/questions/${q.id}`, {
    method: "PUT",
    body: JSON.stringify({
      prompt: `${prompt} (corectat)`,
      options: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
        { text: "Nisa", isCorrect: false },
        { text: "Marsilia", isCorrect: false },
      ],
    }),
  });
  ok(upd.status === 200, "editor saves an edit", upd.body);

  const h1 = await api(ce, `/api/admin/questions/${q.id}/edits`);
  const top = h1.body?.edits?.[0];
  ok(h1.body?.edits?.length === 2, "two trail rows after the edit", h1.body?.edits?.length);
  ok(top?.editorName === editor.displayName, "the EDIT is attributed to the editor", top?.editorName);
  ok(top?.action === "edit", "action is edit", top?.action);
  ok(typeof top?.summary === "string" && top.summary.length > 0, "the trail says what changed", top?.summary);
  ok(h1.body?.edits?.[1]?.editorName === admin.displayName, "history keeps the older row too", h1.body?.edits?.[1]?.editorName);

  // --- the list shows the last editor + can be filtered by editor ---------
  const list = await api(ca, `/api/admin/questions?status=all&search=${encodeURIComponent(tag)}`);
  const row = (list.body?.questions ?? []).find((r) => r.id === q.id);
  ok(!!row, "the question is in the admin list", list.body?.questions?.length);
  ok(row?.lastEdit?.editorName === editor.displayName, "list row names the last editor", row?.lastEdit);
  ok(row?.lastEdit?.action === "edit", "list row names the action", row?.lastEdit?.action);
  const editors = list.body?.editors ?? [];
  const edRow = editors.find((e) => e.id === editor.id);
  ok(!!edRow, "editor appears in the editor picker", editors);
  ok(edRow?.n >= 1, "editor picker carries a count", edRow);

  const onlyEd = await api(ca, `/api/admin/questions?status=all&editorId=${editor.id}`);
  const ids = (onlyEd.body?.questions ?? []).map((r) => r.id);
  ok(ids.includes(q.id), "filter by editor returns the question", ids.length);
  const onlyAdmin = await api(ca, `/api/admin/questions?status=all&editorId=${admin.id}`);
  ok(!(onlyAdmin.body?.questions ?? []).some((r) => r.id === q.id), "filter by another editor excludes it", (onlyAdmin.body?.questions ?? []).length);

  // --- toggling publish state is also attributed -------------------------
  const tog = await api(ce, `/api/admin/questions/${q.id}/toggle`, { method: "POST" });
  ok(tog.status === 200, "editor toggles publish", tog.body);
  const h2 = await api(ce, `/api/admin/questions/${q.id}/edits`);
  ok(h2.body?.edits?.[0]?.action === "unpublish" || h2.body?.edits?.[0]?.action === "publish", "toggle is logged", h2.body?.edits?.[0]?.action);

  // --- a plain player cannot read the trail ------------------------------
  const hPlain = await api(cp, `/api/admin/questions/${q.id}/edits`);
  ok(hPlain.status === 403, "plain player cannot read the trail", hPlain.status);

  // --- deleting the question keeps the trail (questionId null, prompt kept) ---
  const del = await api(ca, `/api/admin/questions/${q.id}`, { method: "DELETE" });
  ok(del.status === 200, "admin deletes the question", del.body);
  const orphans = await prisma.questionEdit.findMany({ where: { editorName: { in: [admin.displayName, editor.displayName] } } });
  ok(orphans.length >= 4, "the trail survives the delete", orphans.length);
  ok(orphans.every((o) => o.questionId === null), "orphaned rows lose the id", orphans.map((o) => o.questionId));
  ok(orphans.some((o) => o.action === "delete" && o.prompt.includes(tag)), "the delete itself is recorded", orphans.map((o) => o.action));

  // --- cleanup -----------------------------------------------------------
  await prisma.questionEdit.deleteMany({ where: { editorName: { in: [admin.displayName, editor.displayName] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, editor.id, plain.id] } } });

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => {
  console.error("crashed:", e.message);
  process.exit(1);
});
