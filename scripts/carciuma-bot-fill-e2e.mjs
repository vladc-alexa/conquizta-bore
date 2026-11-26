// Cârciuma bot-fill E2E: a host who sits down alone can start the sitting —
// the empty chairs are taken by locals on start, exactly like the tower.
//   DATABASE_URL=... BASE=http://127.0.0.1:PORT node scripts/carciuma-bot-fill-e2e.mjs
// Expects a warm server (`next start`) and a seeded question bank.
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name} ${extra ? `— ${extra}` : ""}`);
  }
}

let ip = 0;
async function req(path, { method = "GET", cookie, body } = {}) {
  ip += 1;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "x-forwarded-for": `10.9.${(ip % 250) + 1}.${(ip % 240) + 1}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, text, json, cookie: setCookie?.split(";")[0] };
}

const stamp = Date.now().toString(36);

async function player(tag) {
  const p = await req("/api/auth/register", {
    method: "POST",
    body: { displayName: `Bot${tag}${stamp}`.slice(0, 20), email: `bot-${tag}-${stamp}@example.test`, password: `pw-${stamp}-${tag}` },
  });
  if (p.status !== 201) throw new Error(`register ${tag}: ${p.status} ${p.text.slice(0, 120)}`);
  return { name: p.json.name, cookie: p.cookie };
}

const host = await player("h");

// 1. host opens a table and is alone
const created = await req("/api/carciuma", { method: "POST", cookie: host.cookie });
const id = created.json?.gameId ?? created.json?.id;
ok("host opens a table", created.status === 201 && !!id, created.status + created.text.slice(0, 120));

const before = await req(`/api/carciuma/${id}`, { cookie: host.cookie });
ok("one chair taken before start", before.json?.players?.length === 1, before.json?.players?.length);

// 2. start alone: no "need 2 players" error
const started = await req(`/api/carciuma/${id}/start`, { method: "POST", cookie: host.cookie });
ok("solo host can start the sitting", started.status === 200, started.status + started.text.slice(0, 140));

const after = await req(`/api/carciuma/${id}`, { cookie: host.cookie });
const players = after.json?.players ?? [];
const bots = players.filter((p) => p.isBot);
ok("start fills every empty chair", players.length === after.json?.seats, JSON.stringify({ players: players.length, seats: after.json?.seats }));
ok("four locals joined", bots.length === 4, bots.length);
ok("the host is still seated", players.some((p) => p.mine));
ok("no duplicate names at the table", new Set(players.map((p) => p.name)).size === players.length, players.map((p) => p.name).join(", "));
ok("bots are not the host", !bots.some((p) => p.mine));

// 3. second start is refused (state moved on) — bots must not be added twice
const again = await req(`/api/carciuma/${id}/start`, { method: "POST", cookie: host.cookie });
ok("starting twice is refused", again.status === 409, again.status);
const after2 = await req(`/api/carciuma/${id}`, { cookie: host.cookie });
ok("no extra chairs after the refused start", (after2.json?.players?.length ?? 0) === players.length, after2.json?.players?.length);

// 4. the round actually works: the locals answer, so a round can settle
let settledRows = [];
for (let i = 0; i < 30 && settledRows.length < 2; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  const st = await req(`/api/carciuma/${id}`, { cookie: host.cookie });
  const rows = st.json?.lastRound?.rows ?? [];
  if (rows.length) settledRows = rows;
}
const botIds = new Set(bots.map((p) => p.id));
ok("a round settled with the locals in it", settledRows.length >= 2, settledRows.length);
ok(
  "the locals actually answered",
  settledRows.some((r) => botIds.has(r.playerId)),
  settledRows.map((r) => r.playerId).join(","),
);

console.log(fail === 0 ? `\nall ${pass} checks passed` : `\n${fail} FAILED of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
