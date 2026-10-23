import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { fillCarciumaBots, CARCIUMA_SEATS } from "@/lib/carciuma";

// POST /api/carciuma/[id]/bots -> host seats locals, one chair at a time.
// Body: { count?: number } — 1 by default, more to fill several chairs at once.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const raw = Number(body?.count ?? 1);
  const count = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), CARCIUMA_SEATS) : 1;

  const game = await prisma.carciumaGame.findUnique({ where: { id }, select: { hostId: true, status: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.hostId !== session.sub) return NextResponse.json({ error: "doar gazda cheamă localnicii" }, { status: 403 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "masa a început" }, { status: 409 });

  const seatedNow = await prisma.carciumaPlayer.count({ where: { gameId: id } });
  if (seatedNow >= CARCIUMA_SEATS) return NextResponse.json({ error: "masa e plină" }, { status: 409 });

  const added = await fillCarciumaBots(id, count);
  const seated = await prisma.carciumaPlayer.count({ where: { gameId: id } });
  return NextResponse.json({ ok: true, added, seated });
}
