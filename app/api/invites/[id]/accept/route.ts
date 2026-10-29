import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { seatInTower, seatInCarciuma } from "@/lib/seat";

// POST /api/invites/[id]/accept -> take the offered seat. This is the same
// seating path as joining from the lobby, so capacity / "you left your old
// table" rules can't drift between the two entry points.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const invite = await prisma.gameInvite.findUnique({ where: { id } });
  if (!invite || invite.toId !== session.sub) return NextResponse.json({ error: "invitația nu e a ta" }, { status: 404 });
  if (invite.status !== "PENDING") return NextResponse.json({ error: "invitație folosită" }, { status: 409 });
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.gameInvite.update({ where: { id }, data: { status: "DECLINED" } });
    return NextResponse.json({ error: "invitația a expirat" }, { status: 410 });
  }

  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  if (!me?.displayName) return NextResponse.json({ error: "fără nume" }, { status: 400 });

  const seated = invite.kind === "tower" ? await seatInTower(invite.gameId, session.sub, me.displayName) : await seatInCarciuma(invite.gameId, session.sub, me.displayName);
  if ("error" in seated) {
    await prisma.gameInvite.update({ where: { id }, data: { status: "DECLINED" } });
    if ("error" in seated) return NextResponse.json({ error: seated.error }, { status: seated.status });
  }

  await prisma.gameInvite.update({ where: { id }, data: { status: "ACCEPTED" } });
  const href = `/${invite.kind}/${invite.gameId}`;
  return NextResponse.json({ ok: true, href, seat: seated.seat, seated: seated.seated });
}
