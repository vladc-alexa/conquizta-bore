import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { CARCIUMA_SEATS, CARCIUMA_WAITING_TTL_MS, resolveCarciuma } from "@/lib/carciuma";

// GET /api/carciuma/open -> open tables anyone can sit at, plus my own table so
// the host gets the Start button without leaving the lobby.
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = session.sub;
  const cutoff = new Date(Date.now() - CARCIUMA_WAITING_TTL_MS);
  const running = await prisma.carciumaGame.findMany({
    where: { status: "IN_PROGRESS", players: { some: { userId: me } } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  // settle anything that closed since the last visit
  for (const g of running) await resolveCarciuma(g.id);

  const games = await prisma.carciumaGame.findMany({
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
    seats: CARCIUMA_SEATS,
    mine: g.hostId === me || g.players.some((p) => p.userId === me),
  });

  const myRoom = await prisma.carciumaGame.findFirst({
    where: { status: "WAITING", players: { some: { userId: me } } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hostId: true,
      players: { select: { userId: true, name: true, seat: true }, orderBy: { seat: "asc" } },
    },
  });
  const myRun = myRoom
    ? null
    : await prisma.carciumaGame.findFirst({
        where: { status: "IN_PROGRESS", players: { some: { userId: me } } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          hostId: true,
          players: { select: { userId: true, name: true, seat: true }, orderBy: { seat: "asc" } },
        },
      });

  return NextResponse.json({
    seats: CARCIUMA_SEATS,
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
