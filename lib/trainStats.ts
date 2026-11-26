import type { PrismaClient } from "@prisma/client";

// Clasament helpers.
//
// "Today" means today in Romania (the site's audience), not UTC: a run at 00:30
// in Bucharest must land in the new day even though the server clock is still
// on yesterday. Intl gives us the wall-clock parts for the zone; from those we
// can rebuild the UTC instant of local midnight.
//
// Scoring is one formula everywhere: a correct answer is worth 50 points plus up
// to 90 more depending on how fast it came (full bonus under 2 s, nothing left
// at 8 s). Training runs store their own total; carciuma and tower answers are
// scored from their stored response time, so every game feeds the same board.

const TZ = "Europe/Bucharest";

/** window in which the speed bonus decays to zero */
export const SPEED_WINDOW_MS = 8_000;
const BASE_POINTS = 50;
const SPEED_POINTS = 90;

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
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(startLocal - offset);
}

/** Points for one correct answer, given how long it took. */
export function trainPoints(elapsedMs: number): number {
  const speed = Math.max(0, Math.min(1, 1 - elapsedMs / SPEED_WINDOW_MS));
  return BASE_POINTS + Math.round(SPEED_POINTS * speed);
}

// The board is polled by every open leaderboard tab, and the aggregates scan
// three answer tables. Cache the ranked list for a few seconds; posting a run
// invalidates it so the results screen never shows a pre-run rank.
const CACHE_TTL_MS = 15_000;
let cache: { key: string; at: number; rows: TrainRow[] } | null = null;

export function invalidateStandings() {
  cache = null;
}

export type TrainRow = {
  id: string;
  name: string;
  score: number;
  correct: number;
  total: number;
  at: string;
};

type Aggregate = { id: string; score: number; correct: number; total: number; at: Date };

/** SQL expression for one correct answer's points on the same scale as trainPoints. */
const PTS = `(${BASE_POINTS} + round(${SPEED_POINTS} * greatest(0, least(1, 1 - coalesce(%TIME%, 8000)::float8 / ${SPEED_WINDOW_MS}))))`;

/**
 * Everything a player has scored: finished training runs, every carciuma answer
 * and every tower answer. Ranked by points; `since` limits to a window (today).
 */
export async function combinedStandings(
  prisma: PrismaClient,
  opts: { since: Date | null; limit?: number; userId?: string },
): Promise<{ rows: TrainRow[]; mine: TrainRow | null }> {
  const since = opts.since ?? new Date(0);
  const limit = opts.limit ?? 50;
  const rows = await rankAll(prisma, since);
  const mine = opts.userId ? (rows.find((r) => r.id === opts.userId) ?? null) : null;
  return { rows: rows.slice(0, limit), mine };
}

/** Full ranked list (every player with at least one answer) for a time window. */
async function rankAll(prisma: PrismaClient, since: Date): Promise<TrainRow[]> {
  const key = since.toISOString();
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const runs = await prisma.$queryRawUnsafe<Aggregate[]>(
    `SELECT "userId" AS id, sum("score")::int AS score, sum("correct")::int AS correct,
            sum("total")::int AS total, max("createdAt") AS at
       FROM "TrainRun" WHERE "createdAt" >= $1 GROUP BY 1`,
    since,
  );

  const carciuma = await prisma.$queryRawUnsafe<Aggregate[]>(
    `SELECT p."userId" AS id,
            sum(CASE WHEN a."isCorrect" THEN ${PTS.replace("%TIME%", 'a."elapsedMilliseconds"')} ELSE 0 END)::int AS score,
            count(*) FILTER (WHERE a."isCorrect")::int AS correct,
            count(*)::int AS total,
            max(a."createdAt") AS at
       FROM "CarciumaAnswer" a JOIN "CarciumaPlayer" p ON p.id = a."playerId"
      WHERE p."userId" IS NOT NULL AND a."createdAt" >= $1
      GROUP BY 1`,
    since,
  );

  const tower = await prisma.$queryRawUnsafe<Aggregate[]>(
    `SELECT p."userId" AS id,
            sum(CASE WHEN a."isCorrect" THEN ${PTS.replace("%TIME%", 'a."elapsedMilliseconds"')} ELSE 0 END)::int AS score,
            count(*) FILTER (WHERE a."isCorrect")::int AS correct,
            count(*)::int AS total,
            max(a."answeredAt") AS at
       FROM "TowerAnswer" a JOIN "TowerPlayer" p ON p.id = a."playerId"
      WHERE p."userId" IS NOT NULL AND a."answeredAt" >= $1
      GROUP BY 1`,
    since,
  );

  const merged = new Map<string, Aggregate>();
  for (const part of [runs, carciuma, tower]) {
    for (const row of part) {
      if (!row.id) continue;
      const prev = merged.get(row.id);
      if (!prev) {
        merged.set(row.id, { ...row, at: new Date(row.at) });
        continue;
      }
      merged.set(row.id, {
        id: row.id,
        score: prev.score + row.score,
        correct: prev.correct + row.correct,
        total: prev.total + row.total,
        at: new Date(Math.max(prev.at.getTime(), new Date(row.at).getTime())),
      });
    }
  }

  const ranked = [...merged.values()]
    .filter((r) => r.total > 0 || r.score > 0)
    .sort((a, b) => b.score - a.score || b.correct - a.correct);

  const ids = ranked.map((r) => r.id);
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, hideScore: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const rows: TrainRow[] = ranked
    .filter((r) => byId.has(r.id) && !byId.get(r.id)!.hideScore)
    .map((r) => ({
      id: r.id,
      name: byId.get(r.id)!.displayName,
      score: r.score,
      correct: r.correct,
      total: r.total,
      at: r.at.toISOString(),
    }));

  cache = { key: since.toISOString(), at: Date.now(), rows };
  return rows;
}
