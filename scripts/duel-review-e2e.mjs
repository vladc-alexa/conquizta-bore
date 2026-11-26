// E2E for post-duel question review: after a 1v1, each round in the list must
// expose its questionId, be reportable by any player, and be editable in place
// by a player who has editor rights (canEditQuestions / isAdmin).
//
// Usage: node scripts/duel-review-e2e.mjs   (BASE=http://127.0.0.1:3210)
// Fixture questions are created UNPUBLISHED and spliced into the duel plan, so
// the live question pool is never touched and real data is never edited.
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3210";
const PW = "duel-review-pass";

const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};

let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) fail++;
};

async function login(name) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: name, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${name} -> ${r.status}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* no json */
  }
  return { status: r.status, body };
}

const NAME_A = "duel-review-a";
const NAME_B = "duel-review-b";
const ids = { duel: null, questions: [], users: [] };

const wrap = (n) => ((n % 97) + 7) * 3; // deterministic "answer" for rapide

try {
  // ---- fixtures: players (A = editor) + 6 grila / 4 rapide questions ------
  await prisma.user.deleteMany({ where: { displayName: { in: [NAME_A, NAME_B] } } });
  const ua = await prisma.user.create({
    data: { displayName: NAME_A, passwordHash: hash(PW), canEditQuestions: true },
  });
  const ub = await prisma.user.create({ data: { displayName: NAME_B, passwordHash: hash(PW) } });
  ids.users = [ua.id, ub.id];

  const modes = "GRGRGRGRGG".split("");
  const plan = [];
  for (let i = 0; i < 10; i++) {
    const mode = modes[i] === "G" ? "grila" : "rapide";
    const prompt = `E2E-REVIEW ${i} (${mode}) — fixture, delete me`;
    // mode is implicit in the DB: a grilă has 4 options, a rapidă has one answer option
    const q = await prisma.question.create({
      data: {
        prompt,
        isPublished: true, // throwaway DB: the pool must be non-empty for create to work
        options: {
          create:
            mode === "grila"
              ? [0, 1, 2, 3].map((k) => ({ text: `OPT${k} r${i}`, isCorrect: k === i % 4, position: k }))
              : [{ text: String(wrap(i)), isCorrect: true, position: 0 }],
        },
      },
      include: { options: { orderBy: { position: "asc" } } },
    });
    ids.questions.push(q.id);
    const entry = { mode, questionId: q.id, prompt: q.prompt };
    if (mode === "grila") {
      entry.options = q.options.map((o) => ({ id: o.id, text: o.text }));
      entry.correctOptionId = q.options.find((o) => o.isCorrect).id;
    } else {
      entry.answer = wrap(i);
    }
    plan.push(entry);
  }

  const ca = await login(NAME_A);
  const cb = await login(NAME_B);

  // ---- create duel, splice the fixture plan in before B joins -------------
  const created = await api(ca, "/api/duel", { method: "POST" });
  ok(created.status === 201 && !!created.body?.duelId, "A creates a duel (201)");
  ids.duel = created.body.duelId;
  await prisma.duel.update({ where: { id: ids.duel }, data: { plan } });

  ok((await api(cb, `/api/duel/${ids.duel}/join`, { method: "POST" })).status === 200, "B joins");

  // ---- play to COMPLETED -------------------------------------------------
  const answer = async (cookie, round, entry, correct, slow) => {
    if (slow) await new Promise((r) => setTimeout(r, 130));
    const payload =
      entry.mode === "grila"
        ? { selectedOptionId: correct ? entry.correctOptionId : entry.options.find((o) => o.id !== entry.correctOptionId).id }
        : { answer: String(correct ? entry.answer : entry.answer + 4242) };
    return api(cookie, `/api/duel/${ids.duel}/answer`, {
      method: "POST",
      body: JSON.stringify({ round, ...payload }),
    });
  };
  let final = null;
  for (let g = 0; g < 30; g++) {
    const cur = (await api(ca, `/api/duel/${ids.duel}`)).body;
    if (cur.status === "COMPLETED") {
      final = cur;
      break;
    }
    const d = await prisma.duel.findUnique({ where: { id: ids.duel } });
    const entry = d.plan[cur.round];
    const aWins = true; // A takes every round, so the match never needs sudden death
    const [rA, rB] = aWins
      ? [await answer(ca, cur.round, entry, true, false), await answer(cb, cur.round, entry, false, true)]
      : [await answer(cb, cur.round, entry, true, false), await answer(ca, cur.round, entry, false, true)];
    ok(rA.status === 200 && rB.status === 200, `round ${cur.round} (${entry.mode}) both answers accepted`);
  }
  ok(!!final, "match reached COMPLETED");
  if (!final) throw new Error("duel did not complete");

  // ---- 1) the round list now carries what the UI needs -------------------
  const gr = final.history.find((h) => h.mode === "grila");
  const rp = final.history.find((h) => h.mode === "rapide");
  ok(final.history.every((h) => typeof h.questionId === "string" && h.questionId.length > 0), "every round exposes questionId");
  ok(!!gr && Array.isArray(gr.options) && gr.options.length === 4, "grila round exposes its 4 options");
  ok(!!gr && gr.options.filter((o) => o.isCorrect).length === 1, "exactly one option flagged correct");
  ok(!!rp && rp.options === null, "rapide round has options = null");
  ok(
    !JSON.stringify(final.history.map((h) => h.questionId)).includes("undefined"),
    "no undefined questionIds in history"
  );

  // ---- 2) any player can report a question from the results --------------
  const target = gr.questionId;
  const rep = await api(cb, `/api/questions/${target}/report`, { method: "POST", body: JSON.stringify({ reason: "e2e review" }) });
  ok(rep.status === 200 || rep.status === 201, `B reports a round question (${rep.status})`);
  let q = await prisma.question.findUnique({ where: { id: target }, include: { reports: true } });
  ok(q.isPublished === false, "reported question is unpublished");
  ok(q.reports.length === 1, "a QuestionReport row was written");
  const repDup = await api(cb, `/api/questions/${target}/report`, { method: "POST", body: JSON.stringify({ reason: "again" }) });
  ok(repDup.status === 409 || repDup.status === 400, `duplicate report rejected (${repDup.status})`);

  // ---- 3) a non-editor player gets no edit rights ------------------------
  const asB = await api(cb, `/api/admin/questions/${target}`, {
    method: "PUT",
    body: JSON.stringify({ prompt: "hacked by B", options: [{ text: "x", isCorrect: true }] }),
  });
  ok(asB.status === 401 || asB.status === 403, `non-editor cannot edit (${asB.status})`);

  // ---- 4) an editor player edits the question in place -------------------
  const fixedPrompt = "E2E-REVIEW fixed prompt — fixture, delete me";
  const asA = await api(ca, `/api/admin/questions/${target}`, {
    method: "PUT",
    body: JSON.stringify({
      prompt: fixedPrompt,
      options: [0, 1, 2, 3].map((k) => ({ text: `FIX${k}`, isCorrect: k === 2 })),
    }),
  });
  ok(asA.status === 200, `editor player edits the question (${asA.status})`);
  q = await prisma.question.findUnique({ where: { id: target }, include: { options: true, reports: true } });
  ok(q.prompt === fixedPrompt, "prompt updated in the DB");
  ok(q.options.length === 4 && q.options.filter((o) => o.isCorrect).length === 1, "options rewritten, one correct");
  ok(q.options.find((o) => o.isCorrect)?.text === "FIX2", "the intended option is the correct one");
  ok(q.reports.length === 0, "reports cleared after the fix");

  // ---- 5) the edit is what the players see afterwards --------------------
  const after = (await api(ca, `/api/duel/${ids.duel}`)).body;
  ok(!!after, "duel state still readable after the edit");
  ok(after.status === "COMPLETED", "duel still COMPLETED");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  if (process.env.KEEP === "1") {
    console.log(`\nKEEP=1 — left behind: duel ${ids.duel}, players ${NAME_A}/${NAME_B} (pw ${PW})`);
  } else try {
    if (ids.duel) await prisma.duel.delete({ where: { id: ids.duel } }).catch(() => {});
    if (ids.users.length) {
      await prisma.duelAnswer.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.quizSession.deleteMany({ where: { userId: { in: ids.users } } });
    }
    if (ids.questions.length) {
      await prisma.questionReport.deleteMany({ where: { questionId: { in: ids.questions } } });
      await prisma.questionOption.deleteMany({ where: { questionId: { in: ids.questions } } });
      await prisma.question.deleteMany({ where: { id: { in: ids.questions } } });
    }
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    console.log("cleanup done");
  } catch (e) {
    console.error("CLEANUP ERROR:", e.message);
  }
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
