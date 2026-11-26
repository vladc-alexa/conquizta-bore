// E2E: tower-siege is server-synced — both players must press START, and both
// see the same question at the same time.
// Usage: BASE=http://127.0.0.1:3214 node scripts/siege-sync-e2e.mjs
const BASE = process.env.BASE || "http://127.0.0.1:3214";
let pass = 0,
  fail = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const stamp = Date.now().toString(36);

async function signup(tag) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9${Math.floor(Math.random() * 9)}.1.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({
      displayName: `S${tag}${stamp}`.slice(0, 32),
      email: `siege-${tag}-${stamp}@example.com`,
      password: "secret123",
    }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const json = await res.json().catch(() => null);
  if (!cookie) throw new Error(`signup ${tag} failed: ${res.status} ${JSON.stringify(json)}`);
  return {
    cookie,
    id: json?.user?.id ?? json?.id ?? null,
    name: json?.user?.displayName ?? json?.displayName ?? `S${tag}`,
  };
}

async function api(p, body, cookie) {
  const res = await fetch(`${BASE}${p}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function view(code, cookie) {
  const res = await fetch(`${BASE}/api/rooms?code=${code}`, { headers: { cookie } });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`siege-sync-e2e against ${BASE}`);
const A = await signup("a");
const B = await signup("b");
ok("two players registered", !!A.cookie && !!B.cookie);

// A creates the room, B joins it
const created = await api("/api/rooms", { action: "create", gameType: "siege" }, A.cookie);
const code = created.json?.room?.code;
ok("room created for siege", !!code, JSON.stringify(created.json?.error));
const joined = await api("/api/rooms", { action: "join", code }, B.cookie);
ok("B joined seat 2", joined.json?.room?.seats?.length === 2, JSON.stringify(joined.json?.room?.seats?.length));

// --- both must press START ---
const onlyA = await api("/api/rooms", { action: "start", code }, A.cookie);
ok("A pressing START alone does NOT start the game", onlyA.json?.room?.status === "waiting", onlyA.json?.room?.status);
const seatA = onlyA.json?.room?.seats?.[0];
ok("A's seat is flagged ready", seatA?.started === true, JSON.stringify(seatA));
ok("B's seat is NOT ready yet", onlyA.json?.room?.seats?.[1]?.started !== true);
ok("no question is served while waiting", !onlyA.json?.room?.roundQuestion);

const seat1Before = (await api(`/api/rooms?code=${code}`, null, B.cookie)).json?.room?.status;
ok("B still sees the room as waiting", seat1Before === "waiting", seat1Before);

const bothA = await api("/api/rooms", { action: "start", code }, B.cookie);
const roomStarted = bothA.json?.room;
ok("second START flips the room to playing", roomStarted?.status === "playing", roomStarted?.status);
ok("round 1 armed", roomStarted?.currentRound === 1);
ok("a shared question is served", !!roomStarted?.roundQuestion?.prompt, roomStarted?.roundQuestion?.prompt?.slice(0, 40));
ok("a server start timestamp is published", typeof roomStarted?.roundStartedAt === "number" && roomStarted.roundStartedAt > 0);

// --- same question, same clock, both clients ---
const viewA = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json;
const viewB = (await api(`/api/rooms?code=${code}`, null, B.cookie)).json;
ok("both clients get the identical question", viewA.room.roundQuestion.id === viewB.room.roundQuestion.id, `${viewA.room.roundQuestion.id} vs ${viewB.room.roundQuestion.id}`);
ok("both clients get the identical round seq", viewA.room.roundSeq === viewB.room.roundSeq);
ok("both clients get the identical start timestamp (same instant)", viewA.room.roundStartedAt === viewB.room.roundStartedAt);
ok("server clock is exposed to both", typeof viewA.serverNow === "number" && typeof viewB.serverNow === "number");

// --- answers are resolved by the server, not the client ---
const q = viewA.room.roundQuestion;
const wrong = (q.correctIndex + 1) % q.options.length;
await api("/api/rooms", { action: "submitAnswer", code, seq: viewA.room.roundSeq, elapsedMs: 900, choice: q.correctIndex }, A.cookie);
const mid = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
ok("one answer alone does not resolve the round", !mid.lastResult, JSON.stringify(mid.lastResult));

await api("/api/rooms", { action: "submitAnswer", code, seq: viewB.room.roundSeq, elapsedMs: 5000, choice: wrong }, B.cookie);
const doneA = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
const doneB = (await api(`/api/rooms?code=${code}`, null, B.cookie)).json.room;
ok("round resolves once both answered", !!doneA.lastResult, JSON.stringify(doneA.lastResult));
ok("both clients get the same verdict", JSON.stringify(doneA.lastResult) === JSON.stringify(doneB.lastResult));
ok("the correct answer is the one that fires", doneA.lastResult?.kind === "hit" && doneA.lastResult?.attacker === "left", JSON.stringify(doneA.lastResult));
ok("verdict carries a deterministic target seed", typeof doneA.lastResult?.targetSeed === "number");

// --- advance is idempotent: two clients calling it must not skip a round ---
const seqBefore = (await view(code, A.cookie)).room.roundSeq;
const tAdv = Date.now();
const advA = await api("/api/rooms", { action: "advance", code, round: 1 }, A.cookie);
const advB = await api("/api/rooms", { action: "advance", code, round: 1 }, B.cookie);
const advanced = advA.json?.room;
console.log(`  ·   advance POST round-trip: ${Date.now() - tAdv}ms`);
ok(
  "next question is already armed on the same response (prefetched)",
  !!advanced?.roundQuestion && advanced.roundSeq > seqBefore
);
ok("advance moves to round 2 exactly once", advA.json?.room?.currentRound === 2 && advB.json?.room?.currentRound === 2, `${advA.json?.room?.currentRound}/${advB.json?.room?.currentRound}`);
ok("round 2 question is served", !!advA.json?.room?.roundQuestion?.prompt);

// --- tiebreaker: both correct -> numeric round served to both ---
const q2A = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
const q2 = q2A.roundQuestion;
await api("/api/rooms", { action: "submitAnswer", code, seq: q2A.roundSeq, elapsedMs: 1200, choice: q2.correctIndex }, A.cookie);
await api("/api/rooms", { action: "submitAnswer", code, seq: q2A.roundSeq, elapsedMs: 1500, choice: q2.correctIndex }, B.cookie);
const tieA = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
const tieB = (await api(`/api/rooms?code=${code}`, null, B.cookie)).json.room;
ok("both-correct triggers the numeric tiebreaker", tieA.roundMode === "rapide" && !!tieA.roundQuestion?.answer, tieA.roundMode);
ok("tiebreaker question is identical for both", tieA.roundQuestion.id === tieB.roundQuestion.id);
ok("no verdict is published before the tiebreaker is answered", !tieA.lastResult);

const tq = tieA.roundQuestion;
await api("/api/rooms", { action: "submitAnswer", code, seq: tieA.roundSeq, elapsedMs: 1800, guess: tq.answer }, A.cookie);
await api("/api/rooms", { action: "submitAnswer", code, seq: tieA.roundSeq, elapsedMs: 2600, guess: tq.answer + 7 }, B.cookie);
const tieRes = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room.lastResult;
ok("tiebreaker picks the closer guess", tieRes?.kind === "hit" && tieRes?.attacker === "left" && tieRes?.tie === true, JSON.stringify(tieRes));

// --- timeout is enforced server-side (no client answer at all) ---
await api("/api/rooms", { action: "advance", code, round: 2 }, A.cookie);
const q3 = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
const limitMs = 12_000;
await sleep(Math.max(0, q3.roundStartedAt + limitMs - Date.now()) + 800);
const timedOut = (await api(`/api/rooms?code=${code}`, null, A.cookie)).json.room;
ok("server resolves an unanswered round on its own deadline", !!timedOut.lastResult, JSON.stringify(timedOut.lastResult?.kind));
ok("nobody answered -> no catapult fires", timedOut.lastResult?.kind === "both-wrong", timedOut.lastResult?.kind);

// --- rematch puts the room back to the ready-up state ---
const reset = await api("/api/rooms", { action: "reset", code }, A.cookie);
ok("reset returns to waiting", reset.json?.room?.status === "waiting");
ok("reset clears round state", !reset.json?.room?.roundQuestion && !reset.json?.room?.lastResult);
ok("reset clears both seats' START flags", reset.json?.room?.seats?.every((s) => !s.started));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
