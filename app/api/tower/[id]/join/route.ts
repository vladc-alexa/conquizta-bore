import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { seatInTower } from "@/lib/seat";

// POST /api/tower/[id]/join -> take the next free seat. The tower does NOT start
// itself when the last chair is taken: everyone waits in the lobby and the host
// presses Start, so late arrivals still see who is at the table.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  const r = await seatInTower(id, session.sub, me.displayName);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, seat: r.seat, seated: r.seated, full: r.full, ...(r.alreadySeated ? { alreadySeated: true } : {}) });
}
