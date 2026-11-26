import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/duel/[id]/start -> host-only: both seats are taken, open round 0.
// The lobby (and the /duel/[id] waiting screen) calls this instead of the match
// starting itself the moment a second player sits down.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const duel = await prisma.duel.findUnique({
    where: { id },
    select: { hostId: true, guestId: true, status: true },
  });
  if (!duel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (duel.hostId !== session.sub) {
    return NextResponse.json({ error: "doar cine a deschis meciul îl pornește" }, { status: 403 });
  }
  if (duel.status !== "WAITING") return NextResponse.json({ error: "meciul a pornit deja" }, { status: 409 });
  if (!duel.guestId) return NextResponse.json({ error: "așteaptă să intre un adversar" }, { status: 409 });

  const res = await prisma.duel.updateMany({
    where: { id, status: "WAITING", guestId: { not: null } },
    data: { status: "IN_PROGRESS", currentRound: 0, roundStartedAt: new Date() },
  });
  if (res.count === 0) return NextResponse.json({ error: "meciul a pornit deja" }, { status: 409 });
  return NextResponse.json({ ok: true, status: "IN_PROGRESS" });
}
