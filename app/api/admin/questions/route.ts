import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireEditor } from "@/lib/admin";

// GET /api/admin/questions?search=&status=reported|published|disabled|all&limit=50&offset=0
// Question browser (admins + editors): id, prompt, options, correct answer,
// publish state, report count. Default status = "reported": the review queue,
// populated only by player reports (reporting a question also unpublishes it).
// Paged: returns `total` (rows matching the current filter) so the client can
// infinite-scroll until it has them all. `counts` stay GLOBAL (header counter).
export async function GET(req: Request) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status") || "reported";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

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
        LIMIT 200`;
      if (byId.length) or.push({ id: { in: byId.map((r) => r.id) } });
    }
    where.OR = or;
  }
  if (status === "published") where.isPublished = true;
  if (status === "disabled") where.isPublished = false;

  // status="reported": rank questions by report count, then page over that order.
  let reportedIds: string[] | null = null;
  if (status === "reported") {
    const counts = await prisma.questionReport.groupBy({ by: ["questionId"], _count: { _all: true } });
    reportedIds = counts
      .sort((a, b) => b._count._all - a._count._all)
      .map((r) => r.questionId);
    where.id = { in: reportedIds.slice(offset, offset + limit) };
  }

  const [questions, reportCounts, total, shapeRows] = await Promise.all([
    prisma.question.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: reportedIds ? 0 : offset,
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
    reportedIds ? Promise.resolve(reportedIds.length) : prisma.question.count({ where }),
    // Global shape counts for the header counter (independent of search/status).
    // grilă = 4 options, rapidă = 1 option (same classification as the editor).
    prisma.$queryRaw<{ published: boolean; opts: number; n: number }[]>`
      SELECT q."isPublished" AS published,
             (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id)::int AS opts,
             count(*)::int AS n
      FROM "Question" q
      GROUP BY 1, 2`,
  ]);

  const counts = {
    active: { total: 0, grila: 0, rapide: 0, other: 0 },
    inactive: { total: 0, grila: 0, rapide: 0, other: 0 },
  };
  for (const row of shapeRows) {
    const bucket = row.published ? counts.active : counts.inactive;
    const n = Number(row.n);
    bucket.total += n;
    if (Number(row.opts) === 4) bucket.grila += n;
    else if (Number(row.opts) === 1) bucket.rapide += n;
    else bucket.other += n;
  }
  const reports = new Map(reportCounts.map((r) => [r.questionId, r._count._all]));

  let list = questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    isPublished: q.isPublished,
    createdAt: q.createdAt,
    correctAnswer: q.options.find((o) => o.isCorrect)?.text ?? null,
    options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
    reportCount: reports.get(q.id) ?? 0,
  }));
  if (reportedIds) {
    // restore the report-count ranking (the `in` filter loses it)
    const rank = new Map(reportedIds.slice(offset, offset + limit).map((id, i) => [id, i]));
    list.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  return NextResponse.json({ questions: list, counts, total, offset, limit });
}
