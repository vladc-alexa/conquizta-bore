import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/sessions/[id]/complete { correctCount }
// Marks the session COMPLETED (counts toward PRC).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const quiz = await prisma.quizSession.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!quiz || quiz.userId !== session.sub || quiz.status !== "IN_PROGRESS") {
    return NextResponse.json({ error: "invalid session" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const correctCount = Math.max(0, Math.min(Number(body?.correctCount) || 0, 1000));

  await prisma.quizSession.update({
    where: { id },
    data: { status: "COMPLETED", correctCount, completedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
