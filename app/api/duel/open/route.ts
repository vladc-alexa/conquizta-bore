import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { expireStaleLobbies, DUEL_WAITING_TTL_MS } from "@/lib/duel";

// GET /api/duel/open -> lobbies anyone can walk into from the dashboard, plus
// *my* table (waiting with or without an opponent, or already running) so the
// lobby card can seat both players and offer the Start button.
export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const me = session.sub;
  await expireStaleLobbies(me).catch(() => {});

  const cutoff = new Date(Date.now() - DUEL_WAITING_TTL_MS);
  // every open seat — including my own lobby, so the list doubles as the
  // "this is yours" marker the dashboard uses
  const lobbies = await prisma.duel.findMany({
    where: { status: "WAITING", guestId: null, createdAt: { gt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, hostId: true, createdAt: true },
  });

  // my table: a lobby I'm sitting in wins over an older running match
  const mineSelect = { id: true, status: true, hostId: true, guestId: true } as const;
  const mine =
    (await prisma.duel.findFirst({
      where: {
        status: "WAITING",
        OR: [{ hostId: me }, { guestId: me }],
      },
      orderBy: { createdAt: "desc" },
      select: mineSelect,
    })) ??
    (await prisma.duel.findFirst({
      where: {
        status: "IN_PROGRESS",
        OR: [{ hostId: me }, { guestId: me }],
      },
      orderBy: { createdAt: "desc" },
      select: mineSelect,
    }));

  const hostIds = [...new Set(lobbies.map((l) => l.hostId))];
  const hosts = hostIds.length
    ? await prisma.user.findMany({ where: { id: { in: hostIds } }, select: { id: true, displayName: true } })
    : [];
  const nameById = new Map(hosts.map((h) => [h.id, h.displayName]));

  let mineOut = null;
  if (mine) {
    const ids = [mine.hostId, mine.guestId].filter((v): v is string => !!v);
    const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    const byId = new Map(people.map((p) => [p.id, p.displayName]));
    mineOut = {
      id: mine.id,
      status: mine.status,
      role: mine.hostId === me ? ("host" as const) : ("guest" as const),
      hostName: byId.get(mine.hostId) ?? "?",
      guestName: mine.guestId ? byId.get(mine.guestId) ?? "?" : null,
    };
  }

  return NextResponse.json({
    games: lobbies.map((l) => ({
      id: l.id,
      hostName: nameById.get(l.hostId) ?? "?",
      createdAt: l.createdAt,
      mine: l.hostId === me,
    })),
    mine: mineOut,
  });
}
