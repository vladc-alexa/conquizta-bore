import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { computeAllPrc } from "@/lib/prc";

export const dynamic = "force-dynamic";

// GET /api/leaderboard — Clasamentul zilei, sortat după PRC.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prcByUser = await computeAllPrc(prisma);
  const userIds = [...prcByUser.keys()];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, hideScore: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.displayName]));
  const hiddenIds = new Set(users.filter((u) => u.hideScore).map((u) => u.id));

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

  return NextResponse.json({ rows, myPos, me });
}
