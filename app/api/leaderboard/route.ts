import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { getLeaderboardSnapshot } from "@/lib/leaderboardCache";

export const dynamic = "force-dynamic";

// GET /api/leaderboard — Clasamentul zilei, sortat după PRC.
// The heavy work (computeAllPrc over the whole answer history) is cached for
// ~60s and shared by all players; only the requester-specific row is derived here.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { prcByUser, names: nameById, hidden: hiddenIds, computedAt } =
    await getLeaderboardSnapshot(prisma);

  const rows = [...prcByUser.entries()]
    .filter(([id, p]) => p.total !== null && !hiddenIds.has(id))
    .map(([id, p]) => ({
      id,
      name: nameById.get(id) ?? "?",
      prc: p.total,
      grila: p.grila,
      rapide: p.rapide,
      games: p.games,
    }))
    .sort((a, b) => (b.prc ?? 0) - (a.prc ?? 0) || b.games - a.games)
    .slice(0, 10);

  const myPos = rows.findIndex((r) => r.id === session.sub);
  // always include the requesting user's own row (may be below the top 10)
  const mine = prcByUser.get(session.sub);
  const me = mine?.total != null
    ? { id: session.sub, name: nameById.get(session.sub) ?? session.name, prc: mine.total, grila: mine.grila, rapide: mine.rapide, games: mine.games, hidden: hiddenIds.has(session.sub) }
    : null;

  return NextResponse.json({ rows, myPos, me, computedAt });
}
