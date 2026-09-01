import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/sessions/[id]/abandon — player left mid-game (doesn't count toward PRC).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const quiz = await prisma.quizSession.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!quiz || quiz.userId !== session.sub || quiz.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }
  await prisma.quizSession.update({ where: { id }, data: { status: "ABANDONED", completedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
