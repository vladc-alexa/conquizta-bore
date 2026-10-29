import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { seatInCarciuma } from "@/lib/seat";

// POST /api/carciuma/[id]/join -> take the next free chair. The host presses
// Start; empty chairs are then filled by bots.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  const r = await seatInCarciuma(id, session.sub, me.displayName);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, seat: r.seat, seated: r.seated, full: r.full, ...(r.alreadySeated ? { alreadySeated: true } : {}) });
}
