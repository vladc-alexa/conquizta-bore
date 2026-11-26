import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/tower/[id]/leave
// Lobby: give up the seat (the host abandons the room). Mid-game: stand up and
// be marked as fallen so the rest can carry on.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.towerGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (game.status === "WAITING") {
    if (game.hostId === session.sub) {
      await prisma.towerGame.update({ where: { id }, data: { status: "ABANDONED", completedAt: new Date() } });
    } else {
      await prisma.towerPlayer.deleteMany({ where: { gameId: id, userId: session.sub } });
    }
    return NextResponse.json({ ok: true });
  }

  const me = game.players.find((p) => p.userId === session.sub);
  if (me && game.status === "IN_PROGRESS") {
    await prisma.towerPlayer.updateMany({ where: { id: me.id }, data: { eliminated: true, fellRound: game.currentRound + 1 } });
  }
  return NextResponse.json({ ok: true });
}
