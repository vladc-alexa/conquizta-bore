import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// POST /api/admin/users/[id]/hide — toggle whether the player's score is
// visible on the public leaderboard (the player still sees their own score).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, hideScore: true } });
  if (!target) return NextResponse.json({ error: "Jucătorul nu există." }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id },
    data: { hideScore: !target.hideScore },
    select: { id: true, hideScore: true },
  });
  return NextResponse.json({ hideScore: updated.hideScore });
}
