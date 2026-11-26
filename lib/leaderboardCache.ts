import type { PrismaClient } from "@prisma/client";
import { computeAllPrc, type PrcResult } from "@/lib/prc";

/**
 * Leaderboard snapshot cache.
 *
 * Why: `computeAllPrc` re-reads ALL completed answers + ALL questions on every
 * request (O(total history), no LIMIT). The dashboard polls `/api/leaderboard`
 * every 5s from every idle player, so that query used to run once per player per
 * 5s and was the app's #1 capacity bottleneck (measured ~10 req/s ceiling on the
 * 4-vCPU host — ~30 comfortable players).
 *
 * The leaderboard payload is IDENTICAL for every player, so one computation can
 * serve everyone. We cache the shared part (PRC map + display names + hidden set)
 * for TTL_MS and serve it to all callers. Per-requester bits (the `me` row, myPos)
 * are derived in the route from the cached maps, so they stay correct and free.
 *
 * Stale-while-revalidate: once a snapshot exists, a stale request returns it
 * immediately and kicks a background refresh, so no player ever waits on the
 * recompute. Only a truly cold process (first ever request) blocks.
 *
 * Module-level state persists for the lifetime of the Node server process
 * (single process in the standalone build). If the app is ever run with multiple
 * replicas, replace this with a Redis-backed cache keyed by a shared name.
 */

const TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS ?? 60_000);
/** Backstop: never serve a snapshot older than this, even under refresh failure. */
const MAX_STALE_MS = Math.max(TTL_MS * 10, 10 * 60_000);

export interface LeaderboardSnapshot {
  prcByUser: Map<string, PrcResult>;
  names: Map<string, string>;
  hidden: Set<string>;
  computedAt: number;
  /** number of full recomputes so far this process — observability only */
  computeCount: number;
}

let cached: LeaderboardSnapshot | null = null;
let inflight: Promise<LeaderboardSnapshot> | null = null;
let computeCount = 0;

async function compute(prisma: PrismaClient): Promise<LeaderboardSnapshot> {
  const started = Date.now();
  const prcByUser = await computeAllPrc(prisma);
  const userIds = [...prcByUser.keys()];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, hideScore: true },
      })
    : [];
  computeCount += 1;
  const snapshot: LeaderboardSnapshot = {
    prcByUser,
    names: new Map(users.map((u) => [u.id, u.displayName])),
    hidden: new Set(users.filter((u) => u.hideScore).map((u) => u.id)),
    computedAt: Date.now(),
    computeCount,
  };
  console.log(
    `[leaderboard] recomputed in ${Date.now() - started}ms (users=${userIds.length}, total computes=${computeCount})`
  );
  return snapshot;
}

function startRefresh(prisma: PrismaClient): Promise<LeaderboardSnapshot> {
  if (inflight) return inflight;
  inflight = compute(prisma).finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function getLeaderboardSnapshot(prisma: PrismaClient): Promise<LeaderboardSnapshot> {
  const ageMs = cached ? Date.now() - cached.computedAt : Infinity;

  if (cached && ageMs < TTL_MS) return cached; // fresh hit — the common case

  if (cached && ageMs < MAX_STALE_MS) {
    // Stale: serve immediately, refresh in the background (stale-while-revalidate).
    startRefresh(prisma).then(
      (s) => {
        cached = s;
      },
      (e) => console.error("[leaderboard] background refresh failed:", e)
    );
    return cached;
  }

  // Cold (no snapshot) or past the hard stale cap: we must wait for a fresh one.
  const snap = await startRefresh(prisma);
  cached = snap;
  return snap;
}

/** Test-only: drop the snapshot so the next call recomputes. */
export function _resetLeaderboardCache(): void {
  cached = null;
  inflight = null;
  computeCount = 0;
}
