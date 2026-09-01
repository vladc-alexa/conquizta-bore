import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export async function GET() {
  const messages = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, authorName: true, text: true, createdAt: true },
  });
  return NextResponse.json({ messages: messages.reverse() });
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Mesajul nu poate fi gol." }, { status: 400 });
  }
  const msg = await prisma.chatMessage.create({
    data: { userId: session.sub, authorName: session.name, text: text.slice(0, 500) },
    select: { id: true, authorName: true, text: true, createdAt: true },
  });
  return NextResponse.json({ message: msg });
}
