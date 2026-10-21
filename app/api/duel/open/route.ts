import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { expireStaleLobbies, DUEL_WAITING_TTL_MS } from "@/lib/duel";

// GET /api/duel/open -> lobbies anyone can walk into from the dashboard.
// Replaces the old "copy this link and send it to a friend" dance: a host
// creates a match, it shows up here, and any other player hits Join.
export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = session.sub;
  await expireStaleLobbies(me).catch(() => {});

  const cutoff = new Date(Date.now() - DUEL_WAITING_TTL_MS);
  const lobbies = await prisma.duel.findMany({
    where: { status: "WAITING", guestId: null, createdAt: { gt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, hostId: true, createdAt: true },
  });

  // my own parked match (waiting or running) — the dashboard shows "Continuă"
  const mine = await prisma.duel.findFirst({
    where: {
      OR: [
        { hostId: me, status: "WAITING" },
        { status: "IN_PROGRESS", OR: [{ hostId: me }, { guestId: me }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  const hostIds = [...new Set(lobbies.map((l) => l.hostId))];
  const hosts = hostIds.length
    ? await prisma.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, displayName: true } })
    : [];
  const nameById = new Map(hosts.map((h) => [h.id, h.displayName]));

  return NextResponse.json({
    games: lobbies.map((l) => ({
      id: l.id,
      hostName: nameById.get(l.hostId) ?? "?",
      createdAt: l.createdAt,
      mine: l.hostId === me,
    })),
    mine: mine ? { id: mine.id, status: mine.status } : null,
  });
}
