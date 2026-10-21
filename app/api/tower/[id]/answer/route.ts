import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { gradeAnswer } from "@/lib/duel";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { resolveTower, rungsFor, towerScore, TOWER_ROUND_GRACE_MS, TOWER_ROUND_MS, type TowerEntry } from "@/lib/tower";

// POST /api/tower/[id]/answer { selectedOptionId }  (grilă)
// POST /api/tower/[id]/answer { answer }            (rapidă — typed guess)
// Graded server-side; elapsed time is measured from the server round start.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.towerGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.status !== "IN_PROGRESS") return NextResponse.json({ error: "turnul nu e în desfășurare" }, { status: 409 });

  const me = game.players.find((p) => p.userId === session.sub);
  if (!me) return NextResponse.json({ error: "nu ești în turn" }, { status: 403 });
  if (me.eliminated) return NextResponse.json({ error: "ai căzut de pe scară" }, { status: 409 });

  const plan = game.plan as TowerEntry[];
  const round = game.currentRound;
  const entry = plan[round];
  if (!entry) return NextResponse.json({ error: "runda inexistentă" }, { status: 400 });

  const started = game.roundStartedAt?.getTime() ?? Date.now();
  const elapsedRaw = Date.now() - started;
  if (elapsedRaw > TOWER_ROUND_MS + TOWER_ROUND_GRACE_MS) {
    return NextResponse.json({ error: "timpul a expirat" }, { status: 409 });
  }
  const elapsed = Math.max(0, Math.min(elapsedRaw, TOWER_ROUND_MS));

  const body = await req.json().catch(() => null);
  const selectedOptionId = typeof body?.selectedOptionId === "string" ? body.selectedOptionId : null;
  const typed = typeof body?.answer === "string" || typeof body?.answer === "number" ? String(body.answer) : null;

  let selected: string | null = null;
  let isCorrect: boolean;
  if (entry.mode === "grila") {
    if (!selectedOptionId || !entry.options.some((o) => o.id === selectedOptionId)) {
      return NextResponse.json({ error: "răspuns lipsă" }, { status: 400 });
    }
    selected = selectedOptionId;
    isCorrect = selectedOptionId === entry.correctOptionId;
  } else {
    if (!typed || !typed.trim()) return NextResponse.json({ error: "răspuns lipsă" }, { status: 400 });
    // same grader as the 1v1 rapidă rounds (closeness tolerance on numeric answers)
    isCorrect = gradeAnswer(entry, { answer: typed }, elapsed).isCorrect;
  }

  const score = towerScore(isCorrect, elapsed);
  try {
    await prisma.towerAnswer.create({
      data: {
        gameId: id,
        playerId: me.id,
        round,
        questionId: entry.questionId,
        selectedOptionId: selected,
        isCorrect,
        score,
        rungs: rungsFor(score),
        elapsedMilliseconds: Math.round(elapsed),
      },
    });
  } catch {
    return NextResponse.json({ error: "ai răspuns deja" }, { status: 409 });
  }

  await resolveTower(id); // last player in -> the round settles immediately
  return NextResponse.json({ ok: true, isCorrect, score, rungs: rungsFor(score) });
}
