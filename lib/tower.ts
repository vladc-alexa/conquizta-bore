// TURNUL — the 8-player ladder siege.
//
// Rules (server-authoritative, resolved lazily on every state poll):
//   * Open-ended: one question per round, 8 seats (bots fill empty seats), and
//     rounds keep coming until somebody reaches the summit (TOWER_HEIGHT rungs).
//   * Every answer earns points: correct = up to 100, faster = more; wrong = 0.
//   * Your points for the round become rungs climbed: the round's best climber
//     always gains the full RUNGS_PER_ROUND, everyone else scales less, and a
//     wrong answer leaves you standing still.
//   * From round 2 on, the player with the lowest total falls off the ladder at
//     the end of EVERY round (never the last one standing).
//   * The first climber to touch the summit wins and the game closes.
import { prisma } from "@/lib/prisma";
import { fetchGrilaPool, type PlanEntry } from "@/lib/duel";

export const TOWER_PLAYERS = 8;
/** Questions frozen into the plan at start — a ceiling, not a target: the game
 *  ends on the summit, long before this in practice (≈11 rounds at 4 rungs). */
export const TOWER_PLAN_SIZE = 40;
/** 0-based round index from which the lowest climber falls — every round. */
export const TOWER_CUT_FROM_ROUND = 1; // after round 2
export const TOWER_ROUND_MS = 15_000;
export const TOWER_ROUND_GRACE_MS = 1_500;
export const RUNGS_PER_ROUND = 4;
/** Visual height of the tower in rungs — the winner climbs all of them. */
export const TOWER_HEIGHT = 36;
export const TOWER_WAITING_TTL_MS = 10 * 60_000;

const BOT_NAMES = [
  "Bogdan", "Ioana", "Mihai", "Roxana", "Andrei", "Elena", "Cristi", "Dana",
  "Vlad", "Alina", "Radu", "Sorina", "Tudor", "Miruna",
];

/** Tower rounds are always grilă, so narrow the duel plan union once here. */
export type TowerEntry = Extract<PlanEntry, { mode: "grila" }>;

export function towerScore(isCorrect: boolean, elapsedMs: number): number {
  if (!isCorrect) return 0;
  const speed = Math.max(0, Math.min(1, 1 - elapsedMs / TOWER_ROUND_MS));
  return Math.round(40 + 60 * speed); // 40..100
}

export function rungsFor(score: number): number {
  return Math.round((RUNGS_PER_ROUND * score) / 100);
}

export async function buildTowerPlan(): Promise<TowerEntry[]> {
  const pool = (await fetchGrilaPool(TOWER_PLAN_SIZE)) as TowerEntry[];
  return pool.slice(0, TOWER_PLAN_SIZE);
}

// ---- bots ---------------------------------------------------------------
// Bots are deliberately mediocre: they miss most questions and answer slowly,
// so a human who half-knows the quiz out-climbs them.
function botSkill(): number {
  return 0.15 + Math.random() * 0.3; // 0.15 .. 0.45
}

export function botAnswer(): { isCorrect: boolean; score: number; elapsedMs: number } {
  const correct = Math.random() < botSkill();
  const elapsedMs = 5_000 + Math.floor(Math.random() * (TOWER_ROUND_MS - 5_500));
  const score = correct ? towerScore(true, elapsedMs) : 0;
  return { isCorrect: correct, score, elapsedMs };
}

/** Seat bots into the empty chairs (host pressed start). */
export async function fillWithBots(gameId: string): Promise<void> {
  const game = await prisma.towerGame.findUnique({ where: { id: gameId }, include: { players: true } });
  if (!game) return;
  const taken = new Set(game.players.map((p) => p.seat));
  const used = new Set(game.players.map((p) => p.name));
  const names = BOT_NAMES.filter((n) => !used.has(n));
  let ni = 0;
  const rows: { gameId: string; seat: number; name: string; isBot: boolean }[] = [];
  for (let seat = 0; seat < TOWER_PLAYERS; seat++) {
    if (taken.has(seat)) continue;
    rows.push({ gameId, seat, name: names[ni++] ?? `Bot ${seat + 1}`, isBot: true });
  }
  if (rows.length) await prisma.towerPlayer.createMany({ data: rows, skipDuplicates: true });
}

/** Start a WAITING game: freeze the question plan, seat bots, open round 1. */
export async function startTower(gameId: string): Promise<void> {
  const game = await prisma.towerGame.findUnique({ where: { id: gameId }, include: { players: true } });
  if (!game || game.status !== "WAITING") return;
  await fillWithBots(gameId);
  const plan = await buildTowerPlan();
  if (plan.length < 3) {
    throw new Error("nu sunt destule întrebări pentru un turn");
  }
  await prisma.towerGame.updateMany({
    where: { id: gameId, status: "WAITING" },
    data: { status: "IN_PROGRESS", plan, currentRound: 0, roundStartedAt: new Date(), startedAt: new Date() },
  });
}

// ---- resolution ---------------------------------------------------------
/** Idempotent per-player totals: recomputed from the answer table, so a retry
 *  or a racing resolver can never double-count a round. */
async function recomputeStandings(gameId: string): Promise<void> {
  const players = await prisma.towerPlayer.findMany({ where: { gameId } });
  const answers = await prisma.towerAnswer.findMany({ where: { gameId } });
  for (const p of players) {
    const mine = answers.filter((a) => a.playerId === p.id);
    const score = mine.reduce((s, a) => s + a.score, 0);
    const rungs = mine.reduce((s, a) => s + a.rungs, 0);
    if (score !== p.score || rungs !== p.rungs) {
      await prisma.towerPlayer.update({ where: { id: p.id }, data: { score, rungs } });
    }
  }
}

export async function resolveTower(gameId: string): Promise<void> {
  for (let guard = 0; guard < 40; guard++) {
    const game = await prisma.towerGame.findUnique({ where: { id: gameId }, include: { players: true } });
    if (!game || game.status !== "IN_PROGRESS") return;
    const plan = game.plan as TowerEntry[];
    const r = game.currentRound;
    if (r >= plan.length) return;

    const entry = plan[r];
    const live = game.players.filter((p) => !p.eliminated);
    const answers = await prisma.towerAnswer.findMany({ where: { gameId, round: r } });
    const answeredIds = new Set(answers.map((a) => a.playerId));
    const started = game.roundStartedAt?.getTime() ?? Date.now();
    const deadline = started + TOWER_ROUND_MS + TOWER_ROUND_GRACE_MS;

    // The round stays open until every HUMAN still on the tower has answered,
    // or the clock runs out. Bots are settled below, so they must not hold the
    // round open — otherwise a solo player would wait the full 15s every round.
    const humanLive = live.filter((p) => !p.isBot);
    const humanPending = humanLive.filter((p) => !answeredIds.has(p.id));
    if (humanPending.length > 0 && Date.now() < deadline) {
      return;
    }

    // bots always answer by the time the round closes
    const botRows = game.players
      .filter((p) => p.isBot && !p.eliminated && !answeredIds.has(p.id))
      .map((p) => {
        const a = botAnswer();
        return {
          gameId,
          playerId: p.id,
          round: r,
          questionId: entry.questionId,
          selectedOptionId: a.isCorrect ? entry.correctOptionId : null,
          isCorrect: a.isCorrect,
          score: a.score,
          rungs: rungsFor(a.score),
          elapsedMilliseconds: a.elapsedMs,
        };
      });

    // we are the resolver for this round: claim it before writing anything
    const after = r + 1;
    const outOfQuestions = after >= plan.length;
    const res = await prisma.towerGame.updateMany({
      where: { id: gameId, status: "IN_PROGRESS", currentRound: r },
      data: outOfQuestions
        ? { currentRound: after }
        : { currentRound: after, roundStartedAt: new Date() },
    });
    if (res.count === 0) return; // another poll resolved this round first

    if (botRows.length) {
      await prisma.towerAnswer.createMany({ data: botRows, skipDuplicates: true });
    }
    await recomputeStandings(gameId);

    const standing = await prisma.towerPlayer.findMany({ where: { gameId, eliminated: false } });
    const ranked = [...standing].sort(
      (a, b) => b.rungs - a.rungs || b.score - a.score || a.seat - b.seat
    );

    // ---- the summit: first climber to touch the top wins, whenever that is ----
    const champion = ranked.find((p) => p.rungs >= TOWER_HEIGHT) ?? null;
    if (champion || outOfQuestions) {
      const winner = champion ?? ranked[0] ?? null;
      if (champion) {
        await prisma.towerPlayer.update({
          where: { id: champion.id },
          data: { rungs: TOWER_HEIGHT }, // exactly on the top rung
        });
      }
      await prisma.towerGame.updateMany({
        where: { id: gameId, status: "IN_PROGRESS" },
        // winnerId holds the winning SEAT (TowerPlayer.id) — bots have no user
        data: { status: "COMPLETED", completedAt: new Date(), winnerId: winner?.id ?? null },
      });
      return;
    }

    // ---- the cut: from round 2 on, the lowest total falls at the end of every
    // round. The last climber standing is never pushed off — they keep climbing. ----
    if (r >= TOWER_CUT_FROM_ROUND && ranked.length > 1) {
      const lowest = [...ranked].reverse()[0];
      if (lowest) {
        await prisma.towerPlayer.update({
          where: { id: lowest.id },
          data: { eliminated: true, fellRound: r + 1 },
        });
      }
    }
  }
}

// ---- public state -------------------------------------------------------
export type TowerStatePlayer = {
  id: string;
  name: string;
  seat: number;
  score: number;
  rungs: number;
  eliminated: boolean;
  /** round number (1-based) after which this climber fell */
  fellRound: number | null;
  isBot: boolean;
  mine: boolean;
};

export type TowerState = {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  phase: "lobby" | "climb" | "final" | "done";
  round: number;
  totalRounds: number;
  cutRound: number;
  height: number;
  players: TowerStatePlayer[];
  myPlayerId: string | null;
  isHost: boolean;
  canStart: boolean;
  question: { id: string; prompt: string; options: { id: string; text: string }[] } | null;
  startedAt: number | null;
  windowMs: number;
  myAnswered: boolean;
  answeredCount: number;
  liveCount: number;
  eliminatedId: string | null;
  winnerId: string | null;
  history: {
    round: number;
    prompt: string;
    reveal: string;
    bestPlayerId: string | null;
    gains: { playerId: string; score: number; rungs: number }[];
  }[];
};

export async function buildTowerState(gameId: string, viewerId: string): Promise<TowerState | null> {
  const game = await prisma.towerGame.findUnique({ where: { id: gameId }, include: { players: true } });
  if (!game) return null;
  const plan = game.plan as TowerEntry[];
  const answers = await prisma.towerAnswer.findMany({ where: { gameId }, orderBy: { round: "asc" } });
  const players = [...game.players].sort((a, b) => a.seat - b.seat);
  const mine = players.find((p) => p.userId === viewerId) ?? null;
  const live = players.filter((p) => !p.eliminated);
  const done = game.status === "COMPLETED";
  const roundOpen = game.status === "IN_PROGRESS";
  const entry = roundOpen && game.currentRound < plan.length ? plan[game.currentRound] : null;

  // after the match, read the live question text back (same reason as the duel:
  // editors fix bad questions from the review screen)
  const liveText = new Map(
    (
      await prisma.question.findMany({
        where: { id: { in: plan.slice(0, Math.max(1, game.currentRound)).map((e) => e.questionId) } },
        select: { id: true, prompt: true, options: { select: { text: true, isCorrect: true }, orderBy: { position: "asc" } } },
      })
    ).map((q) => [q.id, q])
  );

  const history = plan.slice(0, game.currentRound).map((e, i) => {
    const rows = answers.filter((a) => a.round === i);
    const liveQ = liveText.get(e.questionId);
    const reveal = liveQ
      ? liveQ.options.find((o) => o.isCorrect)?.text ?? ""
      : e.options.find((o) => o.id === e.correctOptionId)?.text ?? "";
    const best = [...rows].sort((a, b) => b.score - a.score || a.elapsedMilliseconds - b.elapsedMilliseconds)[0];
    return {
      round: i,
      prompt: liveQ?.prompt ?? e.prompt,
      reveal,
      bestPlayerId: best ? best.playerId : null,
      gains: rows.map((a) => ({ playerId: a.playerId, score: a.score, rungs: a.rungs })),
    };
  });

  // "final" = somebody is one round away from the summit (they can win this round)
  const phase: TowerState["phase"] = !done && game.status === "WAITING"
    ? "lobby"
    : done
      ? "done"
      : live.some((p) => p.rungs >= TOWER_HEIGHT - RUNGS_PER_ROUND)
        ? "final"
        : "climb";

  return {
    id: game.id,
    status: game.status,
    phase,
    round: game.currentRound,
    // open-ended: totalRounds is only the plan ceiling, the game ends on the summit
    totalRounds: plan.length,
    cutRound: TOWER_CUT_FROM_ROUND + 1,
    height: TOWER_HEIGHT,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      score: p.score,
      rungs: p.rungs,
      eliminated: p.eliminated,
      fellRound: p.fellRound ?? null,
      isBot: p.isBot,
      mine: p.userId === viewerId,
    })),
    myPlayerId: mine?.id ?? null,
    isHost: game.hostId === viewerId,
    canStart: game.status === "WAITING" && game.hostId === viewerId,
    question: entry
      ? {
          id: entry.questionId,
          prompt: liveText.get(entry.questionId)?.prompt ?? entry.prompt,
          options: entry.options,
        }
      : null,
    startedAt: game.roundStartedAt?.getTime() ?? null,
    windowMs: TOWER_ROUND_MS,
    myAnswered: !!mine && answers.some((a) => a.round === game.currentRound && a.playerId === mine.id),
    answeredCount: answers.filter((a) => a.round === game.currentRound).length,
    liveCount: live.length,
    eliminatedId: players.find((p) => p.eliminated)?.id ?? null,
    winnerId: game.winnerId ?? null,
    history,
  };
}

/** Expire my own stale lobbies so a forgotten open tower never blocks a new one. */
export async function expireStaleTowers(userId: string): Promise<void> {
  await prisma.towerGame.updateMany({
    where: {
      hostId: userId,
      status: "WAITING",
      createdAt: { lt: new Date(Date.now() - TOWER_WAITING_TTL_MS) },
    },
    data: { status: "ABANDONED", completedAt: new Date() },
  });
}
