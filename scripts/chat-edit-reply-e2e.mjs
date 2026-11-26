// Chat edit + WhatsApp-style reply E2E.
// Proves PATCH /api/chat/[id] (author-only, admin override, muted blocked,
// empty/nonexistent rejected, editedAt stamped) and POST /api/chat replyToId
// (quote survives on read, dangling parent rejected, parent delete nulls the
// quote instead of cascading the reply away).
// Usage: BASE=http://127.0.0.1:3214 node scripts/chat-edit-reply-e2e.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = process.env.BASE || "http://127.0.0.1:3214";
const PW = "chat-edit-e2e-pass";
const TAG = Date.now() % 100000;
const A = { email: `edit-a-${TAG}@example.test`, name: `edit-alice-${TAG}` };
const B = { email: `edit-b-${TAG}@example.test`, name: `edit-bob-${TAG}` };

let fail = 0;
const ok = (c, m) => {
  console.log(`${c ? "✓" : "✗"} ${m}`);
  if (!c) fail++;
};

let ipSeq = 1;
async function signup(u) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.8.8.${ipSeq++}` },
    body: JSON.stringify({ displayName: u.name, email: u.email, password: PW }),
  });
  if (r.status !== 201) throw new Error(`signup ${u.name} -> ${r.status} ${await r.text()}`);
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function api(cookie, path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* no json */
  }
  return { status: r.status, body };
}
const post = (cookie, text, replyToId) =>
  api(cookie, "/api/chat", { method: "POST", body: JSON.stringify({ text, replyToId }) });
const edit = (cookie, id, text) =>
  api(cookie, `/api/chat/${id}`, { method: "PATCH", body: JSON.stringify({ text }) });
const feed = async (cookie) => (await api(cookie, "/api/chat")).body?.messages ?? [];
const find = async (cookie, id) => (await feed(cookie)).find((m) => m.id === id);

try {
  await prisma.chatMessage.deleteMany({ where: { authorName: { in: [A.name, B.name] } } });
  await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
  const ca = await signup(A);
  const cb = await signup(B);

  // ---- post + edit -------------------------------------------------------
  const p = await post(ca, "primul meu mesaj");
  ok(p.status === 200, "post a message");
  const id = p.body?.message?.id;
  const before = await find(ca, id);
  ok(!!id && before, "message shows up in the feed");
  ok(before?.editedAt == null, "fresh message has no editedAt");
  const edited = await edit(ca, id, "primul meu mesaj (corectat)");
  ok(edited.status === 200, `author can edit own message (got ${edited.status})`);
  const after = await find(ca, id);
  ok(after?.text === "primul meu mesaj (corectat)", "edited text is what the feed serves");
  ok(!!after?.editedAt, "editedAt is stamped after an edit");

  // ---- guards ------------------------------------------------------------
  ok((await edit(cb, id, "altcuiva")).status === 403, "another player cannot edit it (403)");
  ok((await edit(ca, id, "   ")).status === 400, "empty text is rejected (400)");
  ok((await edit(ca, "00000000-0000-4000-8000-000000000000", "x")).status === 404, "unknown id -> 404");
  ok((await edit(null, id, "fara sesiune")).status === 401, "no session -> 401");

  // muted author is blocked
  await prisma.user.update({ where: { email: A.email }, data: { isMuted: true } });
  ok((await edit(ca, id, "sunt mut")).status === 403, "muted author cannot edit (403)");
  await prisma.user.update({ where: { email: A.email }, data: { isMuted: false } });

  // admin may edit someone else's message
  await prisma.user.update({ where: { email: B.email }, data: { isAdmin: true } });
  ok((await edit(cb, id, "editat de admin")).status === 200, "admin can edit any message (200)");
  await prisma.user.update({ where: { email: B.email }, data: { isAdmin: false } });
  await edit(ca, id, "primul meu mesaj (corectat)");

  // ---- reply -------------------------------------------------------------
  const r = await post(cb, "raspund la primul", id);
  ok(r.status === 200, "reply accepted with replyToId");
  const rid = r.body?.message?.id;
  const rm = await find(cb, rid);
  ok(rm?.replyTo?.id === id, "reply carries the parent id");
  ok(rm?.replyTo?.authorName === A.name, "reply carries the parent author name");
  ok(rm?.replyTo?.text === "primul meu mesaj (corectat)", "reply carries the parent text snapshot");

  // the quote is joined live, so an edited parent shows its edited text
  await edit(ca, id, "parinte rescris");
  const rm2 = await find(cb, rid);
  ok(rm2?.replyTo?.text === "parinte rescris", "quote follows the parent's edits");

  ok(
    (await post(cb, "raspuns orfan", "11111111-1111-4111-8111-111111111111")).status === 400,
    "reply to a missing parent -> 400",
  );
  ok((await post(cb, "raspuns simplu", null)).status === 200, "replyToId null still posts a plain message");

  // deleting the parent keeps the reply, only drops the quote
  await prisma.chatMessage.delete({ where: { id } });
  const orphan = await find(cb, rid);
  ok(!!orphan, "deleting the parent does NOT delete the reply");
  ok(orphan?.replyTo == null, "orphan reply degrades to a plain message");
} catch (e) {
  console.log(`✗ harness crashed: ${e.message}`);
  fail++;
} finally {
  await prisma.user.deleteMany({ where: { email: { in: [A.email, B.email] } } });
  await prisma.chatMessage.deleteMany({ where: { authorName: { in: [A.name, B.name] } } });
  await prisma.$disconnect();
  console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
  process.exit(fail ? 1 : 0);
}
