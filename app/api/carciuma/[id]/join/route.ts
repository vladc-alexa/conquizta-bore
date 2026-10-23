import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { CARCIUMA_SEATS } from "@/lib/carciuma";

// POST /api/carciuma/[id]/join -> take the next free chair. The host presses
// Start; empty chairs are then filled by bots.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.carciumaGame.findUnique({ where: { id }, include: { players: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "masa a început" }, { status: 409 });
  if (game.players.some((p) => p.userId === session.sub)) {
    return NextResponse.json({ ok: true, alreadySeated: true });
  }
  if (game.players.length >= CARCIUMA_SEATS) {
    return NextResponse.json({ error: "masa e plină" }, { status: 409 });
  }
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  // taking someone else's chair means giving up your own open table
  await prisma.carciumaGame.updateMany({
    where: { hostId: session.sub, status: "WAITING", NOT: { id } },
    data: { status: "ABANDONED" },
  });

  const taken = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;

  try {
    await prisma.carciumaPlayer.create({ data: { gameId: id, userId: session.sub, name: me.displayName, seat } });
  } catch {
    return NextResponse.json({ error: "locul a fost luat" }, { status: 409 });
  }
  const now = await prisma.carciumaPlayer.count({ where: { gameId: id } });
  return NextResponse.json({ ok: true, seat, seated: now, full: now >= CARCIUMA_SEATS });
}
