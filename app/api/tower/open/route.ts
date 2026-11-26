import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { TOWER_PLAYERS, TOWER_WAITING_TTL_MS, TOWER_LIVE_MS } from "@/lib/tower";

// GET /api/tower/open -> open tower rooms anyone can join, with the names of the
// players already seated (the lobby shows the table filling up), plus my own room
// so the host gets the Start button without leaving the lobby.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = session.sub;
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

  const shape = (g: (typeof games)[number]) => ({
    id: g.id,
    createdAt: g.createdAt,
    hostName: g.players.find((p) => p.userId === g.hostId)?.name ?? g.players[0]?.name ?? "?",
    players: g.players.map((p) => p.name),
    joined: g.players.length,
    mine: g.hostId === me || g.players.some((p) => p.userId === me),
  });

  // my table: a room I'm seated in wins over a running match
  const myRoom = await prisma.towerGame.findFirst({
    // same freshness rule as the public list: an abandoned waiting room is gone
    where: { status: "WAITING", createdAt: { gt: cutoff }, players: { some: { userId: me } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hostId: true,
      players: { select: { userId: true, name: true, seat: true }, orderBy: { seat: "asc" } },
    },
  });
  const myRun = myRoom
    ? null
    : await prisma.towerGame.findFirst({
        where: {
          status: "IN_PROGRESS",
          // a run nobody has touched in a while is a zombie: everyone walked away
          // (or the tab died mid-climb) and it must not hold a seat hostage
          updatedAt: { gt: new Date(Date.now() - TOWER_LIVE_MS) },
          // once you've fallen you have no climb to go back to
          players: { some: { userId: me, eliminated: false } },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          hostId: true,
          players: { select: { userId: true, name: true, seat: true }, orderBy: { seat: "asc" } },
        },
      });

  return NextResponse.json({
    seats: TOWER_PLAYERS,
    mine: myRoom
      ? {
          id: myRoom.id,
          status: "WAITING",
          role: myRoom.hostId === me ? "host" : "player",
          hostName: myRoom.players.find((p) => p.userId === myRoom.hostId)?.name ?? "?",
          players: myRoom.players.map((p) => p.name),
        }
      : myRun
        ? {
            id: myRun.id,
            status: "IN_PROGRESS",
            role: myRun.hostId === me ? "host" : "player",
            hostName: myRun.players.find((p) => p.userId === myRun.hostId)?.name ?? "?",
            players: myRun.players.map((p) => p.name),
          }
        : null,
    games: games.filter((g) => !(g.hostId === me || g.players.some((p) => p.userId === me))).map(shape),
  });
}
