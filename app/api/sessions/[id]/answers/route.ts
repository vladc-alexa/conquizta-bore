import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/sessions/[id]/answers { questionId, isCorrect, answer?, selectedOptionId?, elapsedMs }
// Records one answer. grila -> selectedOptionId; rapide -> answer (numeric string).
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
  const questionId = typeof body?.questionId === "string" ? body.questionId : "";
  const isCorrect = !!body?.isCorrect;
  const elapsedMs = Math.max(0, Math.min(Number(body?.elapsedMs) || 0, 60000));
  const selectedOptionId = typeof body?.selectedOptionId === "string" ? body.selectedOptionId : null;
  const submittedAnswer = typeof body?.answer === "string" ? body.answer.slice(0, 50) : null;

  if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });

  await prisma.sessionAnswer.create({
    data: {
      quizSessionId: id,
      questionId,
      selectedOptionId,
      submittedAnswer,
      isCorrect,
      elapsedMilliseconds: Math.round(elapsedMs),
      answeredAt: new Date(),
    },
  });
  await prisma.quizSession.update({ where: { id }, data: { questionCount: { increment: 1 } } });
  return NextResponse.json({ ok: true });
}
