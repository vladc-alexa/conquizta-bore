import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { fillCarciumaBots } from "@/lib/carciuma";

// POST /api/carciuma/[id]/bots -> host fills every empty chair with a local.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.carciumaGame.findUnique({ where: { id }, select: { hostId: true, status: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.hostId !== session.sub) return NextResponse.json({ error: "doar gazda cheamă localnicii" }, { status: 403 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "masa a început" }, { status: 409 });

  await fillCarciumaBots(id);
  const seated = await prisma.carciumaPlayer.count({ where: { gameId: id } });
  return NextResponse.json({ ok: true, seated });
}
