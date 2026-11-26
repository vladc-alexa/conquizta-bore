import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/duel/[id]/leave -> abandon (cancel a lobby, or forfeit a live match).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const duel = await prisma.duel.findUnique({ where: { id }, select: { hostId: true, guestId: true } });
  if (!duel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (duel.hostId !== session.sub && duel.guestId !== session.sub) {
    return NextResponse.json({ error: "not a participant" }, { status: 403 });
  }

  const res = await prisma.duel.updateMany({
    where: { id, status: { in: ["WAITING", "IN_PROGRESS"] } },
    data: { status: "ABANDONED", completedAt: new Date() },
  });
  return NextResponse.json({ ok: true, abandoned: res.count > 0 });
}
