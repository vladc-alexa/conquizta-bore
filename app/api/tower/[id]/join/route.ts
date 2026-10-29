import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { TOWER_PLAYERS, releaseOtherTowers } from "@/lib/tower";

// POST /api/tower/[id]/join -> take the next free seat. The tower does NOT start
// itself when the last chair is taken: everyone waits in the lobby and the host
// presses Start, so late arrivals still see who is at the table.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.towerGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "turnul a pornit" }, { status: 409 });
  if (game.players.some((p) => p.userId === session.sub)) {
    return NextResponse.json({ ok: true, alreadySeated: true });
  }
  if (game.players.length >= TOWER_PLAYERS) {
    return NextResponse.json({ error: "turnul e plin" }, { status: 409 });
  }
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  // taking a chair here means letting go of any other tower you're sitting in
  await releaseOtherTowers(session.sub, id);

  const taken = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;

  try {
    await prisma.towerPlayer.create({ data: { gameId: id, userId: session.sub, name: me.displayName, seat } });
  } catch {
    return NextResponse.json({ error: "locul a fost luat" }, { status: 409 });
  }
  const now = await prisma.towerPlayer.count({ where: { gameId: id } });
  return NextResponse.json({ ok: true, seat, seated: now, full: now >= TOWER_PLAYERS });
}
