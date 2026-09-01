import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";

// POST /api/admin/questions/[id]/toggle — enable/disable a question (admins + editors).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({ where: { id }, select: { id: true, isPublished: true } });
  if (!question) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.question.update({
    where: { id },
    data: { isPublished: !question.isPublished },
    select: { id: true, isPublished: true },
  });
  return NextResponse.json({ isPublished: updated.isPublished });
}
