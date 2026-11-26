import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// POST /api/admin/users/[id]/editor — toggle whether the user can edit questions.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  if (id === auth.id) return NextResponse.json({ error: "Nu poți schimba rolul propriu." }, { status: 400 });
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, canEditQuestions: true } });
  if (!target) return NextResponse.json({ error: "Jucătorul nu există." }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id },
    data: { canEditQuestions: !target.canEditQuestions },
    select: { id: true, canEditQuestions: true },
  });
  return NextResponse.json({ canEditQuestions: updated.canEditQuestions });
}
