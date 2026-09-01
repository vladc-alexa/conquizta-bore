import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin } from "@/lib/admin";

// GET /api/admin/questions?search=&status=reported|published|disabled|all&limit=100
// Admin question browser: id, prompt, correct answer, publish state, report count.
// Default status = "reported": the review queue, populated only by player reports
// (reporting a question also unpublishes it from the game).
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status") || "reported";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

  const where: Record<string, unknown> = {};
  if (search) {
    // allow searching by question ID prefix (as shown in the review modal)
    if (/^[0-9a-f-]{4,}$/i.test(search)) {
      where.OR = [{ prompt: { contains: search, mode: "insensitive" } }, { id: { startsWith: search.toLowerCase() } }];
    } else {
      where.prompt = { contains: search, mode: "insensitive" };
    }
  }
  if (status === "published") where.isPublished = true;
  if (status === "disabled") where.isPublished = false;
  if (status === "reported") {
    const counts = await prisma.questionReport.groupBy({
      by: ["questionId"],
      _count: { _all: true },
      orderBy: { _count: { _all: "desc" } },
      take: limit,
    });
    where.id = { in: counts.map((r) => r.questionId) };
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
        options: { select: { text: true, isCorrect: true } },
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
    reportCount: reports.get(q.id) ?? 0,
  }));
  if (status === "reported") list.sort((a, b) => b.reportCount - a.reportCount);

  return NextResponse.json({ questions: list });
}
