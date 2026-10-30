import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { normalizeMessage } from "@/lib/messageText";

// PATCH /api/chat/[id] — edit a chat message.
// The author may edit their own message; an admin may edit any message.
// Mentions are re-derived on read, so editing "@ion" out of a message also
// removes the ping on the next poll.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? normalizeMessage(body.text) : "";
  if (!text) return NextResponse.json({ error: "Mesajul nu poate fi gol." }, { status: 400 });

  const msg = await prisma.chatMessage.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { isAdmin: true, isMuted: true },
  });
  const mine = msg.userId === session.sub;
  if (!mine && !me?.isAdmin) {
    return NextResponse.json({ error: "Nu poți edita mesajul altcuiva." }, { status: 403 });
  }
  if (mine && me?.isMuted) {
    return NextResponse.json({ error: "Ești mutat. Nu poți edita mesaje." }, { status: 403 });
  }

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { text: text.slice(0, 2000), editedAt: new Date() },
    select: { id: true, text: true, editedAt: true },
  });
  return NextResponse.json({ message: updated });
}
