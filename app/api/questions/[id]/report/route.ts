import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/questions/[id]/report { note? } — player reports a question.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const question = await prisma.question.findUnique({ where: { id }, select: { id: true } });
  if (!question) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  const existing = await prisma.questionReport.findFirst({
    where: { questionId: id, userId: session.sub },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "deja raportată" }, { status: 409 });

  await prisma.questionReport.create({
    data: { questionId: id, userId: session.sub, note: note || "raportată din recenzie" },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
