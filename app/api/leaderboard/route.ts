import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { getLeaderboardSnapshot } from "@/lib/leaderboardCache";
import { onlineUsers } from "@/lib/presence";

export const dynamic = "force-dynamic";

// GET /api/leaderboard            — top 10 + my own row (dashboard widget)
// GET /api/leaderboard?scope=all  — the full standings page: every ranked
//                                   player (top 200) with score, games played
//                                   and the date they joined.
// The heavy work (computeAllPrc over the whole answer history) is cached for
// ~60s and shared by all players; only the requester-specific row is derived here.
export async function GET(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const all = new URL(req.url).searchParams.get("scope") === "all";

  const { prcByUser, names: nameById, hidden: hiddenIds, computedAt } =
    await getLeaderboardSnapshot(prisma);

  // Users can be deleted while their (SetNull) sessions survive; those ghost
  // rows would rank forever with a stale name and no join date. Only rank
  // accounts that still exist.
  const joinedAt = all
    ? new Map(
        (
          await prisma.user.findMany({
            where: { id: { in: [...prcByUser.keys()] } },
            select: { id: true, createdAt: true },
          })
        ).map((u) => [u.id, u.createdAt.toISOString()]),
      )
    : null;

  const rows = [...prcByUser.entries()]
    .filter(([id, p]) => p.total !== null && !hiddenIds.has(id) && (!all || joinedAt!.has(id)))
    .map(([id, p]) => ({
      id,
      name: nameById.get(id) ?? "?",
      prc: p.total,
      grila: p.grila,
      rapide: p.rapide,
      games: p.games,
      ...(joinedAt ? { joinedAt: joinedAt.get(id) ?? null } : {}),
    }))
    .sort((a, b) => (b.prc ?? 0) - (a.prc ?? 0) || b.games - a.games)
    .slice(0, all ? 200 : 10);

  const myPos = rows.findIndex((r) => r.id === session.sub);
  // always include the requesting user's own row (may be below the top 10)
  const mine = prcByUser.get(session.sub);
  const me = mine?.total != null
    ? {
        id: session.sub,
        name: nameById.get(session.sub) ?? session.name,
        prc: mine.total,
        grila: mine.grila,
        rapide: mine.rapide,
        games: mine.games,
        hidden: hiddenIds.has(session.sub),
        ...(joinedAt ? { joinedAt: joinedAt.get(session.sub) ?? null } : {}),
      }
    : null;

  // who is around right now — same payload, so the page needs one request
  const online = (await onlineUsers(prisma)).map((p) => ({ ...p, you: p.id === session.sub }));

  return NextResponse.json({
    rows,
    myPos,
    me,
    computedAt,
    online,
    onlineCount: online.length,
    scope: all ? "all" : "top",
  });
}
