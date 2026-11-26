import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";
import { logQuestionEdit } from "@/lib/questionAudit";

// POST /api/admin/questions/[id]/toggle — enable/disable a question (admins + editors).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({
    where: { id },
    select: { id: true, isPublished: true, prompt: true },
  });
  if (!question) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.question.update({
    where: { id },
    data: { isPublished: !question.isPublished },
    select: { id: true, isPublished: true },
  });
  await logQuestionEdit({
    questionId: id,
    editorId: auth.id,
    action: updated.isPublished ? "publish" : "unpublish",
    prompt: question.prompt,
  });
  return NextResponse.json({ isPublished: updated.isPublished });
}
