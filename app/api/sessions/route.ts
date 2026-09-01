import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/sessions { mode } -> { sessionId }
// Starts an official quiz session (training counts toward PRC).
export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const mode = body?.mode === "rapide" || body?.mode === "grila" ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "mode required" }, { status: 400 });

  const s = await prisma.quizSession.create({
    data: { userId: session.sub, status: "IN_PROGRESS", questionCount: 0 },
    select: { id: true },
  });
  return NextResponse.json({ sessionId: s.id }, { status: 201 });
}
