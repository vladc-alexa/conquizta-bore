// Chat @-mention E2E: the feed annotates every message with the players it pings
// (id + canonical name), tolerates case, respects word boundaries (e-mails and
// ASCII-art "@" stay plain), and handles multi-word names.
// Usage: BASE=http://127.0.0.1:3210 node scripts/chat-mentions-e2e.mjs
import { PrismaClient } from "@prisma/client";


const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3210";
const PW = "mention-e2e-pass";
const A = { email: "mention-a@example.test", name: "mention-alice" };
const B = { email: "mention-b@example.test", name: "mention-bob" };
const C = { email: "mention-c@example.test", name: "Ion Popescu" };

let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) fail++;
};

// sign up through the real endpoint (per-email fake IP so the 5/hour throttle
// doesn't bite when the suite runs repeatedly)
let ipSeq = 1;
async function signup(u) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.9.${ipSeq++}` },
    body: JSON.stringify({ displayName: u.name, email: u.email, password: PW }),
  });
  if (r.status !== 201) throw new Error(`signup ${u.name} -> ${r.status} ${await r.text()}`);
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
const say = (cookie, text) => api(cookie, "/api/chat", { method: "POST", body: JSON.stringify({ text }) });

// newest message carrying this exact text, with its mention annotation
async function posted(text, cookie) {
  const feed = await api(cookie, "/api/chat");
  const msgs = (feed.body?.messages ?? []).filter((m) => m.text === text);
  return msgs[msgs.length - 1];
}

try {
  await prisma.chatMessage.deleteMany({ where: { authorName: { in: [A.name, B.name, C.name] } } });
  await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email, C.email] } } });
  const ca = await signup(A);
  const cb = await signup(B);
  const cc = await signup(C);
  const b = await prisma.user.findUnique({ where: { email: B.email } });
  const c = await prisma.user.findUnique({ where: { email: C.email } });

  // ---- basic ping --------------------------------------------------------
  const t1 = `@${B.name} salut, ești la masă?`;
  ok((await say(ca, t1)).status === 200, "post a message that @-mentions another player");
  const m1 = await posted(t1, ca);
  ok(m1?.mentions?.length === 1, `one mention annotated (got ${m1?.mentions?.length})`);
  ok(m1?.mentions?.[0]?.id === b.id, "mention carries the mentioned player's id");
  ok(m1?.mentions?.[0]?.name === B.name, "mention carries the canonical display name");

  // the mentioned player sees the same annotation on his own feed
  const m1b = await posted(t1, cb);
  ok(m1b?.mentions?.[0]?.id === b.id, "the pinged player's feed shows the mention too");

  // ---- case + boundaries -------------------------------------------------
  const t2 = `@${B.name.toUpperCase()} te-am strigat cu majuscule`;
  await say(ca, t2);
  const m2 = await posted(t2, ca);
  ok(m2?.mentions?.[0]?.id === b.id, "matching is case-insensitive");

  const t3 = `scrie-mi la x@${B.name}.ro`;
  await say(ca, t3);
  const m3 = await posted(t3, ca);
  ok((m3?.mentions ?? []).length === 0, "an e-mail address is not a mention");

  const t4 = `@${B.name}b nu e același om`;
  await say(ca, t4);
  const m4 = await posted(t4, ca);
  ok((m4?.mentions ?? []).length === 0, "a longer word after the name is not a mention");

  const t5 = "art  /\\  @  @@  (fără nume)";
  await say(ca, t5);
  const m5 = await posted(t5, ca);
  ok((m5?.mentions ?? []).length === 0, "a bare @ in art/text is not a mention");

  // ---- multi-word name + several pings in one line -----------------------
  const t6 = `@${C.name} și @${B.name}, veniți amândoi`;
  await say(ca, t6);
  const m6 = await posted(t6, ca);
  const ids6 = (m6?.mentions ?? []).map((m) => m.id).sort();
  ok(ids6.length === 2 && ids6.join() === [b.id, c.id].sort().join(), "two mentions in one message resolve to both players");
  ok((m6?.mentions ?? []).some((m) => m.name === C.name), "multi-word display name matched whole");

  // ---- ping at the very end, no trailing space ---------------------------
  const t7 = `gata, ${C.name}?`.replace(C.name, `@${C.name}`);
  await say(ca, t7);
  const m7 = await posted(t7, ca);
  ok(m7?.mentions?.[0]?.id === c.id, "a mention followed by punctuation still counts");

  // ---- a rename stops matching the old name ------------------------------
  const renamed = await api(cc, "/api/auth/name", { method: "POST", body: JSON.stringify({ name: "Ion Renumit" }) });
  ok(renamed.status === 200, "player renames himself");
  // the rename route drops the mention roster cache, so no wait is needed
  const t8 = `@${C.name} mai ești?`;
  await say(ca, t8);
  const m8 = await posted(t8, ca);
  ok((m8?.mentions ?? []).length === 0, "old name no longer pings after a rename");
  const t9 = "@Ion Renumit da";
  await say(ca, t9);
  const m9 = await posted(t9, ca);
  ok(m9?.mentions?.[0]?.id === c.id, "the new name pings instead");

  // ---- non-mentions leave the annotation empty (no crash on plain text) ---
  const t10 = "mesaj simplu fără ping";
  await say(ca, t10);
  const m10 = await posted(t10, ca);
  ok(Array.isArray(m10?.mentions) && m10.mentions.length === 0, "plain messages carry an empty mentions array");
} catch (e) {
  console.error("E2E ERROR:", e.message);
  fail++;
} finally {
  try {
    await prisma.chatMessage.deleteMany({ where: { authorName: { in: [A.name, B.name, "Ion Renumit"] } } });
    await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email, C.email] } } });
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
