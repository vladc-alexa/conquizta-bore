// Turnul lobby E2E: a seat in another tower must never make the lobby's "Intră"
// button useless. Joining another tower releases the old seat (waiting room ->
// seat gone / host abandons, running climb -> marked fallen), and a zombie run
// nobody has touched for TOWER_LIVE_MS stops claiming "Continuă urcarea".
// Usage: BASE=http://localhost:3210 node scripts/tower-lobby-e2e.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://localhost:3210";
const PW = "tower-lobby-pass";

let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) fail++;
};

let ipSeq = 1;
async function signup(name, email) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.7.7.${ipSeq++}` },
    body: JSON.stringify({ displayName: name, email, password: PW }),
  });
  if (r.status !== 201) throw new Error(`signup ${name} -> ${r.status} ${await r.text()}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function api(cookie, path, method = "GET") {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

try {
  const A = { name: "lobby-vlad", email: "lobby-vlad@example.test" };
  const B = { name: "lobby-maria", email: "lobby-maria@example.test" };
  const ca = await signup(A.name, A.email);
  const cb = await signup(B.name, B.email);
  const meA = (await prisma.user.findUnique({ where: { email: A.email }, select: { id: true } })).id;

  // Vlad opens a tower and starts it, so he is mid-climb
  const opened = await api(ca, "/api/tower", "POST");
  ok([200, 201].includes(opened.status) && !!opened.body.gameId, `open my tower (${opened.status})`);
  const towerA = opened.body.gameId;
  ok((await api(ca, `/api/tower/${towerA}/start`, "POST")).status === 200, "host starts the climb (bots fill seats)");

  const open1 = await api(ca, "/api/tower/open");
  ok(open1.body.mine?.id === towerA && open1.body.mine?.status === "IN_PROGRESS", "lobby offers Continue for my running climb");

  // Maria opens a second tower
  const opened2 = await api(cb, "/api/tower", "POST");
  const towerB = opened2.body.gameId;
  ok(!!towerB, "second tower open");
  const listForVlad = await api(ca, "/api/tower/open");
  ok(listForVlad.body.games.some((g) => g.id === towerB), "the other tower is listed for me (so Intră is reachable)");

  // Vlad walks into Maria's tower instead
  const joined = await api(ca, `/api/tower/${towerB}/join`, "POST");
  ok(joined.status === 200 && !joined.body.alreadySeated, `join the other tower while mid-climb (${joined.status})`);
  const seatA = await prisma.towerPlayer.findFirst({
    where: { gameId: towerA, userId: meA },
    select: { eliminated: true, fellRound: true },
  });
  ok(seatA?.eliminated === true, "my old climb marks me as fallen");

  const open2 = await api(ca, "/api/tower/open");
  ok(open2.body.mine?.id === towerB && open2.body.mine?.status === "WAITING", "lobby now points at the new table");

  // Zombie: a running climb nobody polls must stop holding me
  await api(ca, `/api/tower/${towerB}/leave`, "POST");
  const openedC = await api(ca, "/api/tower", "POST");
  const towerC = openedC.body.gameId;
  ok(!!towerC, "open a third tower");
  ok((await api(ca, `/api/tower/${towerC}/start`, "POST")).status === 200, "start it");
  ok((await api(ca, "/api/tower/open")).body.mine?.id === towerC, "the fresh run is mine");
  await prisma.$executeRaw`UPDATE "TowerGame" SET "updatedAt" = now() - interval '40 minutes' WHERE id = ${towerC}::uuid`;
  const open3 = await api(ca, "/api/tower/open");
  ok(open3.body.mine === null, "a stale run no longer claims my seat");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  try {
    await prisma.user.deleteMany({ where: { email: { in: ["lobby-vlad@example.test", "lobby-maria@example.test"] } } });
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
