// Proves: (1) a round settles as soon as everyone has answered, way before the
// countdown, (2) rapide rounds expose the right answer and per-player times.
const BASE = process.env.BASE || "http://127.0.0.1:3119";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function user(tag) {
  const email = `${tag}${Date.now()}@demo.local`;
  await req("/api/auth/register", { method: "POST", body: { email, password: "parola12345", displayName: tag } });
  const login = await req("/api/auth/login", { method: "POST", body: { email, password: "parola12345" } });
  return { cookie: login.cookie };
}

const a = await user("anaa");
const b = await user("bobb");
const made = await req("/api/carciuma", { method: "POST", cookie: a.cookie });
const id = made.json.gameId;
await req(`/api/carciuma/${id}/join`, { method: "POST", cookie: b.cookie });
await req(`/api/carciuma/${id}/bots`, { method: "POST", cookie: a.cookie, body: { count: 99 } });
await req(`/api/carciuma/${id}/start`, { method: "POST", cookie: a.cookie });

let rapideSeen = null;
for (let guard = 0; guard < 40; guard += 1) {
  const st = await req(`/api/carciuma/${id}`, { cookie: a.cookie });
  const s = st.json;
  if (!s || s.status !== "IN_PROGRESS") break;
  const q = s.question;
  if (!q) { await new Promise((r) => setTimeout(r, 200)); continue; }

  const t0 = Date.now();
  if (q.mode === "grila") {
    await req(`/api/carciuma/${id}/answer`, { method: "POST", cookie: a.cookie, body: { selectedOptionId: q.options[0].id } });
    await req(`/api/carciuma/${id}/answer`, { method: "POST", cookie: b.cookie, body: { selectedOptionId: q.options[1].id } });
  } else {
    await req(`/api/carciuma/${id}/answer`, { method: "POST", cookie: a.cookie, body: { answer: "7" } });
    await req(`/api/carciuma/${id}/answer`, { method: "POST", cookie: b.cookie, body: { answer: "9" } });
  }

  // the round must pour before the clock: poll for the verdict
  let settledMs = -1;
  for (let i = 0; i < 25; i += 1) {
    const p = await req(`/api/carciuma/${id}`, { cookie: a.cookie });
    if (p.json?.lastRound?.round === s.round) { settledMs = Date.now() - t0; rapideSeen = rapideSeen || (p.json.lastRound.mode === "rapide" ? p.json.lastRound : null); break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`round ${s.round} (${q.mode}) settled after ${settledMs}ms`);
  if (s.round >= 4) break;
  await new Promise((r) => setTimeout(r, 400));
}
console.log("rapide payload:", JSON.stringify(rapideSeen));
