// Two-player E2E for the 1v1 duel: drives the real HTTP API against a running
// server, plus checks the DB side-effects (plan shape, PRC sessions).
// Usage: node scripts/duel-e2e.mjs            (BASE=http://127.0.0.1:3210)
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3210";
const PW = "duel-e2e-pass";

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

const NAME_A = "duel-e2e-a";
const NAME_B = "duel-e2e-b";
const NAME_C = "duel-e2e-c";
let id = null;

try {
  // ---- fixtures -----------------------------------------------------------
  await prisma.user.deleteMany({ where: { displayName: { in: [NAME_A, NAME_B, NAME_C] } } });
  const ua = await prisma.user.create({ data: { displayName: NAME_A, passwordHash: hash(PW) } });
  const ub = await prisma.user.create({ data: { displayName: NAME_B, passwordHash: hash(PW) } });
  const uc = await prisma.user.create({ data: { displayName: NAME_C, passwordHash: hash(PW) } });
  const ca = await login(NAME_A);
  const cb = await login(NAME_B);
  const cc = await login(NAME_C);

  // ---- create ------------------------------------------------------------
  const created = await api(ca, "/api/duel", { method: "POST" });
  ok(created.status === 201 && !!created.body?.duelId, `A creates a duel (201)`);
  id = created.body.duelId;

  let st = (await api(ca, `/api/duel/${id}`)).body;
  ok(st.status === "WAITING" && st.role === "host", "A sees WAITING as host");
  ok(st.totalRounds === 10, "totalRounds = 10");

  const duel = await prisma.duel.findUnique({ where: { id } });
  const plan0 = duel.plan;
  ok(plan0.length === 10, "plan has 10 rounds");
  ok(
    plan0.filter((p) => p.mode === "grila").length === 6 && plan0.filter((p) => p.mode === "rapide").length === 4,
    "plan = 6 grila + 4 rapide"
  );
  ok(
    plan0.map((p) => p.mode[0].toUpperCase()).join("") === "GRGRGRGRGG",
    `round order: ${plan0.map((p) => p.mode[0].toUpperCase()).join("")}`
  );

  // ---- access control ----------------------------------------------------
  const peek = await api(cc, `/api/duel/${id}`);
  ok(peek.status === 403, "outsider cannot read the match (403)");
  const earlyJoin = await api(cb, `/api/duel/${id}/join`, { method: "POST" });
  ok(earlyJoin.status === 200, "B joins while WAITING");
  st = (await api(ca, `/api/duel/${id}`)).body;
  // joining no longer starts the match: the host presses Start from the lobby
  ok(st.status === "WAITING" && !!st.guest, "B is seated but the match is still WAITING");
  const guestStart = await api(cb, `/api/duel/${id}/start`, { method: "POST" });
  ok(guestStart.status === 403, "guest cannot press Start (403)");
  const started = await api(ca, `/api/duel/${id}/start`, { method: "POST" });
  ok(started.status === 200, "host presses Start from the lobby (200)");
  st = (await api(ca, `/api/duel/${id}`)).body;
  ok(st.status === "IN_PROGRESS" && st.round === 0 && st.mode === "grila", "match starts, round 0 = grila");
  ok(!!st.prompt && (st.options?.length ?? 0) === 4, "round 0 payload has a prompt + 4 options");
  ok(!JSON.stringify(st).includes("correctOptionId"), "public payload leaks no correct answer");
  const lateJoin = await api(cc, `/api/duel/${id}/join`, { method: "POST" });
  ok(lateJoin.status === 409, "late joiner rejected (409)");
  const openList = (await api(ca, "/api/duel/open")).body;
  ok(openList.mine?.id === id && openList.mine?.status === "IN_PROGRESS", "lobby shows my running match");

  // ---- play: alternate first-answerer so every round has a winner ---------
  const answer = async (cookie, round, entry, correct, who) => {
    // small gap so the first answerer is unambiguously faster on the server
    await new Promise((r) => setTimeout(r, who === "first" ? 0 : 120));
    const payload =
      entry.mode === "grila"
        ? { selectedOptionId: correct ? entry.correctOptionId : entry.options.find((o) => o.id !== entry.correctOptionId).id }
        : { answer: String(correct ? entry.answer : entry.answer + 4242) };
    return api(cookie, `/api/duel/${id}/answer`, {
      method: "POST",
      body: JSON.stringify({ round, ...payload }),
    });
  };

  let final = null;
  for (let g = 0; g < 30; g++) {
    const cur = (await api(ca, `/api/duel/${id}`)).body;
    if (cur.status === "COMPLETED") {
      final = cur;
      break;
    }
    const d = await prisma.duel.findUnique({ where: { id } });
    const entry = d.plan[cur.round];
    const aFirst = cur.round % 2 === 1; // odd rounds: A wins; even: B wins
    const [rA, rB] = aFirst
      ? [await answer(ca, cur.round, entry, true, "first"), await answer(cb, cur.round, entry, false, "second")]
      : [await answer(cb, cur.round, entry, true, "first"), await answer(ca, cur.round, entry, false, "second")];
    ok(rA.status === 200 && rB.status === 200, `round ${cur.round} (${entry.mode}): both answers accepted`);
    const nxt = (await api(ca, `/api/duel/${id}`)).body;
    ok(nxt.round === cur.round + 1 || nxt.status === "COMPLETED", `round ${cur.round} resolved -> round ${nxt.round}`);
  }

  ok(!!final, "match reached COMPLETED");
  if (final) {
    console.log(
      `   final ${final.host.score}-${final.guest.score} · rounds played ${final.history.length} · totalRounds ${final.totalRounds}`
    );
    ok(final.history.length >= 10, "at least 10 rounds recorded");
    ok(final.host.score + final.guest.score === final.history.length, "every round had a winner");
    ok(final.draw === false && !!final.winnerId, "a winner was decided");
    ok(final.winnerId === ub.id, "guest (B) won");
    ok(final.guest.score > final.host.score, "guest score is higher");
    // rapid answer content is revealed only after the round
    const h0 = final.history[0];
    ok(!!h0.reveal && h0.answers.length === 2, "history reveals the answer + both players' results");
  }

  // ---- side effects: duel answers feed the PRC leaderboard ---------------
  const sessions = await prisma.quizSession.findMany({
    where: { userId: { in: [ua.id, ub.id] }, status: "COMPLETED" },
    include: { answers: true },
  });
  ok(sessions.length === 2, "a COMPLETED quiz session was written for each player");
  ok(sessions.every((s) => s.answers.length >= 10), "each session carries the player's duel answers");

  // ---- duplicate / closed-round guards ----------------------------------
  const dup = await api(ca, `/api/duel/${id}/answer`, {
    method: "POST",
    body: JSON.stringify({ round: 0, selectedOptionId: plan0[0].correctOptionId }),
  });
  ok(dup.status === 409, "answering a closed round is rejected (409)");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  try {
    if (id) await prisma.duel.delete({ where: { id } });
    const users = await prisma.user.findMany({ where: { displayName: { in: [NAME_A, NAME_B, NAME_C] } } });
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.quizSession.deleteMany({ where: { userId: { in: ids } } });
      // remove any duel answers left behind, then the users
      await prisma.duelAnswer.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    console.log("cleanup done");
  } catch (e) {
    console.error("CLEANUP ERROR:", e.message);
  }
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
