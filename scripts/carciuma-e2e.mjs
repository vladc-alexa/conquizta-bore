// E2E for La Carciuma. Needs a built app + seeded grilă questions, and short
// round timings on the server:
//   CARCIUMA_ROUND_MS=2500 CARCIUMA_ROUND_GRACE_MS=400 CARCIUMA_INTERMISSION_MS=600 next start
//   BASE=http://127.0.0.1:3111 node scripts/carciuma-e2e.mjs
const BASE = process.env.BASE || "http://127.0.0.1:3111";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
const stamp = Date.now().toString(36);

async function req(path, { method = "GET", body, cookie, ip } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": ip || `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const set = res.headers.get("set-cookie");
  return { status: res.status, json, text, cookie: set ? set.split(";")[0] : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signup(tag) {
  const r = await req("/api/auth/register", {
    method: "POST",
    body: { email: `carciuma-${tag}-${stamp}@example.com`, password: "parola12345", displayName: `Cq${tag}${stamp}`.slice(0, 32) },
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`register ${tag} failed ${r.status} ${r.text.slice(0, 200)}`);
  return { cookie: r.cookie, name: `Cq${tag}${stamp}`.slice(0, 32) };
}

console.log(`carciuma-e2e against ${BASE}`);
const a = await signup("a");
const b = await signup("b");

// lobby page + dashboard carry the new pieces
const dash = await req("/", { cookie: a.cookie });
ok("dashboard 200", dash.status === 200, dash.status);
ok("dashboard shows La Carciuma box", /La Carciuma/.test(dash.text));
ok("dashboard shows registered players box", /înregistrați/i.test(dash.text));

const created = await req("/api/carciuma", { method: "POST", cookie: a.cookie });
ok("create table", created.status === 201 && !!created.json?.gameId, created.status);
const id = created.json?.gameId;
let st = (await req(`/api/carciuma/${id}`, { cookie: a.cookie })).json;
ok("host opens a 5-seat table", st?.players?.length === 1 && (st.seats ?? 0) === 5, JSON.stringify({ players: st?.players?.length, seats: st?.seats }));
ok("host sits at seat 0", st?.players?.[0]?.mine === true);

const open = await req("/api/carciuma/open", { cookie: b.cookie });
ok("open table listed for others", (open.json?.games ?? []).some((g) => g.id === id), JSON.stringify(open.json).slice(0, 200));

const page = await req(`/carciuma/${id}`, { cookie: a.cookie });
ok("table page 200", page.status === 200, page.status);

const joined = await req(`/api/carciuma/${id}/join`, { method: "POST", cookie: b.cookie });
ok("guest takes a chair", joined.status === 200, joined.status + joined.text.slice(0, 120));

const started = await req(`/api/carciuma/${id}/start`, { method: "POST", cookie: a.cookie });
ok("host starts the sitting", started.status === 200, started.status + started.text.slice(0, 120));
st = (await req(`/api/carciuma/${id}`, { cookie: a.cookie })).json;
ok("five chairs filled at the table", st?.players?.length === 5, st?.players?.length);

// play until the table settles
const seen = { rounds: 0, drinkers: new Map(), passed: new Set(), maxDrinks: 0, badRounds: [], answerErrors: [] };
let final = null;
for (let i = 0; i < 400; i++) {
  st = (await req(`/api/carciuma/${id}`, { cookie: a.cookie })).json;
  if (!st) break;
  if (st.status === "COMPLETED") { final = st; break; }
  if (st.question && !st.myAnswered) {
    // grilă: pick a letter; rapidă: type a number (wrong on purpose, every so often)
    const body =
      st.question.mode === "rapide"
        ? { answer: String(10 + (i % 5) * 7) }
        : { selectedOptionId: st.question.options[i % st.question.options.length].id };
    const r = await req(`/api/carciuma/${id}/answer`, { method: "POST", cookie: a.cookie, body });
    if (r.status >= 400) seen.answerErrors.push(`${st.question.mode} -> ${r.status} ${r.text.slice(0, 80)}`);
  }
  if (st.lastRound && st.lastRound.round > seen.rounds) {
    seen.rounds = st.lastRound.round;
    const rows = st.lastRound.rows || [];
    const drinkers = rows.filter((r) => r.drank);
    if (rows.length < 1 || rows.length > 5) seen.badRounds.push(`round ${st.lastRound.round}: ${rows.length} rows`);
    if (drinkers.length !== 1) seen.badRounds.push(`round ${st.lastRound.round}: ${drinkers.length} drinkers`);
    for (const d of drinkers) seen.drinkers.set(d.name, (seen.drinkers.get(d.name) || 0) + 1);
  }
  for (const p of st.players || []) {
    if (p.drinks > 3) seen.badRounds.push(`${p.name} drank ${p.drinks}`);
    seen.maxDrinks = Math.max(seen.maxDrinks, p.drinks);
    if (p.passedOut) {
      seen.passed.add(p.name);
      if (p.drinks !== 3) seen.badRounds.push(`${p.name} passed out at ${p.drinks}`);
    }
  }
  await sleep(220);
}

ok("game finished", !!final && final.status === "COMPLETED");
ok("rounds were played", seen.rounds >= 3, seen.rounds);
ok("no answer was rejected", seen.answerErrors.length === 0, seen.answerErrors.slice(0, 3).join(" | "));
  ok("every settled round had exactly one drinker", seen.badRounds.length === 0, seen.badRounds.slice(0, 4).join(" | "));
ok("three drinks is the limit", seen.maxDrinks === 3, seen.maxDrinks);
ok("players passed out", seen.passed.size >= 1, seen.passed.size);
const awake = (final?.players ?? []).filter((p) => !p.passedOut);
ok("at most one patron left standing", awake.length <= 1, awake.length);
ok("winner matches the table state", awake.length ? final?.winnerName === awake[0].name : final?.winnerName === null, JSON.stringify(final?.winnerName));
ok("passed-out patrons all have 3 drinks", (final?.players ?? []).filter((p) => p.passedOut).every((p) => p.drinks === 3));

// leaving a table
const left = await req(`/api/carciuma/${id}/leave`, { method: "POST", cookie: b.cookie });
ok("guest can walk out", left.status === 200, left.status);

const stats = await req("/api/players", { cookie: a.cookie });
ok("players API lists the accounts", (stats.json?.players ?? []).length >= 2, (stats.json?.players ?? []).length);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
