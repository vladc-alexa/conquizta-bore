import type { PrismaClient } from "@prisma/client";

// Training-blitz standings helpers.
//
// "Today" means today in Romania (the site's audience), not UTC: a run at 00:30
// in Bucharest must land in the new day even though the server clock is still
// on yesterday. Intl gives us the wall-clock parts for the zone; from those we
// can rebuild the UTC instant of local midnight.

const TZ = "Europe/Bucharest";

function tzOffsetMs(date: Date, tz = TZ): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** UTC instant of local (Romanian) midnight for the day containing `now`. */
export function startOfLocalDay(now = new Date()): Date {
  const offset = tzOffsetMs(now);
  const local = new Date(now.getTime() + offset);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - offset);
}

// Scoring: a correct answer is worth a base 50 points plus up to 90 more for
// speed — the whole bonus is gone after 8 seconds. Two players with the same
// number of correct answers are then separated by how fast they were, which is
// what the blitz is actually about (and it rewards a fast run over a slow
// question-hog). Wrong answers and skips score nothing.
export const TRAIN_BASE_POINTS = 50;
export const TRAIN_SPEED_POINTS = 90;
export const TRAIN_SPEED_WINDOW_MS = 8_000;

export function trainPoints(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return TRAIN_BASE_POINTS;
  const speed = Math.max(0, Math.min(1, 1 - elapsedMs / TRAIN_SPEED_WINDOW_MS));
  return TRAIN_BASE_POINTS + Math.round(TRAIN_SPEED_POINTS * speed);
}

export type TrainRow = {
  id: string;
  name: string;
  score: number;
  correct: number;
  total: number;
  at: string;
};

/**
 * Best run per player since `since`, ranked by score. Someone who trains five
 * times keeps their best run — the tab answers "who is best today", not "who
 * played most". Ties go to whoever posted the score first.
 */
export async function trainStandings(
  prisma: PrismaClient,
  { since, limit = 20, userId }: { since: Date | null; limit?: number; userId?: string },
): Promise<{ rows: TrainRow[]; mine: (TrainRow & { rank: number }) | null }> {
  const runs = await prisma.trainRun.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    orderBy: [{ score: "desc" }, { correct: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      score: true,
      correct: true,
      total: true,
      createdAt: true,
      user: { select: { id: true, displayName: true, hideScore: true } },
    },
    take: 2000,
  });

  const best = new Map<string, TrainRow>();
  for (const r of runs) {
    if (r.user.hideScore) continue;
    if (best.has(r.user.id)) continue; // already the best run for this player
    best.set(r.user.id, {
      id: r.id,
      name: r.user.displayName,
      score: r.score,
      correct: r.correct,
      total: r.total,
      at: r.createdAt.toISOString(),
    });
  }

  const ranked = [...best.values()];
  const rows = ranked.slice(0, limit);
  const myRow = userId ? ranked.findIndex((r) => best.get(userId)?.id === r.id) : -1;
  const mine = userId && myRow >= 0 ? { ...ranked[myRow], rank: myRow + 1 } : null;
  return { rows, mine };
}
