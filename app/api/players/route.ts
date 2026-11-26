import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// GET /api/players -> everyone with an account, newest first, plus who is at the
// tables right now. Feeds the "jucători înregistrați" box on the dashboard.
const ONLINE_MS = 90_000;

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [users, tower, carciuma] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
      take: 200,
      select: { id: true, displayName: true, nameColor: true, lastSeenAt: true, createdAt: true },
    }),
    prisma.towerPlayer.findMany({
      where: { game: { status: "IN_PROGRESS" } },
      select: { userId: true },
    }),
    prisma.carciumaPlayer.findMany({
      where: { game: { status: "IN_PROGRESS" } },
      select: { userId: true },
    }),
  ]);

  const inTower = new Set(tower.map((p) => p.userId).filter(Boolean) as string[]);
  const inCarciuma = new Set(carciuma.map((p) => p.userId).filter(Boolean) as string[]);
  const now = Date.now();

  return NextResponse.json(
    {
      players: users.map((u) => ({
        id: u.id,
        name: u.displayName,
        color: u.nameColor,
        online: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_MS,
        where: inCarciuma.has(u.id) ? "carciuma" : inTower.has(u.id) ? "tower" : null,
        joined: u.createdAt,
      })),
      me: session.sub,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
