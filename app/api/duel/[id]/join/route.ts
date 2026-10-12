import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/duel/[id]/join -> idempotent: seat the caller and (when a second
// player sits) start the match on round 0.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const duel = await prisma.duel.findUnique({
    where: { id },
    select: { id: true, hostId: true, guestId: true, status: true },
  });
  if (!duel) return NextResponse.json({ error: "not found" }, { status: 404 });

  const me = session.sub;
  const already = duel.hostId === me || duel.guestId === me;
  if (already) return NextResponse.json({ ok: true, status: duel.status, role: duel.hostId === me ? "host" : "guest" });

  if (duel.status !== "WAITING") return NextResponse.json({ error: "meciul nu mai poate fi accesat" }, { status: 409 });
  if (duel.guestId && duel.guestId !== me) return NextResponse.json({ error: "meciul este plin" }, { status: 409 });

  const res = await prisma.duel.updateMany({
    where: { id, status: "WAITING", guestId: null },
    data: { guestId: me, status: "IN_PROGRESS", currentRound: 0, roundStartedAt: new Date() },
  });
  if (res.count === 0) return NextResponse.json({ error: "meciul este plin" }, { status: 409 });
  return NextResponse.json({ ok: true, status: "IN_PROGRESS", role: "guest" });
}
