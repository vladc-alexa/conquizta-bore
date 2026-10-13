// E2E for the admin review-screen upgrade:
//   - server-side pagination (offset/limit) with no overlap/gap across pages
//   - a `total` the client can trust to stop paging
//   - permanent DELETE (admin only) removes the row; editors are refused
// Mirrors scripts/admin-counts-e2e.mjs (temp users + throwaway question, cleaned up).
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const BASE = process.env.BASE || "http://127.0.0.1:3210";
const prisma = new PrismaClient();
let failed = 0;
const ok = (c, m, extra = "") => {
  console.log((c ? "✓" : "✗") + " " + m + (extra ? "  " + extra : ""));
  if (!c) failed++;
};
const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};
const TAG = "reviewe2e";
let qid = null;
let qid2 = null;

async function login(name, password) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: name, password }),
  });
  if (!r.ok) throw new Error("login failed " + r.status);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
const call = async (cookie, path, method = "GET") => {
  const r = await fetch(BASE + path, { method, headers: { Cookie: cookie }, cache: "no-store" });
  let b = null;
  try {
    b = await r.json();
  } catch {}
  return { status: r.status, body: b };
};

try {
  await prisma.user.deleteMany({ where: { displayName: { startsWith: TAG } } });
  await prisma.user.create({
    data: { displayName: TAG + "-editor", passwordHash: hash("testpass123"), isAdmin: false, canEditQuestions: true },
  });
  await prisma.user.create({
    data: { displayName: TAG + "-admin", passwordHash: hash("testpass123"), isAdmin: true },
  });
  const junk = await prisma.question.create({
    data: {
      prompt: TAG + " throwaway junk question?",
      isPublished: false,
      options: { create: [{ text: "a", position: 0, isCorrect: true }, { text: "b", position: 1 }, { text: "c", position: 2 }, { text: "d", position: 3 }] },
    },
  });
  qid = junk.id;

  const editor = await login(TAG + "-editor", "testpass123");
  const admin = await login(TAG + "-admin", "testpass123");

  // --- pagination ---
  const p0 = await call(editor, "/api/admin/questions?status=disabled&limit=50&offset=0");
  const p1 = await call(editor, "/api/admin/questions?status=disabled&limit=50&offset=50");
  ok(p0.status === 200 && p1.status === 200, "paged reads return 200", `${p0.status}/${p1.status}`);
  ok(typeof p0.body?.total === "number" && p0.body.total > 0, "response carries a numeric total", `total=${p0.body?.total}`);
  ok(Array.isArray(p0.body?.questions) && p0.body.questions.length === 50, "page 0 returns a full 50", `got ${p0.body?.questions?.length}`);
  ok(p1.body?.questions?.length > 0, "page 1 returns rows (does not just stop)", `got ${p1.body?.questions?.length}`);
  const ids0 = new Set((p0.body?.questions ?? []).map((q) => q.id));
  const ids1 = (p1.body?.questions ?? []).map((q) => q.id);
  const overlap = ids1.filter((id) => ids0.has(id));
  ok(overlap.length === 0, "pages do not overlap", `overlap=${overlap.length}`);
  const seen = ids0.size + ids1.length;
  ok(seen === Math.min(100, p0.body.total), "paged ids cover min(100,total) distinct rows", `seen=${seen} total=${p0.body.total}`);
  const badItem = (p0.body?.questions ?? []).find((q) => !q.id || typeof q.prompt !== "string");
  ok(!badItem, "rows carry id + prompt for inline editing");

  // --- editing a reported question clears its reports (marks it solved) ---
  const rep = await prisma.question.create({
    data: {
      prompt: TAG + " reported question to edit?",
      isPublished: false,
      options: { create: [{ text: "a", position: 0, isCorrect: true }, { text: "b", position: 1 }, { text: "c", position: 2 }, { text: "d", position: 3 }] },
      reports: { create: [{ note: "wrong answer" }] },
    },
    include: { options: true },
  });
  qid2 = rep.id;
  const before = await prisma.questionReport.count({ where: { questionId: qid2 } });
  ok(before === 1, "throwaway question starts reported", `reports=${before}`);
  const inQueue = await call(editor, "/api/admin/questions?status=reported&limit=200");
  ok((inQueue.body?.questions ?? []).some((q) => q.id === qid2), "reported question appears in the review queue");
  const edit = await fetch(BASE + `/api/admin/questions/${qid2}`, {
    method: "PUT",
    headers: { Cookie: editor, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: TAG + " reported question EDITED?", options: rep.options.map((o, i) => ({ text: o.text, isCorrect: i === 0 })) }),
  });
  ok(edit.status === 200, "editor can edit the question", `got ${edit.status}`);
  const after = await prisma.questionReport.count({ where: { questionId: qid2 } });
  ok(after === 0, "editing clears the reports (no longer marked reported)", `reports=${after}`);
  const stillQueued = await call(editor, "/api/admin/questions?status=reported&limit=200");
  ok(!(stillQueued.body?.questions ?? []).some((q) => q.id === qid2), "edited question leaves the reported queue");
  await prisma.question.deleteMany({ where: { id: qid2 } });
  qid2 = null;

  // --- delete guard + permanent delete ---
  const refused = await call(editor, `/api/admin/questions/${qid}`, "DELETE");
  ok(refused.status === 403, "editor cannot permanently delete", `got ${refused.status}`);
  const stillThere = await prisma.question.findUnique({ where: { id: qid } });
  ok(!!stillThere, "question survives the refused delete");

  const del = await call(admin, `/api/admin/questions/${qid}`, "DELETE");
  ok(del.status === 200, "admin can permanently delete", `got ${del.status}`);
  const gone = await prisma.question.findUnique({ where: { id: qid } });
  ok(!gone, "question is really gone from the DB");
  const orphanOpts = await prisma.questionOption.count({ where: { questionId: qid } });
  ok(orphanOpts === 0, "its options were removed too", `opts=${orphanOpts}`);
  qid = null;
} catch (e) {
  console.error("E2E error:", e);
  failed++;
} finally {
  if (qid) await prisma.question.deleteMany({ where: { id: qid } }).catch(() => {});
  if (qid2) await prisma.question.deleteMany({ where: { id: qid2 } }).catch(() => {});
  await prisma.user.deleteMany({ where: { displayName: { startsWith: TAG } } }).catch(() => {});
  await prisma.$disconnect();
  console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}
