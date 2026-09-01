import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DEFAULT_CHAT_COLOR } from "@/lib/chatColors";

export async function GET() {
  const messages = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 250,
    select: {
      id: true,
      authorName: true,
      text: true,
      createdAt: true,
      userId: true,
      user: { select: { nameColor: true, isMuted: true } },
    },
  });
  return NextResponse.json({
    messages: messages
      .reverse()
      .map((m) => ({
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
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Mesajul nu poate fi gol." }, { status: 400 });
  }
  const msg = await prisma.chatMessage.create({
    data: { userId: session.sub, authorName: user.displayName, text: text.slice(0, 500) },
    select: { id: true, authorName: true, text: true, createdAt: true },
  });
  return NextResponse.json({ message: msg });
}
