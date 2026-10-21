// E2E for player presence ("Online acum" on the clasament page).
// Usage: BASE=http://127.0.0.1:3214 DATABASE_URL=... node scripts/presence-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3214";
const PW = "presence-e2e-pass";
const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};
let fail = 0;
const ok = (c, m, extra) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${!c && extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  if (!c) fail++;
};
const json = async (cookie, path, opts = {}) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
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

const tag = randomUUID().slice(0, 8);
const mkUser = (suffix) =>
  prisma.user.create({
    data: {
      email: `presence-${tag}-${suffix}`,
      displayName: `prez-${tag}-${suffix}`,
      passwordHash: hash(PW),
    },
    select: { id: true, displayName: true, email: true },
  });

async function main() {
  const a = await mkUser("a");
  const b = await mkUser("b");
  const stale = await mkUser("stale"); // never beats: joined, but not around
  await prisma.user.update({ where: { id: stale.id }, data: { lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) } });

  const ca = await login(a.email);
  const cb = await login(`presence-${tag}-b`);

  // --- anonymous callers cannot write or read presence --------------------
  ok((await json(null, "/api/presence", { method: "POST" })).status === 401, "anonymous heartbeat rejected");
  ok((await json(null, "/api/presence")).status === 401, "anonymous presence read rejected");

  // --- nobody has beaten yet ---------------------------------------------
  let lb = await json(ca, "/api/leaderboard?scope=all");
  ok(lb.status === 200, "leaderboard reachable", lb.status);
  ok(Array.isArray(lb.body?.online), "leaderboard carries an online list", lb.body?.online);
  ok(!(lb.body.online ?? []).some((p) => p.id === a.id), "a player who has not beaten is not online");

  // --- A beats, then shows up ---------------------------------------------
  const beatA = await json(ca, "/api/presence", { method: "POST" });
  ok(beatA.status === 200, "heartbeat accepted", beatA.body);
  lb = await json(ca, "/api/leaderboard?scope=all");
  const names = (lb.body.online ?? []).map((p) => p.name);
  ok(names.includes(a.displayName), "the beating player is listed as online", names);
  ok(!names.includes(stale.displayName), "a player last seen an hour ago is NOT online", names);
  ok(!names.includes(b.displayName), "a player who never beat is NOT online", names);
  ok(lb.body.onlineCount === (lb.body.online ?? []).length, "onlineCount matches the list", lb.body.onlineCount);
  ok(!JSON.stringify(lb.body.online).includes("@"), "the online list leaks no emails", lb.body.online);

  // --- B beats too: both, newest first ------------------------------------
  await json(cb, "/api/presence", { method: "POST" });
  const own = await json(cb, "/api/presence");
  // other tabs may also be beating on a shared dev DB — assert ours are present
  ok(
    own.status === 200 && own.body.players.length >= 2 && own.body.online === own.body.players.length,
    "both players online, count matches the list",
    { n: own.body?.players?.length, online: own.body?.online },
  );
  const ids = own.body.players.map((p) => p.id);
  ok(ids.includes(a.id) && ids.includes(b.id), "both players present", ids);
  ok(ids.indexOf(b.id) <= ids.indexOf(a.id), "most recent heartbeat comes first", ids);
  ok(own.body.players.every((p) => p.at), "each entry carries a timestamp");

  // --- the 2-minute window closes ----------------------------------------
  await prisma.user.update({ where: { id: a.id }, data: { lastSeenAt: new Date(Date.now() - 121_000) } });
  const after = await json(cb, "/api/presence");
  ok(!after.body.players.some((p) => p.id === a.id), "a heartbeat older than the window drops off");
  ok(after.body.players.some((p) => p.id === b.id), "a fresh heartbeat stays");

  // --- a heartbeat revives -------------------------------------------------
  await json(ca, "/api/presence", { method: "POST" });
  ok((await json(cb, "/api/presence")).body.players.some((p) => p.id === a.id), "beating again brings the player back");

  // --- the clasament page itself renders -----------------------------------
  const page = await fetch(`${BASE}/leaderboard`, { headers: { Cookie: cb } });
  const html = await page.text();
  ok(page.status === 200, "clasament page renders", page.status);
  ok(html.includes("Online acum"), "clasament page shows the online panel");

  await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id, stale.id] } } });
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("crashed:", e.message);
  process.exit(1);
});
