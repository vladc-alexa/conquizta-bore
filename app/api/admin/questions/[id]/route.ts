import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isError, requireAdmin, requireEditor } from "@/lib/admin";

// DELETE /api/admin/questions/[id] — PERMANENT delete (admins only).
// Irreversible: removes the question, its options, reports and per-question user
// stats. Also clears SessionAnswer rows first, because that relation is
// onDelete: Restrict and would otherwise block the delete.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({ where: { id }, select: { id: true, prompt: true } });
  if (!question) return NextResponse.json({ error: "Întrebarea nu există." }, { status: 404 });

  await prisma.$transaction([
    prisma.sessionAnswer.deleteMany({ where: { questionId: id } }),
    prisma.duelAnswer.deleteMany({ where: { questionId: id } }),
    prisma.question.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true, deleted: id });
}

// PUT /api/admin/questions/[id] { prompt, options: [{ text, isCorrect }] }
// Edit a question (admins + editors): rewrite the prompt and the options.
// Publish state is left untouched — use the toggle route to activate/deactivate.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (isError(auth)) return auth;

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({ where: { id }, select: { id: true } });
  if (!question) return NextResponse.json({ error: "Întrebarea nu există." }, { status: 404 });

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const options = Array.isArray(body?.options) ? body.options : [];

  if (!prompt || prompt.length > 1000) {
    return NextResponse.json({ error: "Întrebarea e obligatorie (max 1000 caractere)." }, { status: 400 });
  }
  const cleanOptions = options
    .map((o: { text?: string; isCorrect?: boolean }, i: number) => ({
      text: typeof o?.text === "string" ? o.text.trim() : "",
      isCorrect: !!o?.isCorrect,
      position: i,
    }))
    .filter((o) => o.text.length > 0);

  if (cleanOptions.length === 1) {
    // rapide: single numeric answer, range -500 .. 10.000.000
    const answer = cleanOptions[0].text;
    if (!/^-?\d+$/.test(answer)) {
      return NextResponse.json({ error: "Răspunsul la întrebările rapide trebuie să fie un număr." }, { status: 400 });
    }
    const n = parseInt(answer, 10);
    if (n < -500 || n > 10000000) {
      return NextResponse.json({ error: "Răspunsul trebuie să fie între -500 și 10.000.000." }, { status: 400 });
    }
    cleanOptions[0].isCorrect = true;
  } else if (cleanOptions.length === 4) {
    // grila: exactly 4 variants, exactly one correct
    if (cleanOptions.filter((o) => o.isCorrect).length !== 1) {
      return NextResponse.json({ error: "Trebuie marcată exact o variantă corectă." }, { status: 400 });
    }
  } else {
    return NextResponse.json(
      { error: "Întrebările rapide au 1 răspuns numeric, iar cele grilă exact 4 variante." },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.question.update({ where: { id }, data: { prompt } }),
    prisma.questionOption.deleteMany({ where: { questionId: id } }),
    prisma.questionOption.createMany({
      data: cleanOptions.map((o) => ({
        questionId: id,
        text: o.text.slice(0, 500),
        position: o.position,
        isCorrect: o.isCorrect,
      })),
    }),
    // Editing counts as "solved": clear the player reports so the question
    // leaves the review queue and loses its "reported" badge.
    prisma.questionReport.deleteMany({ where: { questionId: id } }),
  ]);
  return NextResponse.json({ ok: true });
}
