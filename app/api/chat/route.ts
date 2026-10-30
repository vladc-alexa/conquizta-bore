import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_CHAT_COLOR } from "@/lib/chatColors";
import { normalizeMessage } from "@/lib/messageText";
import { findMentionedNames } from "@/lib/mentions";
import { chatNames } from "@/lib/chatNames";

// The dashboard shows the last 100 messages — enough to follow the room
// without scrollback nobody reads.
const CHAT_PAGE = 100;

export async function GET(req: Request) {
  // ?since=<ISO> returns only messages newer than the cursor (ascending) — used by
  // the dashboard's 5s poll so an idle client transfers ~0 bytes instead of re-reading
  // the last 100 messages every time.
  const sinceParam = new URL(req.url).searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const delta = !!sinceDate && !Number.isNaN(sinceDate.getTime());

  const select = {
    id: true,
    authorName: true,
    text: true,
    createdAt: true,
    editedAt: true,
    userId: true,
    user: { select: { nameColor: true, isMuted: true } },
    replyTo: { select: { id: true, authorName: true, text: true } },
  } as const;

  const raw = await prisma.chatMessage.findMany({
    where: delta ? { createdAt: { gte: sinceDate! } } : {},
    orderBy: { createdAt: delta ? "asc" : "desc" },
    take: CHAT_PAGE,
    select,
  });
  // full reads come newest-first; reverse to chronological. Deltas are already ascending.
  const messages = delta ? raw : raw.reverse();

  // Annotate every message with who it @-mentions, so the client can highlight
  // the name and tell the mentioned player they were pinged without re-parsing
  // (and without a second round-trip for the roster).
  const people = await chatNames();
  const names = people.map((u) => u.name);
  const byName = new Map(people.map((u) => [u.name.toLowerCase(), u]));

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      authorId: m.userId,
      text: m.text,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      replyTo: m.replyTo,
      authorColor: m.user?.nameColor ?? DEFAULT_CHAT_COLOR,
      muted: m.user?.isMuted ?? false,
      mentions: findMentionedNames(m.text, names).map((n) => {
        const u = byName.get(n.toLowerCase());
        return { id: u?.id ?? null, name: n };
      }),
    })),
  });
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { displayName: true, isMuted: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.isMuted) {
    return NextResponse.json({ error: "Ești mutat. Nu poți trimite mesaje." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  // normalize (not .trim()): .trim() would shift the first row of pasted ASCII art
  const text = typeof body?.text === "string" ? normalizeMessage(body.text) : "";
  if (!text) {
    return NextResponse.json({ error: "Mesajul nu poate fi gol." }, { status: 400 });
  }
  // WhatsApp-style reply: only accept a parent that still exists (a reply can
  // outlive nothing — the FK would 500 otherwise).
  const replyToId = typeof body?.replyToId === "string" && body.replyToId ? body.replyToId : null;
  if (replyToId) {
    const parent = await prisma.chatMessage.findUnique({ where: { id: replyToId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "Mesajul la care răspunzi nu mai există." }, { status: 400 });
  }
  const msg = await prisma.chatMessage.create({
    data: {
      userId: session.sub,
      authorName: user.displayName,
      text: text.slice(0, 2000),
      replyToId,
    },
    select: { id: true, authorName: true, text: true, createdAt: true },
  });
  return NextResponse.json({ message: msg });
}
