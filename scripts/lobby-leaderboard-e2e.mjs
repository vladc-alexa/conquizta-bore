// E2E for the dashboard lobby + full leaderboard page.
// Covers: create-match -> visible to other players -> Join -> ACTIVE;
// /leaderboard shows score, games played and join date; the old link/code
// copy flow is gone; the "N mesaje" counter is gone.
// Usage: BASE=http://127.0.0.1:3211 node scripts/lobby-leaderboard-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3211";
const PW = "lobby-e2e-pass";
const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};

let fail = 0;
const ok = (c, m, extra) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}${c ? "" : " " + JSON.stringify(extra ?? "")}`);
  if (!c) fail++;
};

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${email} -> ${r.status}`);
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
  return { status: r.status, body, headers: r.headers };
}
async function page(cookie, path) {
  const r = await fetch(BASE + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  const html = r.status === 200 ? await r.text() : "";
  return { status: r.status, html, location: r.headers.get("location") };
}

const EMAIL_A = "lb-e2e-a@example.com";
const EMAIL_B = "lb-e2e-b@example.com";

try {
  // ---- fixtures: two fresh players + one playable grila question ----------
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
  const ua = await prisma.user.create({
    data: { email: EMAIL_A, displayName: "lb-e2e-a", passwordHash: hash(PW), createdAt: new Date("2026-03-04T10:00:00Z") },
  });
  await prisma.user.create({ data: { email: EMAIL_B, displayName: "lb-e2e-b", passwordHash: hash(PW) } });

  // A duel needs 6 grilă + 4 rapidă questions, so seed a small pool.
  const mkQ = (n, numeric) =>
    prisma.question.create({
      data: {
        prompt: `lobby-e2e: intrebarea ${n}?`,
        isPublished: true,
        options: {
          create: [0, 1, 2, 3].map((i) => ({
            text: numeric ? String(n * 10 + i) : `${n} varianta ${i}`,
            position: i,
            isCorrect: i === 2,
          })),
        },
      },
      include: { options: true },
    });
  const q = await mkQ(1, false);
  for (let i = 2; i <= 6; i++) await mkQ(i, false);
  for (let i = 7; i <= 12; i++) await mkQ(i, true);
  const correctOpt = q.options.find((o) => o.isCorrect);

  const ca = await login(EMAIL_A);
  const cb = await login(EMAIL_B);

  // ---- a real completed game so the standings have data -------------------
  const s = await api(ca, "/api/sessions", { method: "POST", body: JSON.stringify({ mode: "grila" }) });
  ok(s.status === 201 && !!s.body?.sessionId, "start a grila session", s.body);
  const sid = s.body.sessionId;
  const an = await api(ca, `/api/sessions/${sid}/answers`, {
    method: "POST",
    body: JSON.stringify({ questionId: q.id, isCorrect: true, selectedOptionId: correctOpt.id, elapsedMs: 2500 }),
  });
  ok(an.status === 200, "record a correct answer", an.body);
  const done = await api(ca, `/api/sessions/${sid}/complete`, { method: "POST", body: JSON.stringify({ correctCount: 1 }) });
  ok(done.status === 200, "complete the session", done.body);

  // ---- leaderboard API: score, games, joinedAt ---------------------------
  const lb = await api(ca, "/api/leaderboard?scope=all");
  ok(lb.status === 200, "GET /api/leaderboard?scope=all", lb.status);
  const rowA = (lb.body?.rows ?? []).find((r) => r.id === ua.id);
  ok(!!rowA, "my row is in the full standings", lb.body?.rows);
  ok(rowA?.games === 1, "row carries games played", rowA);
  ok(typeof rowA?.prc === "number", "row carries a PRC score", rowA);
  ok(rowA?.joinedAt?.startsWith("2026-03-04"), "row carries the join date", rowA?.joinedAt);
  const rowB = (lb.body?.rows ?? []).find((r) => r.id !== ua.id && r.name === "lb-e2e-b");
  ok(!rowB, "players with no games are not ranked", rowB);

  // ---- 1v1: create on the dashboard, join from another account ----------
  let open = await api(cb, "/api/duel/open");
  ok(open.status === 200, "GET /api/duel/open", open.status);
  ok(Array.isArray(open.body?.games), "open lobby returns a games list", open.body);

  const created = await api(ca, "/api/duel", { method: "POST" });
  ok(created.status === 201 || created.status === 200, "create a 1v1 match", created.body);
  const duelId = created.body?.duelId;
  ok(!!duelId, "create returns a duel id", created.body);

  // (the Join button itself is client-rendered after the lobby fetch, so it is
  // verified in a real browser rather than in this SSR-HTML check)

  open = await api(cb, "/api/duel/open");
  const seen = (open.body?.games ?? []).find((g) => g.id === duelId);
  ok(!!seen, "B sees A's match in the open lobby", open.body?.games);
  ok(seen?.hostName === "lb-e2e-a", "open match shows the host name", seen);
  ok(seen?.mine === false, "open match is joinable (mine=false)", seen);
  ok(!("code" in (seen ?? {})) && !("link" in (seen ?? {})), "no code/link in the lobby payload", seen);

  const mine = await api(ca, "/api/duel/open");
  ok((mine.body?.games ?? []).find((g) => g.id === duelId)?.mine === true, "host sees the match as own", mine.body);

  const joined = await api(cb, `/api/duel/${duelId}/join`, { method: "POST" });
  ok(joined.status === 200, "Join button endpoint works", joined.body);

  open = await api(cb, "/api/duel/open");
  ok(!(open.body?.games ?? []).some((g) => g.id === duelId), "joined match leaves the open list", open.body?.games);

  // a fresh waiting match for the "no copy link" check
  const waiting = await api(ca, "/api/duel", { method: "POST" });
  const waitingId = waiting.body?.duelId;
  const wPage = await page(ca, `/duel/${waitingId}`);
  ok(wPage.status === 200, "waiting screen renders", wPage.status);
  ok(!wPage.html.includes("Copiază linkul"), "waiting screen no longer offers copy-link", null);
  ok(!wPage.html.includes("Lipeste codul"), "no code-paste box", null);

  // ---- pages -------------------------------------------------------------
  const dash = await page(ca, "/");
  ok(dash.status === 200, "dashboard renders", dash.status);
  ok(dash.html.includes("Clasament"), "top row has a Clasament button", null);
  ok(dash.html.includes('href="/leaderboard"'), "Clasament points at /leaderboard", null);
  ok(dash.html.includes("Meciuri deschise"), "dashboard has the open-matches box", null);
  ok(dash.html.includes("Creează meci"), "dashboard can create a match", null);
  ok(!dash.html.includes("Clasamentul zilei"), "daily leaderboard box is gone", null);
  ok(!/\d+\s*mesaje/.test(dash.html), "message counter is gone", null);

  const lbPage = await page(ca, "/leaderboard");
  ok(lbPage.status === 200, "/leaderboard renders", lbPage.status);
  ok(lbPage.html.includes("Scor") && lbPage.html.includes("Meciuri") && lbPage.html.includes("Înscris"), "table headers: score / games / joined", null);

  const lbAnon = await page(null, "/leaderboard");
  ok(lbAnon.status === 307 || lbAnon.status === 302, "anonymous /leaderboard redirects", lbAnon.status);
  ok((lbAnon.location || "").includes("/login"), "anonymous redirect goes to /login", lbAnon.location);

  // ---- brand on every page ----------------------------------------------
  for (const p of ["/", "/train", "/duel", `/duel/${duelId}`, "/leaderboard"]) {
    const r = await page(ca, p);
    ok(r.html.includes('aria-label="ST0NE QUIZ — pagina principală"'), `logo present on ${p}`, r.status);
  }
  const loginPage = await page(null, "/login");
  ok(loginPage.html.includes('aria-label="ST0NE QUIZ — pagina principală"'), "logo present on /login", loginPage.status);
} catch (e) {
  fail++;
  console.log("FAIL threw:", e.message);
} finally {
  await prisma.question.deleteMany({ where: { prompt: { startsWith: "lobby-e2e:" } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } }).catch(() => {});
  await prisma.$disconnect();
}

console.log(fail === 0 ? "\nall checks passed" : `\n${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
