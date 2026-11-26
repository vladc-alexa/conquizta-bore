import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";

// GET /api/admin/questions/[id]/edits — the audit trail for one question:
// who changed it, when, what kind of change, and what changed.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const edits = await prisma.questionEdit.findMany({
    where: { questionId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      editorId: true,
      editorName: true,
      action: true,
      summary: true,
      prompt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ edits });
}
