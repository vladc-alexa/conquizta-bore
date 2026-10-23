// La Carciuma — the drinking-table mini game.
//
// Five patrons around one wooden table. Every round one grilă question; when the
// round closes the WORST answer has to drink: lowest score first, slowest on a
// tie, and silence counts as the slowest answer of all. Three drinks and that
// patron is under the table. The last one still sitting wins.
//
// Like the tower, rounds are settled lazily by whoever asks for the state, so no
// background worker is needed and a closed tab never freezes the table.
import { prisma } from "@/lib/prisma";
import { fetchGrilaPool, type PlanEntry } from "@/lib/duel";

export const CARCIUMA_SEATS = 5;
export const CARCIUMA_PLAN_SIZE = 24;
// timing is env-overridable so the E2E harness can run a full sitting in seconds
function envMs(key: string, fallback: number) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
export const CARCIUMA_ROUND_MS = envMs("CARCIUMA_ROUND_MS", 15_000); // answer window
export const CARCIUMA_ROUND_GRACE_MS = envMs("CARCIUMA_ROUND_GRACE_MS", 1_500); // let an in-flight answer land
export const CARCIUMA_INTERMISSION_MS = envMs("CARCIUMA_INTERMISSION_MS", 6_000); // breather: "X bea!"
export const CARCIUMA_MAX_DRINKS = 3; // then you pass out
export const CARCIUMA_WAITING_TTL_MS = 10 * 60_000; // forgotten lobbies die
export const CARCIUMA_BOT_NAMES = ["Bogdan", "Mirela", "Nea Costel", "Roxana", "Doru", "Lenuța"];
/** Bots get roughly this share of questions right — enough to make the table lively. */
const BOT_ACCURACY = 0.42;

export type CarciumaEntry = Extract<PlanEntry, { mode: "grila" }>;

export async function buildCarciumaPlan(): Promise<CarciumaEntry[]> {
  const pool = await fetchGrilaPool(CARCIUMA_PLAN_SIZE + 8);
  return pool.filter((e): e is CarciumaEntry => e.mode === "grila").slice(0, CARCIUMA_PLAN_SIZE);
}

/** Correct answers are worth more the faster they arrive (40…100). */
export function answerScore(correct: boolean, elapsedMs: number): number {
  if (!correct) return 0;
  const ratio = Math.min(1, Math.max(0, elapsedMs / CARCIUMA_ROUND_MS));
  return Math.max(40, Math.round(100 - ratio * 60));
}

function botElapsed(): number {
  return 2_200 + Math.floor(Math.random() * 9_500);
}

/** Fill every empty seat with a patron who can actually play. */
export async function fillCarciumaBots(gameId: string): Promise<void> {
  const players = await prisma.carciumaPlayer.findMany({ where: { gameId }, select: { seat: true } });
  const taken = new Set(players.map((p) => p.seat));
  const names = [...CARCIUMA_BOT_NAMES].sort(() => Math.random() - 0.5);
  let n = 0;
  for (let seat = 0; seat < CARCIUMA_SEATS; seat += 1) {
    if (taken.has(seat)) continue;
    await prisma.carciumaPlayer.create({
      data: { gameId, name: names[n % names.length], seat, isBot: true },
    });
    n += 1;
  }
}

export async function startCarciuma(gameId: string): Promise<void> {
  const plan = await buildCarciumaPlan();
  if (!plan.length) throw new Error("nu există întrebări publicate");
  await fillCarciumaBots(gameId);
  await prisma.carciumaGame.update({
    where: { id: gameId },
    data: {
      status: "IN_PROGRESS",
      plan: plan as unknown as object,
      currentRound: 0,
      roundStartedAt: new Date(),
      startedAt: new Date(),
    },
  });
}

export async function answerCarciuma(
  gameId: string,
  playerId: string,
  optionId: string
): Promise<{ ok: boolean; error?: string }> {
  const game = await prisma.carciumaGame.findUnique({ where: { id: gameId } });
  if (!game || game.status !== "IN_PROGRESS") return { ok: false, error: "masa nu e deschisă" };
  const player = await prisma.carciumaPlayer.findUnique({ where: { id: playerId } });
  if (!player || player.passedOut) return { ok: false, error: "ai căzut sub masă" };
  const plan = game.plan as unknown as CarciumaEntry[];
  const entry = plan[game.currentRound];
  if (!entry) return { ok: false, error: "gata întrebările" };
  const opensAt = game.roundStartedAt?.getTime() ?? 0;
  const now = Date.now();
  if (now < opensAt) return { ok: false, error: "runda nu a început" };
  const elapsed = now - opensAt;
  if (elapsed > CARCIUMA_ROUND_MS + CARCIUMA_ROUND_GRACE_MS) return { ok: false, error: "timpul a expirat" };
  const isCorrect = optionId === entry.correctOptionId;
  const score = answerScore(isCorrect, elapsed);
  try {
    await prisma.carciumaAnswer.create({
      data: {
        gameId,
        playerId,
        round: game.currentRound,
        questionId: entry.questionId,
        selectedOptionId: optionId,
        isCorrect,
        score,
        elapsedMilliseconds: elapsed,
      },
    });
    await prisma.carciumaPlayer.update({ where: { id: playerId }, data: { score: { increment: score } } });
  } catch {
    return { ok: false, error: "ai răspuns deja" };
  }
  return { ok: true };
}

/**
 * Settle every round whose window has closed. Safe to call from anywhere: each
 * step is idempotent (unique answers per player+round, drinks applied once).
 */
export async function resolveCarciuma(gameId: string): Promise<void> {
  for (let guard = 0; guard < 30; guard += 1) {
    const game = await prisma.carciumaGame.findUnique({ where: { id: gameId } });
    if (!game || game.status !== "IN_PROGRESS") return;
    const plan = game.plan as unknown as CarciumaEntry[];
    const entry = plan[game.currentRound];
    const opensAt = game.roundStartedAt?.getTime() ?? 0;
    const closesAt = opensAt + CARCIUMA_ROUND_MS + CARCIUMA_ROUND_GRACE_MS;
    const now = Date.now();
    if (!entry) {
      await finishCarciuma(game.id, null);
      return;
    }
    if (now < closesAt) return; // round still open, or we are in the breather

    const round = game.currentRound;
    const players = await prisma.carciumaPlayer.findMany({ where: { gameId }, orderBy: { seat: "asc" } });
    const existing = await prisma.carciumaAnswer.findMany({ where: { gameId, round } });
    const answered = new Set(existing.map((a) => a.playerId));

    // bots answer at close time (they never hold the round hostage)
    for (const p of players) {
      if (!p.isBot || p.passedOut || answered.has(p.id)) continue;
      const isCorrect = Math.random() < BOT_ACCURACY;
      const elapsed = botElapsed();
      const opts = entry.options;
      const pick = isCorrect
        ? entry.correctOptionId
        : opts.filter((o) => o.id !== entry.correctOptionId)[Math.floor(Math.random() * 3)]?.id ?? opts[0].id;
      await prisma.carciumaAnswer.create({
        data: {
          gameId,
          playerId: p.id,
          round,
          questionId: entry.questionId,
          selectedOptionId: pick,
          isCorrect,
          score: answerScore(isCorrect, elapsed),
          elapsedMilliseconds: elapsed,
        },
      });
      await prisma.carciumaPlayer.update({
        where: { id: p.id },
        data: { score: { increment: answerScore(isCorrect, elapsed) } },
      });
    }

    // anyone who stayed silent gets an empty row: silence is the slowest answer
    for (const p of players) {
      if (p.passedOut || answered.has(p.id)) continue;
      const already = await prisma.carciumaAnswer.findUnique({
        where: { gameId_round_playerId: { gameId, round, playerId: p.id } },
      });
      if (already) continue;
      await prisma.carciumaAnswer.create({
        data: {
          gameId,
          playerId: p.id,
          round,
          questionId: entry.questionId,
          isCorrect: false,
          score: 0,
          elapsedMilliseconds: CARCIUMA_ROUND_MS + CARCIUMA_ROUND_GRACE_MS,
        },
      });
    }

    const rows = await prisma.carciumaAnswer.findMany({ where: { gameId, round } });
    const awake = players.filter((p) => !p.passedOut);
    const rowFor = (id: string) => rows.find((r) => r.playerId === id);
    // worst first: lowest score, then slowest, then lowest seat (stable)
    const ranking = [...awake].sort((a, b) => {
      const ra = rowFor(a.id);
      const rb = rowFor(b.id);
      const sa = ra?.score ?? 0;
      const sb = rb?.score ?? 0;
      if (sa !== sb) return sa - sb;
      const ea = ra?.elapsedMilliseconds ?? CARCIUMA_ROUND_MS;
      const eb = rb?.elapsedMilliseconds ?? CARCIUMA_ROUND_MS;
      if (ea !== eb) return eb - ea;
      return a.seat - b.seat;
    });
    const drinker = ranking[0] ?? null;
    if (drinker) {
      const row = rowFor(drinker.id);
      if (row) await prisma.carciumaAnswer.update({ where: { id: row.id }, data: { drank: true } });
      const drinks = Math.min(CARCIUMA_MAX_DRINKS, drinker.drinks + 1);
      await prisma.carciumaPlayer.update({
        where: { id: drinker.id },
        data: {
          drinks,
          passedOut: drinks >= CARCIUMA_MAX_DRINKS,
          outRound: drinks >= CARCIUMA_MAX_DRINKS ? round : null,
        },
      });
    }

    const after = await prisma.carciumaPlayer.findMany({ where: { gameId }, orderBy: { seat: "asc" } });
    const stillAwake = after.filter((p) => !p.passedOut);
    const nextRound = round + 1;
    if (stillAwake.length <= 1 || nextRound >= plan.length) {
      const winner = stillAwake.length
        ? stillAwake[0]
        : [...after].sort((a, b) => b.score - a.score)[0] ?? null;
      await finishCarciuma(gameId, winner?.seat ?? null);
      return;
    }
    await prisma.carciumaGame.update({
      where: { id: gameId },
      data: {
        currentRound: nextRound,
        roundStartedAt: new Date(Date.now() + CARCIUMA_INTERMISSION_MS),
      },
    });
  }
}

async function finishCarciuma(gameId: string, winnerSeat: number | null): Promise<void> {
  await prisma.carciumaGame.update({
    where: { id: gameId },
    data: { status: "COMPLETED", completedAt: new Date(), winnerSeat },
  });
}

export type CarciumaState = {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  phase: "lobby" | "table" | "done";
  round: number;
  totalRounds: number;
  maxDrinks: number;
  seats: number;
  players: {
    id: string;
    name: string;
    seat: number;
    drinks: number;
    passedOut: boolean;
    score: number;
    isBot: boolean;
    mine: boolean;
    outRound: number | null;
  }[];
  myPlayerId: string | null;
  isHost: boolean;
  canStart: boolean;
  question: { id: string; prompt: string; options: { id: string; text: string }[] } | null;
  startedAt: number | null;
  startsInMs: number;
  windowMs: number;
  myAnswered: boolean;
  answeredCount: number;
  awakeCount: number;
  /** the round that just closed — shown during the breather */
  lastRound: {
    round: number;
    drinkerId: string | null;
    drinkerName: string | null;
    correctOptionId: string | null;
    rows: { playerId: string; score: number; ms: number; correct: boolean; drank: boolean }[];
  } | null;
  winnerId: string | null;
  winnerName: string | null;
};

export async function buildCarciumaState(gameId: string, viewerId: string): Promise<CarciumaState | null> {
  const game = await prisma.carciumaGame.findUnique({
    where: { id: gameId },
    include: { players: true },
  });
  if (!game) return null;
  const plan = game.plan as unknown as CarciumaEntry[];
  const players = [...game.players].sort((a, b) => a.seat - b.seat);
  const mine = players.find((p) => p.userId === viewerId) ?? null;
  const opensAt = game.roundStartedAt?.getTime() ?? 0;
  const running = game.status === "IN_PROGRESS";
  const intermission = running && opensAt > Date.now();
  const entry = running && !intermission && game.currentRound < plan.length ? plan[game.currentRound] : null;
  const done = game.status === "COMPLETED";

  const answers = await prisma.carciumaAnswer.findMany({ where: { gameId }, orderBy: { round: "asc" } });
  const lastClosed = done ? game.currentRound : game.currentRound - 1;
  const lastRows = answers.filter((a) => a.round === lastClosed);
  const drinkerRow = lastRows.find((a) => a.drank) ?? null;
  const closedEntry = plan[lastClosed] ?? null;

  const winner = done ? players.find((p) => p.seat === game.winnerSeat) ?? null : null;

  return {
    id: game.id,
    status: game.status,
    phase: done ? "done" : game.status === "WAITING" ? "lobby" : "table",
    round: game.currentRound,
    totalRounds: plan.length || CARCIUMA_PLAN_SIZE,
    maxDrinks: CARCIUMA_MAX_DRINKS,
    seats: CARCIUMA_SEATS,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      drinks: p.drinks,
      passedOut: p.passedOut,
      score: p.score,
      isBot: p.isBot,
      mine: p.userId === viewerId,
      outRound: p.outRound ?? null,
    })),
    myPlayerId: mine?.id ?? null,
    isHost: game.hostId === viewerId,
    canStart: game.status === "WAITING" && game.hostId === viewerId,
    question: entry
      ? { id: entry.questionId, prompt: entry.prompt, options: entry.options }
      : null,
    startedAt: game.roundStartedAt?.getTime() ?? null,
    startsInMs: intermission ? opensAt - Date.now() : 0,
    windowMs: CARCIUMA_ROUND_MS,
    myAnswered: !!mine && answers.some((a) => a.round === game.currentRound && a.playerId === mine.id),
    answeredCount: answers.filter((a) => a.round === game.currentRound).length,
    awakeCount: players.filter((p) => !p.passedOut).length,
    lastRound:
      closedEntry && lastRows.length
        ? {
            round: lastClosed,
            drinkerId: drinkerRow?.playerId ?? null,
            drinkerName: players.find((p) => p.id === drinkerRow?.playerId)?.name ?? null,
            correctOptionId: closedEntry.correctOptionId,
            rows: lastRows
              .map((a) => ({
                playerId: a.playerId,
                score: a.score,
                ms: a.elapsedMilliseconds,
                correct: a.isCorrect,
                drank: a.drank,
              }))
              .sort((a, b) => b.score - a.score || a.ms - b.ms),
          }
        : null,
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? null,
  };
}

/** Close my own forgotten lobbies so an old table never blocks a new one. */
export async function expireStaleCarciuma(userId: string): Promise<void> {
  await prisma.carciumaGame.updateMany({
    where: {
      hostId: userId,
      status: "WAITING",
      createdAt: { lt: new Date(Date.now() - CARCIUMA_WAITING_TTL_MS) },
    },
    data: { status: "ABANDONED", completedAt: new Date() },
  });
}
