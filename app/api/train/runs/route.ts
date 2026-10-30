import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { startOfLocalDay, trainStandings } from "@/lib/trainStats";

export const dynamic = "force-dynamic";

// POST /api/train/runs { correct, total } -> saves one finished 2-minute blitz
// and answers with today's standing, so the results screen can say
// "locul 3 azi" without a second round trip.
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const correct = Number(body?.correct);
  const total = Number(body?.total);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || correct < 0 || total < 0) {
    return NextResponse.json({ error: "correct and total required" }, { status: 400 });
  }

  await prisma.trainRun.create({
    data: { userId: session.sub, correct: Math.floor(correct), total: Math.floor(total) },
  });

  const { mine, rows } = await trainStandings(prisma, {
    since: startOfLocalDay(),
    limit: 10,
    userId: session.sub,
  });

  return NextResponse.json({ ok: true, today: { mine, rows } }, { status: 201 });
}
