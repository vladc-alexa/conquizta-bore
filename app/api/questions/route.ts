import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/questions?mode=rapide|grila&count=10
// Returns random published questions for the train game.
// - rapide: numeric-answer questions -> { id, prompt, answer }
// - grila:  4-option questions -> { id, prompt, options[4], correctIndex }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const count = Math.min(Math.max(parseInt(url.searchParams.get("count") || "10", 10) || 10, 1), 20);

  if (mode !== "rapide" && mode !== "grila") {
    return NextResponse.json({ error: "mode must be rapide or grila" }, { status: 400 });
  }

  // random sample of published question ids, filtered at the SQL level
  let ids: { id: string }[];
  if (mode === "rapide") {
    ids = await prisma.$queryRaw`
      SELECT q.id FROM "Question" q
      JOIN "QuestionOption" o ON o."questionId" = q.id AND o."isCorrect" = true
      WHERE q."isPublished" = true AND trim(o."text") ~ '^-?[0-9]+$'
      ORDER BY random()
      LIMIT ${count}`;
  } else {
    ids = await prisma.$queryRaw`
      SELECT q.id FROM "Question" q
      WHERE q."isPublished" = true
        AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id) = 4
        AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id AND o."isCorrect" = true) = 1
      ORDER BY random()
      LIMIT ${count}`;
  }

  if (!ids.length) {
    return NextResponse.json({ questions: [] });
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: {
      id: true,
      prompt: true,
      options: { select: { text: true, isCorrect: true }, orderBy: { position: "asc" } },
    },
  });

  if (mode === "rapide") {
    const out = questions
      .map((q) => {
        const correct = q.options.find((o) => o.isCorrect);
        if (!correct || !/^-?\d+$/.test(correct.text.trim())) return null;
        const answer = parseInt(correct.text.trim(), 10);
        let responseType = "număr";
        if (/în ce an\b|în anul\b|\banul\b|când a fost|când s-a născut|când a murit|când a apărut|când a fost/i.test(q.prompt)) {
          responseType = "an";
        } else if (answer < 0) {
          responseType = "număr negativ";
        } else if (/\bcâți\b|\bcâte\b|\bcâta\b|număr de|câte/i.test(q.prompt)) {
          responseType = "număr";
        }
        return { id: q.id, prompt: q.prompt, answer, responseType };
      })
      .filter(Boolean);
    return NextResponse.json({ questions: out });
  }

  // grila: require exactly 4 options + one correct; shuffle option order
  const out = questions
    .map((q) => {
      if (q.options.length !== 4 || q.options.filter((o) => o.isCorrect).length !== 1) return null;
      const correctIndex = q.options.findIndex((o) => o.isCorrect);
      const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      return {
        id: q.id,
        prompt: q.prompt,
        options: order.map((i) => q.options[i].text),
        correctIndex: order.indexOf(correctIndex),
      };
    })
    .filter(Boolean);
  return NextResponse.json({ questions: out });
}
