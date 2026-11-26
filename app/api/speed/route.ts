import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/speed -> all-time speed board ("Măsoară viteza" / PRC sprint).
// Ranks each player by their BEST run, not by their latest: one run per player.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  const runs = await prisma.speedRun.findMany({
    orderBy: [{ correct: "desc" }, { createdAt: "asc" }],
    take: 500,
    select: {
      userId: true,
      correct: true,
      wrong: true,
      seconds: true,
      createdAt: true,
      user: { select: { displayName: true, hideScore: true } },
    },
  });

  const best = new Map<string, { id: string; name: string; correct: number; wrong: number; seconds: number }>();
  for (const run of runs) {
    if (best.has(run.userId)) continue; // first hit per player = their best
    if (run.user?.hideScore) continue;
    best.set(run.userId, {
      id: run.userId,
      name: run.user?.displayName ?? "?",
      correct: run.correct,
      wrong: run.wrong,
      seconds: run.seconds,
    });
  }

  const rows = [...best.values()].slice(0, 15);
  const myPos = session ? rows.findIndex((r) => r.id === session.sub) : -1;

  return NextResponse.json({ rows, myPos, me: session?.sub ?? null });
}

// POST /api/speed { correct, wrong, seconds } -> saves one finished sprint and
// answers with the new standings so the result screen can show the player's place.
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const correct = Number(body?.correct);
  const wrong = Number(body?.wrong ?? 0);
  const seconds = Number(body?.seconds ?? 30);
  if (!Number.isFinite(correct) || !Number.isFinite(wrong) || correct < 0 || wrong < 0) {
    return NextResponse.json({ error: "correct required" }, { status: 400 });
  }

  await prisma.speedRun.create({
    data: {
      userId: session.sub,
      correct: Math.floor(correct),
      wrong: Math.floor(wrong),
      seconds: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 30,
    },
  });

  const mine = await prisma.speedRun.findFirst({
    where: { userId: session.sub },
    orderBy: [{ correct: "desc" }, { createdAt: "asc" }],
    select: { correct: true },
  });
  const better = await prisma.speedRun.findMany({
    where: { correct: { gt: mine?.correct ?? 0 } },
    distinct: ["userId"],
    select: { userId: true },
  });

  return NextResponse.json({ ok: true, best: mine?.correct ?? 0, place: better.length + 1 });
}
