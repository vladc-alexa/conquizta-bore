import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// POST /api/auth/hide-score — toggle whether YOUR score shows on the public leaderboard.
// You always see your own score; this only affects what others see.
export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { hideScore: true } });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const updated = await prisma.user.update({
    where: { id: session.sub },
    data: { hideScore: !user.hideScore },
    select: { hideScore: true },
  });
  return NextResponse.json({ hideScore: updated.hideScore });
}
