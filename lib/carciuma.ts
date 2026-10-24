// La Carciuma — the drinking-table mini game.
//
// Five patrons around one wooden table. Every round one grilă question; when the
// round closes the WORST answer has to drink: lowest score first, slowest on a
// tie, and silence counts as the slowest answer of all. Three drinks and that
// patron is under the table. The last one still sitting wins.
//
// Like the tower, rounds are settled lazily by whoever asks for the state, so no
// background worker is needed and a closed tab never freezes the table.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchGrilaPool, fetchRapidePool, gradeAnswer, type PlanEntry } from "@/lib/duel";

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
export const CARCIUMA_MIN_PLAYERS = 2; // enough for a drinking contest
export const CARCIUMA_WAITING_TTL_MS = 10 * 60_000; // forgotten lobbies die
export const CARCIUMA_BOT_NAMES = ["Bogdan", "Mirela", "Nea Costel", "Roxana", "Doru", "Lenuța"];
/** Bots get roughly this share of questions right — enough to make the table lively. */
const BOT_ACCURACY = 0.42;

export type CarciumaEntry = PlanEntry;
/** every third round is a rapidă: type the number instead of picking a letter */
const RAPIDE_EVERY = 3;

export async function buildCarciumaPlan(): Promise<CarciumaEntry[]> {
  // a mixed sitting: grilă for the gossip, rapide for the maths after two glasses
  const [grila, rapide] = await Promise.all([
    fetchGrilaPool(CARCIUMA_PLAN_SIZE + 4),
    fetchRapidePool(Math.ceil(CARCIUMA_PLAN_SIZE / RAPIDE_EVERY) + 6),
  ]);
  const g = grila.filter((e): e is CarciumaEntry => e.mode === "grila");
  const r = rapide.filter((e): e is CarciumaEntry => e.mode === "rapide");
  const plan: CarciumaEntry[] = [];
  let gi = 0;
  let ri = 0;
  for (let i = 0; i < CARCIUMA_PLAN_SIZE; i += 1) {
    const wantRapide = (i + 1) % RAPIDE_EVERY === 0;
    if (wantRapide && r[ri]) plan.push(r[ri++]);
    else if (g[gi]) plan.push(g[gi++]);
    else if (r[ri]) plan.push(r[ri++]);
  }
  return plan;
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
export async function fillCarciumaBots(gameId: string, count = CARCIUMA_SEATS): Promise<number> {
  const players = await prisma.carciumaPlayer.findMany({ where: { gameId }, select: { seat: true } });
  const taken = new Set(players.map((p) => p.seat));
  const names = [...CARCIUMA_BOT_NAMES].sort(() => Math.random() - 0.5);
  let n = 0;
  for (let seat = 0; seat < CARCIUMA_SEATS; seat += 1) {
    if (n >= count) break;
    if (taken.has(seat)) continue;
    await prisma.carciumaPlayer.create({
      data: { gameId, name: names[n % names.length], seat, isBot: true },
    });
    n += 1;
  }
  return n;
}

export async function startCarciuma(gameId: string): Promise<void> {
  const seated = await prisma.carciumaPlayer.count({ where: { gameId } });
  if (seated < CARCIUMA_MIN_PLAYERS) {
    throw new Error(`e nevoie de cel puțin ${CARCIUMA_MIN_PLAYERS} jucători la masă`);
  }
  const plan = await buildCarciumaPlan();
  if (!plan.length) throw new Error("nu există întrebări publicate");
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
  input: { selectedOptionId?: string | null; answer?: string | null }
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

  if (entry.mode === "grila" && !input.selectedOptionId) return { ok: false, error: "răspuns lipsă" };
  if (entry.mode === "rapide" && !String(input.answer ?? "").trim()) return { ok: false, error: "răspuns lipsă" };

  const graded = gradeAnswer(entry, input, elapsed);
  const isCorrect = graded.isCorrect;
  const score =
    entry.mode === "rapide" ? Math.max(0, Math.round(graded.score ?? 0)) : answerScore(isCorrect, elapsed);
  try {
    await prisma.carciumaAnswer.create({
      data: {
        gameId,
        playerId,
        round: game.currentRound,
        questionId: entry.questionId,
        selectedOptionId: entry.mode === "grila" ? input.selectedOptionId ?? null : null,
        answerText: entry.mode === "rapide" ? String(input.answer ?? "").trim().slice(0, 40) : null,
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
 * Settle every round whose window has closed.
 *
 * Concurrency: every browser tab polls the table, so several requests can hit a
 * closed round at the same instant. Each settle attempt runs in its own
 * transaction that first takes a transaction-scoped advisory lock on the game
 * id — the second request blocks, then re-reads the game, sees the round has
 * moved on and does nothing. Every write inside is idempotent as well (scores
 * are recomputed from the answer rows, a drink is only applied while its answer
 * row is still marked as not-drunk), so a retry after a crash cannot double-pour.
 */
export async function resolveCarciuma(gameId: string): Promise<void> {
  for (let guard = 0; guard < 30; guard += 1) {
    const progressed = await prisma.$transaction((tx) => settleOneRound(tx, gameId), {
      timeout: 20_000,
      maxWait: 10_000,
    });
    if (!progressed) return;
  }
}

async function settleOneRound(tx: Prisma.TransactionClient, gameId: string): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${gameId}))`;

  const game = await tx.carciumaGame.findUnique({ where: { id: gameId } });
  if (!game || game.status !== "IN_PROGRESS") return false;
  const plan = game.plan as unknown as CarciumaEntry[];
  const entry = plan[game.currentRound];
  if (!entry) {
    await finishCarciuma(tx, game.id, null);
    return false;
  }
  const opensAt = game.roundStartedAt?.getTime() ?? 0;
  const closesAt = opensAt + CARCIUMA_ROUND_MS + CARCIUMA_ROUND_GRACE_MS;
  if (Date.now() < opensAt) return false; // still in the breather

  const round = game.currentRound;
  const players = await tx.carciumaPlayer.findMany({ where: { gameId }, orderBy: { seat: "asc" } });

  // answers already in (humans may answer right up to the whistle)
  const answered = new Set(
    (await tx.carciumaAnswer.findMany({ where: { gameId, round }, select: { playerId: true } })).map((a) => a.playerId)
  );

  // nobody left to answer: pour now instead of staring at the clock
  const awaiting = players.filter((p) => !p.passedOut);
  const allIn =
    awaiting.length > 0 && awaiting.every((p) => p.isBot || answered.has(p.id));
  if (Date.now() < closesAt && !allIn) return false;

  // bots answer at close time (they never hold the round hostage)
  const botRows = players
    .filter((p) => p.isBot && !p.passedOut && !answered.has(p.id))
    .map((p) => {
      const isCorrect = Math.random() < BOT_ACCURACY;
      const elapsed = botElapsed();
      if (entry.mode === "rapide") {
        // a drunk local guesses a nearby number; closeness still earns partial score
        const drift = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 12));
        const guess = isCorrect ? entry.answer : entry.answer + drift;
        const graded = gradeAnswer(entry, { answer: String(guess) }, elapsed);
        return {
          gameId,
          playerId: p.id,
          round,
          questionId: entry.questionId,
          selectedOptionId: null,
          answerText: String(guess),
          isCorrect: graded.isCorrect,
          score: Math.max(0, Math.round(graded.score ?? 0)),
          elapsedMilliseconds: elapsed,
        };
      }
      const wrong = entry.options.filter((o) => o.id !== entry.correctOptionId);
      const pick = isCorrect ? entry.correctOptionId : wrong[Math.floor(Math.random() * wrong.length)]?.id ?? entry.options[0].id;
      return {
        gameId,
        playerId: p.id,
        round,
        questionId: entry.questionId,
        selectedOptionId: pick,
        answerText: null,
        isCorrect,
        score: answerScore(isCorrect, elapsed),
        elapsedMilliseconds: elapsed,
      };
    });
  // silence is the slowest answer: everyone still quiet gets an empty row
  const silentRows = players
    .filter((p) => !p.passedOut && !answered.has(p.id) && !botRows.some((b) => b.playerId === p.id))
    .map((p) => ({
      gameId,
      playerId: p.id,
      round,
      questionId: entry.questionId,
      selectedOptionId: null,
      answerText: null,
      isCorrect: false,
      score: 0,
      elapsedMilliseconds: CARCIUMA_ROUND_MS + CARCIUMA_ROUND_GRACE_MS,
    }));
  const fresh = [...botRows, ...silentRows];
  if (fresh.length) await tx.carciumaAnswer.createMany({ data: fresh, skipDuplicates: true });

  // scores are a pure function of the answer rows, so recomputing is safe
  const totals = await tx.carciumaAnswer.groupBy({ by: ["playerId"], where: { gameId }, _sum: { score: true } });
  for (const t of totals) {
    await tx.carciumaPlayer.update({ where: { id: t.playerId }, data: { score: t._sum.score ?? 0 } });
  }

  const rows = await tx.carciumaAnswer.findMany({ where: { gameId, round } });
  const rowFor = (id: string) => rows.find((r) => r.playerId === id);
  const awake = players.filter((p) => !p.passedOut);
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
    // claim the drink on the answer row first: only the run that flips the flag pours
    const marked = row
      ? await tx.carciumaAnswer.updateMany({ where: { id: row.id, drank: false }, data: { drank: true } })
      : { count: 0 };
    if (marked.count > 0) {
      const drinks = Math.min(CARCIUMA_MAX_DRINKS, drinker.drinks + 1);
      await tx.carciumaPlayer.update({
        where: { id: drinker.id },
        data: {
          drinks,
          passedOut: drinks >= CARCIUMA_MAX_DRINKS,
          outRound: drinks >= CARCIUMA_MAX_DRINKS ? round : null,
        },
      });
    }
  }

  const after = await tx.carciumaPlayer.findMany({ where: { gameId }, orderBy: { seat: "asc" } });
  const stillAwake = after.filter((p) => !p.passedOut);
  const nextRound = round + 1;
  if (stillAwake.length <= 1 || nextRound >= plan.length) {
    const winner = stillAwake.length ? stillAwake[0] : [...after].sort((a, b) => b.score - a.score)[0] ?? null;
    await finishCarciuma(tx, gameId, winner?.seat ?? null);
    return false;
  }
  await tx.carciumaGame.update({
    where: { id: gameId },
    data: { currentRound: nextRound, roundStartedAt: new Date(Date.now() + CARCIUMA_INTERMISSION_MS) },
  });
  return true;
}

async function finishCarciuma(db: Prisma.TransactionClient | typeof prisma, gameId: string, winnerSeat: number | null): Promise<void> {
  await db.carciumaGame.update({
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
  question:
    | {
        id: string;
        prompt: string;
        mode: "grila" | "rapide";
        options: { id: string; text: string }[];
        responseType: string | null;
      }
    | null;
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
    mode: "grila" | "rapide";
    /** THE correct answer, text for both modes — revealed once the round closes */
    answer: string | null;
    rows: { playerId: string; score: number; ms: number; correct: boolean; drank: boolean; answer: string | null }[];
  } | null;
  winnerId: string | null;
  winnerName: string | null;
  /** question-by-question recap of the whole sitting — filled only once the table is done */
  review: {
    round: number;
    prompt: string;
    mode: "grila" | "rapide";
    /** the option text for a grilă, the number as a string for a rapidă */
    correctAnswer: string | null;
    rows: {
      playerId: string;
      name: string;
      /** what that patron actually said; null = kept quiet */
      answer: string | null;
      correct: boolean;
      ms: number;
      score: number;
      drank: boolean;
    }[];
  }[];
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
      ? entry.mode === "grila"
        ? { id: entry.questionId, prompt: entry.prompt, mode: "grila" as const, options: entry.options, responseType: null }
        : { id: entry.questionId, prompt: entry.prompt, mode: "rapide" as const, options: [], responseType: entry.responseType }
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
            correctOptionId: closedEntry.mode === "grila" ? closedEntry.correctOptionId : null,
            mode: closedEntry.mode,
            // reveal the truth for both modes: the option text on a grilă, the
            // number on a rapidă — players should never be left guessing
            answer:
              closedEntry.mode === "grila"
                ? closedEntry.options.find((o) => o.id === closedEntry.correctOptionId)?.text ?? null
                : closedEntry.answer != null
                  ? String(closedEntry.answer)
                  : null,
            rows: lastRows
              .map((a) => ({
                playerId: a.playerId,
                score: a.score,
                ms: a.elapsedMilliseconds,
                correct: a.isCorrect,
                drank: a.drank,
                answer:
                  closedEntry.mode === "grila"
                    ? closedEntry.options.find((o) => o.id === a.selectedOptionId)?.text ?? null
                    : a.answerText ?? null,
              }))
              .sort((a, b) => b.score - a.score || a.ms - b.ms),
          }
        : null,
    winnerId: winner?.id ?? null,
    winnerName: winner?.name ?? null,
    // The recap reads straight off the plan + the answer rows, so no extra table
    // is needed and it survives forever after the table clears.
    review: done
      ? buildCarciumaReview({ plan, rounds: game.currentRound + 1, answers, players })
      : [],
  };
}

/** Every played round, with the truth and what each patron said — for the post-game review. */
function buildCarciumaReview(input: {
  plan: CarciumaEntry[];
  rounds: number;
  answers: { round: number; playerId: string; selectedOptionId: string | null; answerText: string | null; isCorrect: boolean; score: number; elapsedMilliseconds: number; drank: boolean }[];
  players: { id: string; name: string }[];
}): CarciumaState["review"] {
  const { plan, rounds, answers, players } = input;
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  return plan.slice(0, Math.max(0, rounds)).flatMap((entry, round) => {
    const rows = answers.filter((a) => a.round === round);
    if (!rows.length) return [];
    const optionText = (optionId: string | null) =>
      optionId && entry.mode === "grila" ? entry.options.find((o) => o.id === optionId)?.text ?? null : null;
    return [
      {
        round,
        prompt: entry.prompt,
        mode: entry.mode,
        correctAnswer: entry.mode === "grila" ? optionText(entry.correctOptionId) : String(entry.answer),
        rows: rows
          .map((a) => ({
            playerId: a.playerId,
            name: nameOf.get(a.playerId) ?? "?",
            answer: optionText(a.selectedOptionId) ?? a.answerText ?? null,
            correct: a.isCorrect,
            ms: a.elapsedMilliseconds,
            score: a.score,
            drank: a.drank,
          }))
          .sort((a, b) => b.score - a.score || a.ms - b.ms),
      },
    ];
  });
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
