import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";

// GET /api/admin/questions?search=&status=reported|published|disabled|all&limit=100
// Question browser (admins + editors): id, prompt, options, correct answer,
// publish state, report count. Default status = "reported": the review queue,
// populated only by player reports (reporting a question also unpublishes it).
export async function GET(req: Request) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status") || "reported";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  const where: Record<string, unknown> = {};
  if (search) {
    // allow searching by question ID: full uuid, hyphenless uuid, or the short prefix
    // shown in the review modal. "Question"."id" is a native uuid column, so Prisma
    // string filters (startsWith/contains) are invalid on it — match via SQL LIKE on
    // the text form, with hyphens stripped on both sides (keeps prefix matching exact).
    const or: Record<string, unknown>[] = [{ prompt: { contains: search, mode: "insensitive" } }];
    if (/^[0-9a-f-]{4,}$/i.test(search)) {
      const idPattern = search.toLowerCase().replace(/-/g, "");
      const byId = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Question"
        WHERE replace(id::text, '-', '') LIKE ${idPattern + "%"}
        LIMIT ${limit}`;
      if (byId.length) or.push({ id: { in: byId.map((r) => r.id) } });
    }
    where.OR = or;
  }
  if (status === "published") where.isPublished = true;
  if (status === "disabled") where.isPublished = false;
  if (status === "reported") {
    const counts = await prisma.questionReport.groupBy({ by: ["questionId"], _count: { _all: true } });
    const top = counts.sort((a, b) => b._count._all - a._count._all).slice(0, limit);
    where.id = { in: top.map((r) => r.questionId) };
  }

  const [questions, reportCounts] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        prompt: true,
        isPublished: true,
        createdAt: true,
        options: { select: { id: true, text: true, isCorrect: true } },
      },
    }),
    prisma.questionReport.groupBy({ by: ["questionId"], _count: { _all: true } }),
  ]);
  const reports = new Map(reportCounts.map((r) => [r.questionId, r._count._all]));

  const list = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    isPublished: q.isPublished,
    createdAt: q.createdAt,
    correctAnswer: q.options.find((o) => o.isCorrect)?.text ?? null,
    options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
    reportCount: reports.get(q.id) ?? 0,
  }));
  if (status === "reported") list.sort((a, b) => b.reportCount - a.reportCount);

  return NextResponse.json({ questions: list });
}
