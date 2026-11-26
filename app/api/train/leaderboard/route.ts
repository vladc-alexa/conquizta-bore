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

type Sort = "points" | "rating";

// GET /api/train/leaderboard                     -> today's board, by points
// GET /api/train/leaderboard?period=all          -> all-time board, by points
// GET /api/train/leaderboard?period=all&sort=rating -> all-time board, by PRC rating
//
// Points aggregate every game (90s blitz runs, cârciumă answers, tower answers —
// see lib/trainStats.ts), so the all-time board is a whole-site total. The PRC
// rating is the older number the site ranked on before the blitz existed; it is
// only computed for the quiz sessions, but it is what legacy players still hold.
// `sort` picks which of the two decides the order; the other one is still shown,
// so switching the toggle never hides information.
export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const period = params.get("period") === "all" ? "all" : "day";
  // today's board is a points board only — a rating says nothing about one day
  const sort: Sort = period === "all" && params.get("sort") === "rating" ? "rating" : "points";
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

    rows = [...rows, ...legacy];

    rows = rows.filter((r) => byId.has(r.id) && !byId.get(r.id)!.hideScore);

    // Two orders over the same rows. Players missing the active measure fall to
    // the bottom (never dropped) and keep a stable order among themselves.
    const byPoints = (a: Row, b: Row) =>
      b.points - a.points || b.correct - a.correct || (b.prc ?? 0) - (a.prc ?? 0) || a.name.localeCompare(b.name);
    const byRating = (a: Row, b: Row) =>
      (b.prc ?? -1) - (a.prc ?? -1) || b.points - a.points || a.name.localeCompare(b.name);

    rows = rows.sort(sort === "rating" ? byRating : byPoints);
  }

  rows = rows.slice(0, 50);

  const myIdx = rows.findIndex((r) => r.id === session.sub);
  const mine =
    myIdx >= 0
      ? { ...rows[myIdx], rank: myIdx + 1 }
      : trainMine
        ? { ...trainMine, prc: prcOf(session.sub), basis: "run" as const, rank: null }
        : null;

  return NextResponse.json({ period, sort, dayStart: since?.toISOString() ?? null, rows, mine });
}
