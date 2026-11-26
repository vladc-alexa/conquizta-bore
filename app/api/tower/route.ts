import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { expireStaleTowers, TOWER_PLAYERS, TOWER_WAITING_TTL_MS } from "@/lib/tower";

// POST /api/tower -> { gameId }   (open a tower room; host takes the first seat)
export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await expireStaleTowers(session.sub);
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  // one open room per host, or the lobby fills with ghosts
  const already = await prisma.towerGame.findFirst({
    where: {
      hostId: session.sub,
      status: "WAITING",
      createdAt: { gt: new Date(Date.now() - TOWER_WAITING_TTL_MS) },
    },
    select: { id: true },
  });
  if (already) return NextResponse.json({ gameId: already.id, reused: true });

  const game = await prisma.towerGame.create({
    data: { host: { connect: { id: session.sub } }, plan: [] },
    select: { id: true },
  });
  await prisma.towerPlayer.create({
    data: { gameId: game.id, userId: session.sub, name: me.displayName, seat: 0 },
  });
  return NextResponse.json({ gameId: game.id, seats: TOWER_PLAYERS }, { status: 201 });
}
