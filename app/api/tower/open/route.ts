import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { TOWER_PLAYERS, TOWER_WAITING_TTL_MS } from "@/lib/tower";

// GET /api/tower/open -> open tower rooms anyone can join (+ my own room)
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cutoff = new Date(Date.now() - TOWER_WAITING_TTL_MS);
  const games = await prisma.towerGame.findMany({
    where: { status: "WAITING", createdAt: { gt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      hostId: true,
      createdAt: true,
      players: { select: { userId: true, name: true, seat: true }, orderBy: { seat: "asc" } },
    },
  });

  const mine = await prisma.towerGame.findFirst({
    where: { status: "IN_PROGRESS", players: { some: { userId: session.sub } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return NextResponse.json({
    seats: TOWER_PLAYERS,
    mine: mine ? { id: mine.id } : null,
    games: games.map((g) => ({
      id: g.id,
      createdAt: g.createdAt,
      mine: g.hostId === session.sub || g.players.some((p) => p.userId === session.sub),
      hostName: g.players.find((p) => p.userId === g.hostId)?.name ?? g.players[0]?.name ?? "?",
      joined: g.players.length,
    })),
  });
}
