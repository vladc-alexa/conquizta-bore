import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_CHAT_COLOR } from "@/lib/chatColors";
import { normalizeMessage } from "@/lib/messageText";

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
    userId: true,
    user: { select: { nameColor: true, isMuted: true } },
  } as const;

  const raw = await prisma.chatMessage.findMany({
    where: delta ? { createdAt: { gte: sinceDate! } } : {},
    orderBy: { createdAt: delta ? "asc" : "desc" },
    take: CHAT_PAGE,
    select,
  });
  // full reads come newest-first; reverse to chronological. Deltas are already ascending.
  const messages = delta ? raw : raw.reverse();

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      text: m.text,
      createdAt: m.createdAt,
      authorColor: m.user?.nameColor ?? DEFAULT_CHAT_COLOR,
      muted: m.user?.isMuted ?? false,
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
  const msg = await prisma.chatMessage.create({
    data: { userId: session.sub, authorName: user.displayName, text: text.slice(0, 2000) },
    select: { id: true, authorName: true, text: true, createdAt: true },
  });
  return NextResponse.json({ message: msg });
}
