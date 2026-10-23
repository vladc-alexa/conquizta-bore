import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { CARCIUMA_SEATS, CARCIUMA_WAITING_TTL_MS, expireStaleCarciuma } from "@/lib/carciuma";

// POST /api/carciuma -> { gameId }   (open a table; host takes the first chair)
export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await expireStaleCarciuma(session.sub);
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  // one open table per host, or the tavern fills with ghosts
  const already = await prisma.carciumaGame.findFirst({
    where: {
      hostId: session.sub,
      status: "WAITING",
      createdAt: { gt: new Date(Date.now() - CARCIUMA_WAITING_TTL_MS) },
    },
    select: { id: true },
  });
  if (already) return NextResponse.json({ gameId: already.id, reused: true });

  const game = await prisma.carciumaGame.create({
    data: { host: { connect: { id: session.sub } }, plan: [] },
    select: { id: true },
  });
  await prisma.carciumaPlayer.create({
    data: { gameId: game.id, userId: session.sub, name: me.displayName, seat: 0 },
  });
  return NextResponse.json({ gameId: game.id, seats: CARCIUMA_SEATS }, { status: 201 });
}
