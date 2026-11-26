import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";
import { logQuestionEdit } from "@/lib/questionAudit";
import { quarantineQuestions, restoreQuestion } from "@/lib/questionTriage";

// POST /api/admin/questions/[id]/quarantine — triage actions (admins + editors).
//   { action: "quarantine" }  pull out of rotation, keep for review
//   { action: "restore" }     republish and clear the quarantine marker
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({
    where: { id },
    select: { id: true, prompt: true },
  });
  if (!question) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "quarantine") {
    await quarantineQuestions([id], "reported");
    await logQuestionEdit({
      questionId: id,
      editorId: auth.id,
      action: "unpublish",
      prompt: question.prompt,
      summary: "băgată în carantină",
    });
    return NextResponse.json({ quarantined: true, isPublished: false });
  }

  if (action === "restore") {
    await restoreQuestion(id);
    await logQuestionEdit({
      questionId: id,
      editorId: auth.id,
      action: "publish",
      prompt: question.prompt,
      summary: "scoasă din carantină",
    });
    return NextResponse.json({ quarantined: false, isPublished: true });
  }

  return NextResponse.json({ error: "actiune necunoscuta" }, { status: 400 });
}
