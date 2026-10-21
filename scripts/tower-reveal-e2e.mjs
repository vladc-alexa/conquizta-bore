// Focused E2E for the Turnul answer-leak bug (2026-10-21).
// Bug: `reveal` was derived from the OPEN question, so any player who had answered
// an earlier round saw the live question's correct answer before answering it.
// Fixed contract: reveal exists only during the breather, and always describes the
// round that just CLOSED.
// Usage: BASE=http://127.0.0.1:3213 node scripts/tower-reveal-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3213";
const PW = "tower-reveal-pass";
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
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
async function login(name) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: name, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${name} -> ${r.status}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

const tag = randomUUID().slice(0, 8);
const NAMES = [`reveal-${tag}-a`, `reveal-${tag}-b`];
const PROMPTS = [];
let gid = null;

try {
  // ---- fixtures: enough published grilă questions for a 9-round plan --------
  for (let i = 0; i < 14; i++) {
    const q = await prisma.question.create({
      data: {
        prompt: `reveal-e2e ${tag} q${i}?`,
        isPublished: true,
        difficulty: 1,
        options: {
          create: [
            { text: `corect-${tag}-${i}`, position: 0, isCorrect: true },
            { text: `gresit-${tag}-${i}-a`, position: 1, isCorrect: false },
            { text: `gresit-${tag}-${i}-b`, position: 2, isCorrect: false },
            { text: `gresit-${tag}-${i}-c`, position: 3, isCorrect: false },
          ],
        },
      },
    });
    PROMPTS.push(q.prompt);
  }

  await prisma.user.deleteMany({ where: { displayName: { in: NAMES } } });
  for (const n of NAMES) {
    await prisma.user.create({
      data: { displayName: n, email: `${n}@example.com`, passwordHash: hash(PW) },
    });
  }
  const ca = await login(NAMES[0]);
  const cb = await login(NAMES[1]);

  const created = await api(ca, "/api/tower", { method: "POST" });
  gid = created.body?.gameId;
  ok(created.status === 201 && !!gid, "create tower room", created.body);
  await api(cb, `/api/tower/${gid}/join`, { method: "POST" });
  await api(ca, `/api/tower/${gid}/start`, { method: "POST" });

  const correctTextOf = async (questionId) => {
    const o = await prisma.questionOption.findFirst({
      where: { questionId, isCorrect: true },
      select: { id: true, text: true },
    });
    return o;
  };

  let st = (await api(ca, `/api/tower/${gid}`)).body;
  ok(st.status === "IN_PROGRESS" && st.round === 0 && !!st.question, "round 1 open", {
    status: st.status,
    round: st.round,
  });

  // ---- leak check #1: live question, viewer has answered nothing yet --------
  ok(st.reveal === null, "no reveal while round 1 is open (nothing answered yet)", st.reveal);

  const q0 = await correctTextOf(st.question.id);
  const q0Text = q0.text;

  const a0 = await api(ca, `/api/tower/${gid}/answer`, {
    method: "POST",
    body: JSON.stringify({ selectedOptionId: q0.id }),
  });
  ok(a0.status === 200 && a0.body?.isCorrect === true, "player A answers round 1", a0.body);

  // ---- leak check #2: A answered this round, the round is still OPEN ---------
  // (B has not answered yet, so the round cannot settle)
  st = (await api(ca, `/api/tower/${gid}`)).body;
  ok(st.round === 0, "round 1 still open after only one human answered", st.round);
  ok(st.myAnswered === true, "A is marked as answered", st.myAnswered);
  ok(st.reveal === null, "no reveal for A while round 1 is still open", st.reveal);

  const b0 = await api(cb, `/api/tower/${gid}/answer`, {
    method: "POST",
    body: JSON.stringify({ selectedOptionId: q0.id }),
  });
  ok(b0.status === 200, "player B answers round 1", b0.body);

  // ---- the round settles: breather must show round 1's answer to everyone ---
  let intermission = null;
  for (let i = 0; i < 60; i++) {
    await sleep(120);
    st = (await api(ca, `/api/tower/${gid}`)).body;
    if (st.round !== 0 || st.status === "COMPLETED") {
      intermission = st;
      break;
    }
  }
  ok(!!intermission, "round 1 settles after both humans answered", intermission?.round);
  if (intermission) {
    ok(intermission.startsInMs > 0, "we are inside the breather", intermission.startsInMs);
    ok(intermission.reveal === q0Text, "breather reveals round 1's correct answer to A", {
      got: intermission.reveal,
      want: q0Text,
    });
    const sB = (await api(cb, `/api/tower/${gid}`)).body;
    ok(sB.reveal === q0Text, "breather reveals round 1's correct answer to B too", sB.reveal);
  }

  // ---- leak check #3: round 2 opens — A answered round 1, must NOT see q2 ----
  st = intermission;
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    st = (await api(ca, `/api/tower/${gid}`)).body;
    if (st.startsInMs === 0 && st.question && st.round === 1) break;
  }
  ok(st.round === 1 && !!st.question, "round 2 opens", { round: st.round, q: !!st.question });
  const q1 = await correctTextOf(st.question.id);
  ok(st.reveal === null, "A gets NO reveal for the open round 2 (the bug)", st.reveal);
  ok(st.reveal !== q1.text, "A cannot read round 2's correct answer before answering", st.reveal);
  const sB2 = (await api(cb, `/api/tower/${gid}`)).body;
  ok(sB2.reveal === null, "B also gets no reveal for the open round 2", sB2.reveal);
  ok(st.history?.length === 1, "finished rounds stay in history", st.history?.length);

  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
} catch (e) {
  console.error("ERROR", e);
  fail++;
} finally {
  if (gid) await prisma.towerGame.deleteMany({ where: { id: gid } });
  await prisma.user.deleteMany({ where: { displayName: { in: NAMES } } });
  await prisma.question.deleteMany({ where: { prompt: { in: PROMPTS } } });
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
