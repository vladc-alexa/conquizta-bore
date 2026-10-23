import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { answerCarciuma, resolveCarciuma } from "@/lib/carciuma";

// POST /api/carciuma/[id]/answer { selectedOptionId }
// Graded server-side; elapsed time is measured from the server round start.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const game = await prisma.carciumaGame.findUnique({ where: { id }, select: { status: true } });
  if (!game) return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await prisma.carciumaPlayer.findFirst({
    where: { gameId: id, userId: session.sub },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "nu ești la masă" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const selectedOptionId = typeof body?.selectedOptionId === "string" ? body.selectedOptionId : null;
  if (!selectedOptionId) return NextResponse.json({ error: "răspuns lipsă" }, { status: 400 });

  const res = await answerCarciuma(id, me.id, selectedOptionId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

  await resolveCarciuma(id);
  return NextResponse.json({ ok: true });
}
