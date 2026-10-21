import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";
import { buildTowerState } from "@/lib/tower";

/** Two successful hits on the same climber in one round cost him a rung. */
const HITS_TO_KNOCK = 2;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const game = await prisma.towerGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.status !== "IN_PROGRESS") return NextResponse.json({ error: "meciul nu e în curs" }, { status: 409 });

  const me = game.players.find((p) => p.userId === session.sub);
  if (!me) return NextResponse.json({ error: "nu ești în meci" }, { status: 403 });
  if (me.eliminated) return NextResponse.json({ error: "ai căzut" }, { status: 409 });

  let body: { targetId?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  const target = game.players.find((p) => p.id === targetId);
  if (!target || target.eliminated) return NextResponse.json({ error: "țintă invalidă" }, { status: 400 });
  if (target.id === me.id) return NextResponse.json({ error: "nu arunci în tine" }, { status: 400 });

  // only after you answered the round — answering fast buys you the rock
  const answered = await prisma.towerAnswer.findFirst({
    where: { gameId: id, round: game.currentRound, playerId: me.id },
  });
  if (!answered) return NextResponse.json({ error: "răspunde mai întâi" }, { status: 409 });

  const round = game.currentRound;
  const already = await prisma.towerRock.findFirst({ where: { gameId: id, round, throwerId: me.id } });
  if (already) return NextResponse.json({ error: "ai aruncat deja în runda asta" }, { status: 409 });

  await prisma.towerRock.create({ data: { gameId: id, round, throwerId: me.id, targetId: target.id } });

  const hits = await prisma.towerRock.count({ where: { gameId: id, round, targetId: target.id } });
  let knocked = false;
  if (hits >= HITS_TO_KNOCK && target.rungs > 0) {
    await prisma.towerPlayer.update({
      where: { id: target.id },
      data: { rungs: Math.max(0, target.rungs - 1) },
    });
    knocked = true;
  }

  const state = await buildTowerState(id, session.sub);
  return NextResponse.json({ ok: true, hits, knocked, targetName: target.name, state }, { status: 201 });
}
