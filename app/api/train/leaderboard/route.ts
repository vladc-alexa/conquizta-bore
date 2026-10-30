import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { combinedStandings, startOfLocalDay } from "@/lib/trainStats";
import { getLeaderboardSnapshot } from "@/lib/leaderboardCache";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  points: number;
  correct: number;
  total: number;
  at: string | null;
  /** the old PRC rating, shown in brackets — null while a player has none */
  prc: number | null;
  /** what put the row where it is: a 90s run, or (all-time only) an old rating */
  basis: "run" | "rating";
};

// GET /api/train/leaderboard                -> today's board (Romanian day)
// GET /api/train/leaderboard?period=all     -> all-time board, old ratings included
//
// All-time is a union: players who ran the 90s blitz are ranked by their best
// run's points, and players who never ran it keep their place through the old
// PRC rating (which is what the site ranked on before the blitz existed). That
// way nobody vanishes from the board the day the new game shipped.
export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const period = new URL(req.url).searchParams.get("period") === "all" ? "all" : "day";
  const since = period === "day" ? startOfLocalDay() : null;
  const { rows: trainRows, mine: trainMine } = await combinedStandings(prisma, {
    since,
    limit: 200,
    userId: session.sub,
  });

  const snap = await getLeaderboardSnapshot(prisma);
  const prcOf = (id: string) => snap.prcByUser.get(id)?.total ?? null;

  let rows: Row[] = trainRows.map((r) => ({
    id: r.id,
    name: r.name,
    points: r.score,
    correct: r.correct,
    total: r.total,
    at: r.at,
    prc: prcOf(r.id),
    basis: "run" as const,
  }));

  if (period === "all") {
    // only accounts that still exist and don't hide their score
    const users = await prisma.user.findMany({ select: { id: true, displayName: true, hideScore: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    rows = rows.filter((r) => byId.has(r.id) && !byId.get(r.id)!.hideScore);

    const seen = new Set(rows.map((r) => r.id));
    const legacy: Row[] = [];
    for (const [id, p] of snap.prcByUser) {
      if (seen.has(id) || p.total == null) continue;
      const u = byId.get(id);
      if (!u || u.hideScore) continue;
      legacy.push({
        id,
        name: u.displayName,
        points: 0,
        correct: 0,
        total: 0,
        at: null,
        prc: p.total,
        basis: "rating",
      });
    }

    // A run outranks a legacy rating only when it exists; otherwise the old
    // rating is the value that decides the place.
    const key = (r: Row) => (r.points > 0 ? r.points : (r.prc ?? 0));
    rows = [...rows, ...legacy].sort(
      (a, b) => key(b) - key(a) || b.correct - a.correct || a.name.localeCompare(b.name),
    );
  }

  rows = rows.slice(0, 50);

  const myIdx = rows.findIndex((r) => r.id === session.sub);
  const mine =
    myIdx >= 0
      ? { ...rows[myIdx], rank: myIdx + 1 }
      : trainMine
        ? { ...trainMine, prc: prcOf(session.sub), basis: "run" as const, rank: null }
        : null;

  return NextResponse.json({ period, dayStart: since?.toISOString() ?? null, rows, mine });
}
