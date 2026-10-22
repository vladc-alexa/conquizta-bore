// E2E for TURNUL (8-player ladder siege) + the 1v1 "3 wins in a row" rule.
// Drives the real HTTP API against a running server with a throwaway DB.
// Usage: BASE=http://127.0.0.1:3211 node scripts/tower-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3211";
const PW = "tower-e2e-pass";
const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};
let fail = 0;
const ok = (c, m, extra) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${!c && extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  if (!c) fail++;
};

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
// the plan can serve any published question (earlier runs left theirs behind),
// so always read the correct option back from the DB
async function correctOptionFor(questionId) {
  const o = await prisma.questionOption.findFirst({
    where: { questionId, isCorrect: true },
    select: { id: true, text: true },
  });
  return o ?? null;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures -----------------------------------------------------------
const tag = randomUUID().slice(0, 8);
const NAMES = [`tower-${tag}-a`, `tower-${tag}-b`];

async function seedQuestions() {
  const out = [];
  for (let i = 0; i < 14; i++) {
    const correctText = `corect ${i} ${tag}`;
    const q = await prisma.question.create({
      data: {
        prompt: `tower-e2e ${i}: intrebarea ${i}?`,
        isPublished: true,
        difficulty: 1,
        options: {
          create: [
            { text: correctText, position: 0, isCorrect: true },
            { text: `gresit ${i} a`, position: 1, isCorrect: false },
            { text: `gresit ${i} b`, position: 2, isCorrect: false },
            { text: `gresit ${i} c`, position: 3, isCorrect: false },
          ],
        },
      },
      include: { options: true },
    });
    out.push({ id: q.id, correct: q.options.find((o) => o.isCorrect).id });
  }
  // numeric questions so the duel can build its 4 "rapide" rounds
  for (let i = 0; i < 6; i++) {
    const value = 100 + i;
    const q = await prisma.question.create({
      data: {
        prompt: `tower-e2e numeric ${i}: cat face ${value}?`,
        isPublished: true,
        difficulty: 1,
        options: {
          create: [
            { text: String(value), position: 0, isCorrect: true },
            { text: String(value + 1), position: 1, isCorrect: false },
            { text: String(value + 2), position: 2, isCorrect: false },
            { text: String(value + 3), position: 3, isCorrect: false },
          ],
        },
      },
      include: { options: true },
    });
    out.push({ id: q.id, correct: q.options.find((o) => o.isCorrect).id });
  }
  return out;
}

try {
  const questions = await seedQuestions();
  const correctByQuestion = new Map(questions.map((q) => [q.id, q.correct]));

  await prisma.user.deleteMany({ where: { displayName: { in: NAMES } } });
  const ua = await prisma.user.create({ data: { displayName: NAMES[0], email: `${NAMES[0]}@example.com`, passwordHash: hash(PW) } });
  const ub = await prisma.user.create({ data: { displayName: NAMES[1], email: `${NAMES[1]}@example.com`, passwordHash: hash(PW) } });
  const ca = await login(NAMES[0]);
  const cb = await login(NAMES[1]);

  // ---- lobby ------------------------------------------------------------
  const created = await api(ca, "/api/tower", { method: "POST" });
  ok(created.status === 201 && created.body?.gameId, "create a tower room", created.body);
  const gid = created.body.gameId;

  const lobby = await api(ca, `/api/tower/${gid}`);
  ok(lobby.body?.phase === "lobby", "new tower starts in the lobby", lobby.body?.phase);
  ok(lobby.body?.canStart === true, "host may start it", lobby.body?.canStart);
  ok(lobby.body?.players?.length === 1, "host is the first seat", lobby.body?.players?.length);

  const openList = await api(cb, "/api/tower/open");
  ok((openList.body?.games ?? []).some((g) => g.id === gid), "open tower is listed for others", openList.body?.games);

  const joined = await api(cb, `/api/tower/${gid}/join`, { method: "POST" });
  ok(joined.status === 200 && joined.body?.seat === 1, "second player takes seat 2", joined.body);

  const startByGuest = await api(cb, `/api/tower/${gid}/start`, { method: "POST" });
  ok(startByGuest.status === 403, "only the host can start", startByGuest.status);

  const started = await api(ca, `/api/tower/${gid}/start`, { method: "POST" });
  ok(started.status === 200, "host starts the siege", started.body);

  let st = (await api(ca, `/api/tower/${gid}`)).body;
  ok(st?.status === "IN_PROGRESS", "tower is in progress", st?.status);
  ok(st?.players?.length === 8, "empty seats filled with bots", st?.players?.length);
  ok(st?.players?.filter((p) => p.isBot).length === 6, "6 bots joined the 2 humans", st?.players?.filter((p) => p.isBot).length);
  ok((st?.totalRounds ?? 0) >= 9 && st?.round === 0, "at least 9 rounds, starting at round 1", { r: st?.round, t: st?.totalRounds });
  ok(st?.question?.options?.length === 4, "round 1 serves a question with options", st?.question?.options?.length);

  // ---- play all 9 rounds -------------------------------------------------
  let eliminatedSeen = null;
  let finalRoundSeen = false;
  for (let round = 0; round < 9; round++) {
    st = (await api(ca, `/api/tower/${gid}`)).body;
    if (st.status === "COMPLETED") break;
    // the 5s breather serves no question — wait for the round to actually open
    for (let w = 0; w < 60 && !st?.question && st?.status !== "COMPLETED"; w++) {
      await sleep(150);
      st = (await api(ca, `/api/tower/${gid}`)).body;
    }
    if (st.round !== round) {
      ok(false, `expected round ${round + 1}`, st.round);
      break;
    }
    const correct = await correctOptionFor(st.question.id);
    // the plan mixes grilă and rapide rounds — rapide expects a typed number
    const payload =
      st.question.mode === "rapide" ? { answer: correct.text } : { selectedOptionId: correct.id };
    if (round === 8) finalRoundSeen = st.phase === "final";
    const answered = await api(ca, `/api/tower/${gid}/answer`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    ok(answered.status === 200 && answered.body?.isCorrect === true, `round ${round + 1}: correct answer graded`, answered.body);
    // the other human answers too — a round only settles once every human is in
    const bAnswer = await api(cb, `/api/tower/${gid}/answer`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    ok([200, 409].includes(bAnswer.status), `round ${round + 1}: second human answers`, bAnswer.body);

    // the round settles as soon as the humans are in
    for (let i = 0; i < 40; i++) {
      await sleep(120);
      st = (await api(ca, `/api/tower/${gid}`)).body;
      if (st.round !== round || st.status === "COMPLETED") break;
    }
    // the cut starts after round 10 (TOWER_CUT_FROM_ROUND) — a 9-round siege
    // must therefore end with all eight climbers still on the tower
    if (round === 7) {
      eliminatedSeen = st.players.filter((p) => p.eliminated);
      ok(eliminatedSeen.length === 0, "nobody falls off before round 10", eliminatedSeen.length);
      ok(st.round === 8, "the siege runs past round 8", st.round);
    }
  }

  ok(finalRoundSeen, "round 9 is labelled the final", null);
  ok(st?.status === "COMPLETED", "tower completes after the final", st?.status);
  const champion = st?.players?.find((p) => p.id === st.winnerId);
  ok(!!champion, "a champion is crowned", st?.winnerId);
  ok(champion?.rungs === 36, "champion reaches the summit (36 rungs)", champion?.rungs);
  ok(st?.players?.filter((p) => p.eliminated).length === 0, "no cut in a 9-round siege", st?.players?.filter((p) => p.eliminated).length);
  const meRow = st?.players?.find((p) => p.mine);
  ok((meRow?.rungs ?? 0) > 0 && (meRow?.score ?? 0) > 0, "my climber has rungs and points", meRow);
  ok(st?.history?.length === 9, "history has all 9 rounds", st?.history?.length);

  // ---- 3 wins in a row wins the duel ------------------------------------
  const duel = await api(ca, "/api/duel", { method: "POST" });
  ok(duel.status === 201 && duel.body?.duelId, "create a duel", duel.body);
  const did = duel.body.duelId;
  const joinedDuel = await api(cb, `/api/duel/${did}/join`, { method: "POST" });
  ok(joinedDuel.status === 200, "guest joins the duel", joinedDuel.body);
  const beganDuel = await api(ca, `/api/duel/${did}/start`, { method: "POST" });
  ok(beganDuel.status === 200, "host starts the duel from the lobby", beganDuel.body);

  let ds = (await api(ca, `/api/duel/${did}`)).body;
  ok(ds?.streakToWin === 3, "duel state reports a 3-win streak rule", ds?.streakToWin);

  // A answers every round correctly, B answers wrong => A wins rounds 1..3
  for (let round = 0; round < 3; round++) {
    ds = (await api(ca, `/api/duel/${did}`)).body;
    if (ds.status !== "IN_PROGRESS") break;
    const qid = ds.questionId;
    if (!qid) break;
    const opts = await prisma.questionOption.findMany({ where: { questionId: qid }, select: { id: true, text: true, isCorrect: true } });
    const good = opts.find((o) => o.isCorrect);
    const bad = opts.find((o) => !o.isCorrect);
    if (ds.mode === "grila") {
      await api(ca, `/api/duel/${did}/answer`, { method: "POST", body: JSON.stringify({ round, selectedOptionId: good.id }) });
      await api(cb, `/api/duel/${did}/answer`, { method: "POST", body: JSON.stringify({ round, selectedOptionId: bad.id }) });
    } else {
      const wrongNumber = String(Number(good.text) + 1000000);
      await api(ca, `/api/duel/${did}/answer`, { method: "POST", body: JSON.stringify({ round, answer: good.text }) });
      await api(cb, `/api/duel/${did}/answer`, { method: "POST", body: JSON.stringify({ round, answer: wrongNumber }) });
    }
    for (let i = 0; i < 40; i++) {
      await sleep(120);
      ds = (await api(ca, `/api/duel/${did}`)).body;
      if (ds.round !== round || ds.status !== "IN_PROGRESS") break;
    }
    if (round === 1) {
      ok(ds.status === "IN_PROGRESS", "two wins in a row does not end it", ds.status);
      ok(ds.streaks?.host === 2, "streak counted at 2", ds.streaks);
    }
  }
  ok(ds.status === "COMPLETED", "three wins in a row ends the duel", { status: ds.status, streaks: ds.streaks, round: ds.round });
  ok(ds.streaks?.host === 3, "streak stopped at exactly 3", ds.streaks);
  ok(ds.winnerId === ua.id, "the streaking player wins", { winner: ds.winnerId, host: ua.id });
  ok(ds.pushedOffId === ub.id, "the loser goes over the edge", ds.pushedOffId);
} catch (e) {
  console.log("FAIL crashed:", e?.message || e);
  fail++;
} finally {
  await prisma.user.deleteMany({ where: { displayName: { in: NAMES } } });
  await prisma.$disconnect();
}

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
