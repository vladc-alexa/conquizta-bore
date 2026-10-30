import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { startOfLocalDay, trainStandings } from "@/lib/trainStats";

export const dynamic = "force-dynamic";

// POST /api/train/runs { score, correct, total } -> saves one finished 90-second
// blitz and answers with today's standing, so the results screen can say
// "locul 3 azi" without a second round trip.
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const correct = Number(body?.correct);
  const total = Number(body?.total);
  const score = Number(body?.score);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || !Number.isFinite(score) || correct < 0 || total < 0 || score < 0) {
    return NextResponse.json({ error: "score, correct and total required" }, { status: 400 });
  }

  await prisma.trainRun.create({
    data: {
      userId: session.sub,
      score: Math.floor(score),
      correct: Math.floor(correct),
      total: Math.floor(total),
    },
  });

  const { mine, rows } = await trainStandings(prisma, {
    since: startOfLocalDay(),
    limit: 10,
    userId: session.sub,
  });

  return NextResponse.json({ ok: true, today: { mine, rows } }, { status: 201 });
}
