import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySession, SESSION_COOKIE } from "@/lib/session";
import { TOWER_PLAYERS } from "@/lib/tower";
import { CARCIUMA_SEATS } from "@/lib/carciuma";

// Invitations to a tower / carciuma table.
//   GET  /api/invites        -> the pending invites addressed to me, still joinable
//   POST /api/invites        -> { kind, gameId, toId } invite a player to my table
// Invites are cheap and self-expiring: a stale one is filtered out on read, so
// the receiving client never has to clean up.

export const INVITE_TTL_MS = 2 * 60_000;

type Kind = "tower" | "carciuma";
const isKind = (v: unknown): v is Kind => v === "tower" || v === "carciuma";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.gameInvite.findMany({
    where: { toId: session.sub, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (!rows.length) return NextResponse.json({ invites: [] }, { headers: { "Cache-Control": "no-store" } });

  const towerIds = rows.filter((r) => r.kind === "tower").map((r) => r.gameId);
  const carciumaIds = rows.filter((r) => r.kind === "carciuma").map((r) => r.gameId);
  const [towers, carciuma] = await Promise.all([
    towerIds.length ? prisma.towerGame.findMany({ where: { id: { in: towerIds } }, select: { id: true, status: true, players: { select: { userId: true, name: true } } } }) : [],
    carciumaIds.length ? prisma.carciumaGame.findMany({ where: { id: { in: carciumaIds } }, select: { id: true, status: true, players: { select: { userId: true, name: true } } } }) : [],
  ]);
  const rooms = new Map<string, { status: string; players: { userId: string | null; name: string }[]; seats: number }>();
  for (const t of towers) rooms.set(`tower:${t.id}`, { status: t.status, players: t.players, seats: TOWER_PLAYERS });
  for (const c of carciuma) rooms.set(`carciuma:${c.id}`, { status: c.status, players: c.players, seats: CARCIUMA_SEATS });

  // drop invites whose room is gone, already started, full, or already has me
  const invites = rows
    .map((r) => {
      const room = rooms.get(`${r.kind}:${r.gameId}`);
      if (!room || room.status !== "WAITING") return null;
      if (room.players.some((p) => p.userId === session.sub)) return null;
      if (room.players.length >= room.seats) return null;
      return {
        id: r.id,
        kind: r.kind as Kind,
        gameId: r.gameId,
        fromName: r.fromName,
        seats: room.seats,
        seated: room.players.length,
        players: room.players.map((p) => p.name),
        expiresAt: r.expiresAt,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ invites }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const gameId = typeof body?.gameId === "string" ? body.gameId : "";
  const toId = typeof body?.toId === "string" ? body.toId : "";
  if (!isKind(kind) || !gameId || !toId) return NextResponse.json({ error: "cerere invalidă" }, { status: 400 });
  if (toId === session.sub) return NextResponse.json({ error: "nu te poți invita pe tine" }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { displayName: true } });
  const target = await prisma.user.findUnique({ where: { id: toId }, select: { id: true, displayName: true } });
  if (!me || !target) return NextResponse.json({ error: "jucător inexistent" }, { status: 404 });

  // the room must be mine, open, and have a free chair
  const room =
    kind === "tower"
      ? await prisma.towerGame.findUnique({ where: { id: gameId }, select: { status: true, players: { select: { userId: true } } } })
      : await prisma.carciumaGame.findUnique({ where: { id: gameId }, select: { status: true, players: { select: { userId: true } } } });
  if (!room) return NextResponse.json({ error: "masa nu mai există" }, { status: 404 });
  if (room.status !== "WAITING") return NextResponse.json({ error: "masa a pornit deja" }, { status: 409 });
  if (!room.players.some((p) => p.userId === session.sub)) {
    return NextResponse.json({ error: "nu ești la masa asta" }, { status: 403 });
  }
  if (room.players.some((p) => p.userId === toId)) {
    return NextResponse.json({ error: `${target.displayName} e deja la masă` }, { status: 409 });
  }
  const seats = kind === "tower" ? TOWER_PLAYERS : CARCIUMA_SEATS;
  if (room.players.length >= seats) return NextResponse.json({ error: "masa e plină" }, { status: 409 });

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  // one live invite per (room, player): re-inviting refreshes the old one
  const existing = await prisma.gameInvite.findFirst({
    where: { gameId, toId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const invite = existing
    ? await prisma.gameInvite.update({ where: { id: existing.id }, data: { fromId: session.sub, fromName: me.displayName, expiresAt } })
    : await prisma.gameInvite.create({
        data: { kind, gameId, fromId: session.sub, fromName: me.displayName, toId, expiresAt },
      });

  return NextResponse.json({ ok: true, invite: { id: invite.id, toName: target.displayName, kind, gameId, expiresAt } }, { status: 201 });
}
