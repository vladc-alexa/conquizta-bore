// Invitations E2E: a seated host calls an online player in, the player accepts,
// and lands in the room. Covers decline, expiry, double-invite, a room that
// already started, inviting from outside a room, and inviting someone seated.
// Usage: BASE=http://localhost:3210 DATABASE_URL=... node scripts/invites-e2e.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://localhost:3210";
const PW = "invites-e2e-pass";
let ip = 1;
let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) fail++;
};

async function signup(name) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@invites.test`;
  await prisma.user.deleteMany({ where: { email } });
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.31.0.${ip++}` },
    body: JSON.stringify({ displayName: name, email, password: PW }),
  });
  if (r.status !== 201) throw new Error(`signup ${name}: ${r.status} ${await r.text()}`);
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
  } catch {}
  return { status: r.status, body };
}

const HOST = "InvHost";
const GUEST = "InvGuest";
const THIRD = "InvThird";

try {
  const host = await signup(HOST);
  const guest = await signup(GUEST);
  const third = await signup(THIRD);

  // --- tower ---
  const open = await api(host, "/api/tower", { method: "POST", body: JSON.stringify({}) });
  ok(open.status === 201 || open.status === 200, `host opens a tower (${open.status})`);
  const towerId = open.body.gameId;
  const guestId = (await prisma.user.findUnique({ where: { displayName: GUEST } })).id;

  const noSeat = await api(third, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "tower", gameId: towerId, toId: guestId }),
  });
  ok(noSeat.status === 403, `outsider cannot invite into a room they are not in (${noSeat.status})`);

  const inv = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "tower", gameId: towerId, toId: guestId }),
  });
  ok(inv.status === 201, `host invites the guest (${inv.status})`);

  const inv2 = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "tower", gameId: towerId, toId: guestId }),
  });
  ok(inv2.status === 201, "re-inviting refreshes instead of failing");

  const list = await api(guest, "/api/invites");
  const mine = (list.body.invites || []).filter((i) => i.gameId === towerId);
  ok(mine.length === 1, `guest sees exactly one pending invite (got ${mine.length})`);
  ok(mine[0]?.kind === "tower" && mine[0]?.fromName === HOST, "invite names the tower and the host");
  ok(mine[0]?.seated === 1 && mine[0]?.seats === 8, `invite shows seats ${mine[0]?.seated}/${mine[0]?.seats}`);

  const acc = await api(guest, `/api/invites/${mine[0].id}/accept`, { method: "POST" });
  ok(acc.status === 200, `guest accepts (${acc.status})`);
  ok(acc.body.href === `/tower/${towerId}`, `accept points at the table (${acc.body.href})`);
  const after = await api(guest, "/api/invites");
  ok((after.body.invites || []).length === 0, "accepted invite leaves the list");
  const room = await api(host, "/api/tower/open");
  ok(room.body.mine?.players?.includes(GUEST), "guest actually has a chair");

  const twice = await api(guest, `/api/invites/${mine[0].id}/accept`, { method: "POST" });
  ok(twice.status === 409, `accepting twice is refused (${twice.status})`);

  // inviting somebody already seated
  const dupSeat = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "tower", gameId: towerId, toId: guestId }),
  });
  ok(dupSeat.status === 409, `inviting a seated player is refused (${dupSeat.status})`);

  // --- carciuma: decline + expiry + started room ---
  const cq = await api(host, "/api/carciuma", { method: "POST", body: JSON.stringify({}) });
  const cqId = cq.body.gameId;
  const thirdId = (await prisma.user.findUnique({ where: { displayName: THIRD } })).id;
  const cqInv = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "carciuma", gameId: cqId, toId: thirdId }),
  });
  ok(cqInv.status === 201, `host invites to a carciuma table (${cqInv.status})`);
  const cqList = await api(third, "/api/invites");
  ok((cqList.body.invites || []).some((i) => i.gameId === cqId && i.kind === "carciuma"), "carciuma invite reaches the guest");
  const dec = await api(third, `/api/invites/${cqInv.body.invite.id}/decline`, { method: "POST" });
  ok(dec.status === 200, `guest declines (${dec.status})`);
  const cqAfter = await api(third, "/api/invites");
  ok(!(cqAfter.body.invites || []).some((i) => i.gameId === cqId), "declined invite disappears");

  const expInv = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "carciuma", gameId: cqId, toId: thirdId }),
  });
  await prisma.gameInvite.update({ where: { id: expInv.body.invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await api(third, `/api/invites/${expInv.body.invite.id}/accept`, { method: "POST" });
  ok(expired.status === 410, `expired invite cannot be accepted (${expired.status})`);
  const expList = await api(third, "/api/invites");
  ok(!(expList.body.invites || []).some((i) => i.id === expInv.body.invite.id), "expired invite is not listed");

  const guest2 = await signup("InvGuest2");
  const g2 = await prisma.user.findUnique({ where: { displayName: "InvGuest2" } });
  const lateInv = await api(host, "/api/invites", {
    method: "POST",
    body: JSON.stringify({ kind: "carciuma", gameId: cqId, toId: g2.id }),
  });
  ok(lateInv.status === 201, "invite sent before the table starts");
  await api(guest, `/api/carciuma/${cqId}/join`, { method: "POST", body: JSON.stringify({}) });
  const started = await api(host, `/api/carciuma/${cqId}/start`, { method: "POST", body: JSON.stringify({ fillWithBots: true }) });
  if (started.status !== 200) console.log("   start said:", started.status, JSON.stringify(started.body));
  const late = await api(guest2, `/api/invites/${lateInv.body.invite.id}/accept`, { method: "POST" });
  ok(late.status === 409, `accepting after the table starts is refused (${late.status})`);

  void guest2;
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  try {
    await prisma.user.deleteMany({ where: { displayName: { in: [HOST, GUEST, THIRD, "InvGuest2"] } } });
    await prisma.gameInvite.deleteMany({ where: { from: { displayName: { in: [HOST, GUEST, THIRD] } } } });
  } catch {}
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
