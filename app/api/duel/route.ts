import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { buildDuelPlan, expireStaleLobbies, DUEL_BASE_ROUNDS } from "@/lib/duel";

// GET  /api/duel  -> { duelId, status } active duel for the caller (or null)
// POST /api/duel  -> { duelId } create a lobby (reuses an open one of mine)

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const duel = await prisma.duel.findFirst({
    where: {
      OR: [
        { hostId: session.sub, status: "WAITING" },
        { status: "IN_PROGRESS", OR: [{ hostId: session.sub }, { guestId: session.sub }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  return NextResponse.json({ duelId: duel?.id ?? null, status: duel?.status ?? null });
}

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await expireStaleLobbies(session.sub);

  const open = await prisma.duel.findFirst({
    where: { hostId: session.sub, status: "WAITING" },
    select: { id: true },
  });
  if (open) return NextResponse.json({ duelId: open.id, reused: true });

  const plan = await buildDuelPlan();
  if (plan.length < DUEL_BASE_ROUNDS) {
    return NextResponse.json({ error: "nu sunt destule întrebări pentru un meci" }, { status: 503 });
  }
  const duel = await prisma.duel.create({
    data: { hostId: session.sub, plan },
    select: { id: true },
  });
  return NextResponse.json({ duelId: duel.id }, { status: 201 });
}
