import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { startTower } from "@/lib/tower";

// POST /api/tower/[id]/start { fillWithBots?: boolean }
// Host-only: bots seat themselves in the empty chairs so a solo player can climb.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.towerGame.findUnique({ where: { id }, select: { hostId: true, status: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.hostId !== session.sub) return NextResponse.json({ error: "doar gazda pornește" }, { status: 403 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "turnul a pornit" }, { status: 409 });

  try {
    await startTower(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nu pot porni turnul";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
