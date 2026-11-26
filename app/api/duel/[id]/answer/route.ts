import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { DUEL_ROUND_GRACE_MS, gradeAnswer, resolveDuel, roundWindowMs, type PlanEntry } from "@/lib/duel";

// POST /api/duel/[id]/answer { round, selectedOptionId?, answer? }
// Graded server-side; the elapsed time is measured from the round start on the
// server (tamper-proof, identical for both players), not taken from the client.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const duel = await prisma.duel.findUnique({ where: { id } });
  if (!duel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (duel.hostId !== session.sub && duel.guestId !== session.sub) {
    return NextResponse.json({ error: "not a participant" }, { status: 403 });
  }
  if (duel.status !== "IN_PROGRESS") return NextResponse.json({ error: "meciul nu e în desfășurare" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const round = Number(body?.round);
  if (!Number.isInteger(round) || round !== duel.currentRound) {
    return NextResponse.json({ error: "runda s-a încheiat" }, { status: 409 });
  }
  const plan = duel.plan as PlanEntry[];
  const entry = plan[round];
  if (!entry) return NextResponse.json({ error: "runda inexistentă" }, { status: 400 });

  const started = duel.roundStartedAt?.getTime() ?? Date.now();
  const elapsedRaw = Date.now() - started;
  if (elapsedRaw > roundWindowMs(entry.mode) + DUEL_ROUND_GRACE_MS) {
    return NextResponse.json({ error: "timpul a expirat" }, { status: 409 });
  }
  const elapsed = Math.max(0, Math.min(elapsedRaw, roundWindowMs(entry.mode)));

  const selectedOptionId = typeof body?.selectedOptionId === "string" ? body.selectedOptionId : null;
  const submittedAnswer = typeof body?.answer === "string" ? body.answer.slice(0, 50) : null;
  if (entry.mode === "grila" && !selectedOptionId) return NextResponse.json({ error: "răspuns lipsă" }, { status: 400 });
  if (entry.mode === "rapide" && !submittedAnswer) return NextResponse.json({ error: "răspuns lipsă" }, { status: 400 });

  const graded = gradeAnswer(entry, { selectedOptionId, answer: submittedAnswer }, elapsed);
  try {
    await prisma.duelAnswer.create({
      data: {
        duelId: id,
        userId: session.sub,
        round,
        questionId: entry.questionId,
        selectedOptionId: entry.mode === "grila" ? selectedOptionId : null,
        submittedAnswer,
        isCorrect: graded.isCorrect,
        score: graded.score,
        elapsedMilliseconds: Math.round(elapsed),
      },
    });
  } catch {
    return NextResponse.json({ error: "ai răspuns deja" }, { status: 409 });
  }

  await resolveDuel(id); // both answers in -> the round can settle right away
  // Rapide never tells you "wrong" — only grilă gives immediate feedback.
  return NextResponse.json({ ok: true, mode: entry.mode, isCorrect: entry.mode === "grila" ? graded.isCorrect : null });
}
