import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { startOfLocalDay, trainStandings } from "@/lib/trainStats";

export const dynamic = "force-dynamic";

// GET /api/train/leaderboard           -> today's best runs (Romanian day)
// GET /api/train/leaderboard?period=all -> all-time best runs
export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const period = new URL(req.url).searchParams.get("period") === "all" ? "all" : "day";
  const since = period === "day" ? startOfLocalDay() : null;
  const { rows, mine } = await trainStandings(prisma, { since, limit: 20, userId: session.sub });

  return NextResponse.json({ period, dayStart: since?.toISOString() ?? null, rows, mine });
}
