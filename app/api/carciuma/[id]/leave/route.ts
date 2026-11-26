import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { CARCIUMA_MAX_DRINKS, resolveCarciuma } from "@/lib/carciuma";

// POST /api/carciuma/[id]/leave
// Lobby: give up the chair (the host closes the table). Mid-game: get up and be
// counted as passed out so the rest of the table can carry on.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.carciumaGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (game.status === "WAITING") {
    if (game.hostId === session.sub) {
      await prisma.carciumaGame.update({ where: { id }, data: { status: "ABANDONED", completedAt: new Date() } });
    } else {
      await prisma.carciumaPlayer.deleteMany({ where: { gameId: id, userId: session.sub } });
    }
    return NextResponse.json({ ok: true });
  }

  const me = game.players.find((p) => p.userId === session.sub);
  if (me && game.status === "IN_PROGRESS") {
    await prisma.carciumaPlayer.update({
      where: { id: me.id },
      data: { passedOut: true, drinks: CARCIUMA_MAX_DRINKS, outRound: game.currentRound },
    });
    await resolveCarciuma(id);
  }
  return NextResponse.json({ ok: true });
}
