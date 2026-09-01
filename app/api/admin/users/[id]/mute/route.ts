import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// POST /api/admin/users/[id]/mute — toggle a user's chat mute.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  if (id === auth.id) return NextResponse.json({ error: "Nu te poți muta pe tine." }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, isAdmin: true, isMuted: true } });
  if (!target) return NextResponse.json({ error: "Jucătorul nu există." }, { status: 404 });
  if (target.isAdmin) return NextResponse.json({ error: "Nu poți muta un admin." }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id },
    data: { isMuted: !target.isMuted },
    select: { id: true, isMuted: true },
  });
  return NextResponse.json({ isMuted: updated.isMuted });
}
