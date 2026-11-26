// Seating rules shared by "join from the lobby" and "accept an invitation".
// Both paths must behave identically: same capacity check, same seat pick, same
// "release your other seat first" courtesy.
import { prisma } from "@/lib/prisma";
import { TOWER_PLAYERS, releaseOtherTowers } from "@/lib/tower";
import { CARCIUMA_SEATS } from "@/lib/carciuma";

export type JoinResult =
  | { ok: true; seat: number; seated: number; full: boolean; alreadySeated?: boolean }
  | { ok: false; status: number; error: string };

export async function seatInTower(gameId: string, userId: string, name: string): Promise<JoinResult> {
  const game = await prisma.towerGame.findUnique({ where: { id: gameId }, include: { players: true } });
  if (!game) return { ok: false, status: 404, error: "not found" };
  if (game.status !== "WAITING") return { ok: false, status: 409, error: "turnul a pornit" };
  if (game.players.some((p) => p.userId === userId)) {
    return { ok: true, seat: game.players.find((p) => p.userId === userId)!.seat, seated: game.players.length, full: game.players.length >= TOWER_PLAYERS, alreadySeated: true };
  }
  if (game.players.length >= TOWER_PLAYERS) return { ok: false, status: 409, error: "turnul e plin" };

  await releaseOtherTowers(userId, gameId);
  const taken = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;

  try {
    await prisma.towerPlayer.create({ data: { gameId, userId, name, seat } });
  } catch {
    return { ok: false, status: 409, error: "locul a fost luat" };
  }
  const seated = await prisma.towerPlayer.count({ where: { gameId } });
  return { ok: true, seat, seated, full: seated >= TOWER_PLAYERS };
}

export async function seatInCarciuma(gameId: string, userId: string, name: string): Promise<JoinResult> {
  const game = await prisma.carciumaGame.findUnique({ where: { id: gameId }, include: { players: true } });
  if (!game) return { ok: false, status: 404, error: "not found" };
  if (game.status !== "WAITING") return { ok: false, status: 409, error: "masa a început" };
  if (game.players.some((p) => p.userId === userId)) {
    return { ok: true, seat: game.players.find((p) => p.userId === userId)!.seat, seated: game.players.length, full: game.players.length >= CARCIUMA_SEATS, alreadySeated: true };
  }
  if (game.players.length >= CARCIUMA_SEATS) return { ok: false, status: 409, error: "masa e plină" };

  // taking someone else's chair means giving up your own open table
  await prisma.carciumaGame.updateMany({
    where: { hostId: userId, status: "WAITING", NOT: { id: gameId } },
    data: { status: "ABANDONED" },
  });
  const taken = new Set(game.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;

  try {
    await prisma.carciumaPlayer.create({ data: { gameId, userId, name, seat } });
  } catch {
    return { ok: false, status: 409, error: "locul a fost luat" };
  }
  const seated = await prisma.carciumaPlayer.count({ where: { gameId } });
  return { ok: true, seat, seated, full: seated >= CARCIUMA_SEATS };
}
