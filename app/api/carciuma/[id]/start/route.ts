import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { startCarciuma } from "@/lib/carciuma";

// POST /api/carciuma/[id]/start
// Host-only. The empty chairs are filled with bots, so a solo player can still
// sit down and drink with the regulars.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.carciumaGame.findUnique({ where: { id }, select: { hostId: true, status: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (game.hostId !== session.sub) return NextResponse.json({ error: "doar gazda pornește" }, { status: 403 });
  if (game.status !== "WAITING") return NextResponse.json({ error: "masa a început" }, { status: 409 });

  try {
    await startCarciuma(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nu pot porni masa";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
