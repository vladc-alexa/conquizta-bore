import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/invites/[id]/decline -> "not now". The host can invite again.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const invite = await prisma.gameInvite.findUnique({ where: { id } });
  if (!invite || invite.toId !== session.sub) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (invite.status === "PENDING") {
    await prisma.gameInvite.update({ where: { id }, data: { status: "DECLINED" } });
  }
  return NextResponse.json({ ok: true });
}
