// Chat E2E: the dashboard reads the last 100 messages, and pasted ASCII art
// keeps the indentation of its FIRST row (plain .trim() used to shear it off).
// Usage: BASE=http://127.0.0.1:3214 node scripts/chat-e2e.mjs
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3210";
const PW = "chat-e2e-pass";
const NAME = "chat-e2e-user@example.test";

const hash = (pw) => {
  const s = randomBytes(16).toString("hex");
  return `scrypt$${s}$${scryptSync(pw, s, 64).toString("hex")}`;
};

let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
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
  return { status: r.status, body };
}
const say = (cookie, text) =>
  api(cookie, "/api/chat", { method: "POST", body: JSON.stringify({ text }) });

// an art block whose first line is indented — exactly what used to break
const ART = "     .-\"\"\"-.\n    /  o o  \\\n   |    ^    |\n    \\  '-'  /\n     '-...-'";

try {
  await prisma.user.deleteMany({ where: { email: NAME } });
  const u = await prisma.user.create({
    data: { email: NAME, displayName: "chat-e2e-user", passwordHash: hash(PW) },
  });
  const c = await login(NAME);

  // ---- ASCII art keeps its first-row indent ------------------------------
  const posted = await say(c, ART);
  ok(posted.status === 200, "post an ASCII-art message (200)");
  ok(posted.body?.message?.text === ART, "stored text is byte-identical to the paste");

  const back = await api(c, "/api/chat");
  const mine = (back.body?.messages ?? []).find((m) => m.text.includes(".-\"\"\"-."));
  ok(!!mine, "art comes back from the chat feed");
  ok(mine?.text === ART, "feed returns the art with row 1 aligned (identical text)");
  ok(mine?.text?.split("\n")[0].startsWith("     .-"), "first row keeps its 5 leading spaces");

  // trailing blank lines / spaces are still cleaned up
  const padded = await say(c, "   hello world   \n\n");
  ok(padded.body?.message?.text === "   hello world", "outer blank lines + trailing spaces trimmed");

  // ---- only the last 100 messages ---------------------------------------
  await prisma.chatMessage.deleteMany({ where: { userId: u.id } });
  for (let i = 0; i < 105; i++) await say(c, `bulk ${i}`);
  const full = await api(c, "/api/chat");
  const msgs = full.body?.messages ?? [];
  ok(msgs.length === 100, `full read is capped at 100 (got ${msgs.length})`);
  ok(msgs[msgs.length - 1]?.text === "bulk 104", "newest message is last");
  ok(msgs[0]?.text === "bulk 5", "oldest kept message is #5");

  // delta polling asks for >= the cursor (the boundary message repeats) and the
  // dashboard dedupes by id, so the new message must be present and nothing older may sneak in
  const since = msgs[msgs.length - 1].createdAt;
  await say(c, "bulk 105");
  const delta = await api(c, `/api/chat?since=${encodeURIComponent(since)}`);
  const fresh = (delta.body?.messages ?? []).map((m) => m.text).filter((t) => !msgs.some((m) => m.text === t));
  ok(fresh.length === 1 && fresh[0] === "bulk 105", `delta poll surfaces just the new message (got ${JSON.stringify(fresh)})`);
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  try {
    await prisma.chatMessage.deleteMany({ where: { authorName: "chat-e2e-user" } });
    await prisma.user.deleteMany({ where: { email: NAME } });
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
