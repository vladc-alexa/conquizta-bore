// 1v1 DUEL — rules, question plan, server-side grading and round resolution.
// Server-only (imports prisma). The UI never imports this; it talks to
// /api/duel/* and only ever receives public (answer-free) round payloads.
import { prisma } from "@/lib/prisma";
import { rapideAnswerScore } from "@/lib/prc";

/** Rapide counts as "correct" for the round when within 10% of the answer. */
function rapideIsClose(guess: number, correct: number, tolerance = 0.1): boolean {
  const denom = Math.max(Math.abs(correct), 1);
  return Math.abs(guess - correct) / denom <= tolerance;
}

// ---- rules --------------------------------------------------------------
export const DUEL_GRILA_MS = 15_000; // grilă answer window
export const DUEL_RAPIDE_MS = 10_000; // rapidă answer window
export const DUEL_GRILA_ROUNDS = 6;
export const DUEL_RAPIDE_ROUNDS = 4;
export const DUEL_BASE_ROUNDS = DUEL_GRILA_ROUNDS + DUEL_RAPIDE_ROUNDS; // 10

// Arena rule: every round win shoves the loser toward their cliff. Three round
// wins IN A ROW (not a net margin — a loss or a draw resets the run) sends the
// opponent over the edge and ends the match.
export const DUEL_STREAK_TO_WIN = 3;
export const DUEL_WAITING_TTL_MS = 10 * 60_000; // an unjoined lobby dies after 10 min
export const DUEL_ROUND_GRACE_MS = 1_500; // let an in-flight answer land after the clock hits 0

// Round order: 6 grilă + 4 rapidă, interleaved so the match keeps changing
// gear; the two closing rounds are grilă.
export const DUEL_MODE_ORDER: ("grila" | "rapide")[] = [
  "grila", "rapide", "grila", "rapide", "grila", "rapide", "grila", "rapide", "grila", "grila",
];

export type PlanEntry =
  | {
      mode: "grila";
      questionId: string;
      prompt: string;
      options: { id: string; text: string }[];
      correctOptionId: string;
    }
  | {
      mode: "rapide";
      questionId: string;
      prompt: string;
      answer: number;
      responseType: string;
    };

export function roundWindowMs(mode: "grila" | "rapide"): number {
  return mode === "rapide" ? DUEL_RAPIDE_MS : DUEL_GRILA_MS;
}

// ---- question picking (same filters as /api/questions) ------------------
/** Published grilă questions (4 options, exactly one correct), shuffled order.
 *  Exported so other games (the tower) reuse the exact same pool filters. */
export async function fetchGrilaPool(limit: number) {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT q.id FROM "Question" q
    WHERE q."isPublished" = true
      AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id) = 4
      AND (SELECT count(*) FROM "QuestionOption" o WHERE o."questionId" = q.id AND o."isCorrect" = true) = 1
    ORDER BY random()
    LIMIT ${limit}`;
  if (!ids.length) return [];
  const qs = await prisma.question.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: { id: true, prompt: true, options: { select: { id: true, text: true, isCorrect: true } } },
  });
  return qs
    .map((q): PlanEntry | null => {
      const correct = q.options.find((o) => o.isCorrect);
      if (!correct) return null;
      const order = [...q.options].sort(() => Math.random() - 0.5); // shared display order
      return {
        mode: "grila" as const,
        questionId: q.id,
        prompt: q.prompt,
        options: order.map((o) => ({ id: o.id, text: o.text })),
        correctOptionId: correct.id,
      } satisfies PlanEntry;
    })
    .filter((e): e is PlanEntry => e !== null);
}

function responseTypeFor(prompt: string, answer: number): string {
  if (/în ce an\b|în anul\b|\banul\b|când a fost|când s-a născut|când a murit|când a apărut/i.test(prompt)) return "an";
  if (answer < 0) return "număr negativ";
  return "număr";
}

export async function fetchRapidePool(limit: number) {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT q.id FROM "Question" q
    JOIN "QuestionOption" o ON o."questionId" = q.id AND o."isCorrect" = true
    WHERE q."isPublished" = true AND trim(o."text") ~ '^-?[0-9]+$'
    ORDER BY random()
    LIMIT ${limit}`;
  if (!ids.length) return [];
  const qs = await prisma.question.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: { id: true, prompt: true, options: { select: { text: true, isCorrect: true } } },
  });
  return qs
    .map((q): PlanEntry | null => {
      const correct = q.options.find((o) => o.isCorrect);
      if (!correct || !/^-?\d+$/.test(correct.text.trim())) return null;
      const answer = parseInt(correct.text.trim(), 10);
      return {
        mode: "rapide" as const,
        questionId: q.id,
        prompt: q.prompt,
        answer,
        responseType: responseTypeFor(q.prompt, answer),
      } satisfies PlanEntry;
    })
    .filter((e): e is PlanEntry => e !== null);
}

/** One extra rapidă round for sudden death (a match can never end level). */
export async function buildRapideEntry(exclude: string[]): Promise<PlanEntry | null> {
  const pool = await fetchRapidePool(exclude.length + 8);
  const fresh = pool.find((e) => !exclude.includes(e.questionId));
  return fresh ?? pool[0] ?? null;
}

/** Freeze the 10-round plan at match creation. */
export async function buildDuelPlan(): Promise<PlanEntry[]> {
  const grila = await fetchGrilaPool(DUEL_GRILA_ROUNDS + 6);
  const rapide = await fetchRapidePool(DUEL_RAPIDE_ROUNDS + 6);
  const gi = grila[Symbol.iterator]();
  const ri = rapide[Symbol.iterator]();
  const plan: PlanEntry[] = [];
  for (const mode of DUEL_MODE_ORDER) {
    const next = mode === "grila" ? gi.next() : ri.next();
    if (!next.done) plan.push(next.value);
  }
  return plan;
}

// ---- grading ------------------------------------------------------------
export function gradeAnswer(
  entry: PlanEntry,
  input: { selectedOptionId?: string | null; answer?: string | null },
  elapsedMs: number
): { isCorrect: boolean; score: number | null } {
  if (entry.mode === "grila") {
    return { isCorrect: !!input.selectedOptionId && input.selectedOptionId === entry.correctOptionId, score: null };
  }
  const guess = Number(String(input.answer ?? "").trim());
  if (!Number.isFinite(guess)) return { isCorrect: false, score: null };
  return { isCorrect: rapideIsClose(guess, entry.answer), score: rapideAnswerScore(guess, entry.answer, elapsedMs) };
}

type AnswerRow = { userId: string; isCorrect: boolean; score: number | null; elapsedMilliseconds: number };

/** Which player wins a round — null = nobody (a genuine draw). */
export function decideRound(entry: PlanEntry, answers: AnswerRow[]): string | null {
  if (!answers.length) return null;
  if (entry.mode === "grila") {
    const correct = answers.filter((a) => a.isCorrect).sort((a, b) => a.elapsedMilliseconds - b.elapsedMilliseconds);
    return correct.length ? correct[0].userId : null;
  }
  const top = Math.max(...answers.map((a) => a.score ?? 0));
  const leaders = answers.filter((a) => (a.score ?? 0) === top).sort((a, b) => a.elapsedMilliseconds - b.elapsedMilliseconds);
  if (leaders.length > 1 && leaders[0].elapsedMilliseconds === leaders[1].elapsedMilliseconds) return null;
  return leaders[0].userId;
}

/** Length of the trailing run of consecutive wins by `playerId`. */
export function trailingStreak(winners: (string | null)[], playerId: string): number {
  let n = 0;
  for (let i = winners.length - 1; i >= 0; i--) {
    if (winners[i] !== playerId) break;
    n++;
  }
  return n;
}

async function roundWinnerOf(duelId: string, round: number, entry: PlanEntry): Promise<string | null> {
  const rows = await prisma.duelAnswer.findMany({
    where: { duelId, round },
    select: { userId: true, isCorrect: true, score: true, elapsedMilliseconds: true },
  });
  return decideRound(entry, rows);
}

// ---- resolution (lazy, called on every state poll) ----------------------
export async function resolveDuel(duelId: string): Promise<void> {
  for (let guard = 0; guard < 30; guard++) {
    const duel = await prisma.duel.findUnique({ where: { id: duelId } });
    if (!duel || duel.status !== "IN_PROGRESS") return;
    const plan = duel.plan as PlanEntry[];
    const r = duel.currentRound;

    // past the last planned round
    if (r >= plan.length) {
      if (duel.hostScore !== duel.guestScore) {
        await finishDuel(duel.id);
        return;
      }
      const extra = await buildRapideEntry(plan.map((e) => e.questionId));
      if (!extra) {
        await finishDuel(duel.id);
        return;
      }
      const res = await prisma.duel.updateMany({
        where: { id: duelId, status: "IN_PROGRESS", currentRound: r },
        data: { plan: [...plan, extra], roundStartedAt: new Date() },
      });
      if (res.count === 0) return; // another resolver won the race
      continue;
    }

    const entry = plan[r];
    const answers = await prisma.duelAnswer.findMany({
      where: { duelId, round: r },
      select: { userId: true, isCorrect: true, score: true, elapsedMilliseconds: true },
    });
    const started = duel.roundStartedAt?.getTime() ?? Date.now();
    const deadline = started + roundWindowMs(entry.mode) + DUEL_ROUND_GRACE_MS;
    if (answers.length < 2 && Date.now() < deadline) return; // round still open

    const winner = decideRound(entry, answers);
    const res = await prisma.duel.updateMany({
      where: { id: duelId, status: "IN_PROGRESS", currentRound: r },
      data: {
        currentRound: r + 1,
        roundStartedAt: new Date(),
        hostScore: { increment: winner === duel.hostId ? 1 : 0 },
        guestScore: { increment: winner === duel.guestId ? 1 : 0 },
      },
    });
    if (res.count === 0) return;

    // win condition: three round wins in a row (a loss or a draw resets the run)
    const tail: (string | null)[] = [];
    for (let i = Math.max(0, r - (DUEL_STREAK_TO_WIN - 1)); i <= r; i++) {
      tail.push(await roundWinnerOf(duelId, i, plan[i]));
    }
    if (tail.length === DUEL_STREAK_TO_WIN && tail.every((w) => w !== null && w === tail[0])) {
      await finishDuel(duelId);
      return;
    }
  }
}

/** Complete the match once and record each player's answers as an official
 *  COMPLETED session, so the duel feeds the same PRC leaderboard as training. */
async function finishDuel(duelId: string): Promise<void> {
  const res = await prisma.duel.updateMany({
    where: { id: duelId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (res.count === 0) return;
  const duel = await prisma.duel.findUnique({ where: { id: duelId } });
  if (!duel) return;
  const players = [duel.hostId, duel.guestId].filter((x): x is string => !!x);
  const answers = await prisma.duelAnswer.findMany({ where: { duelId } });
  for (const uid of players) {
    const mine = answers.filter((a) => a.userId === uid);
    if (!mine.length) continue;
    await prisma.quizSession.create({
      data: {
        userId: uid,
        status: "COMPLETED",
        questionCount: mine.length,
        correctCount: mine.filter((a) => a.isCorrect).length,
        completedAt: new Date(),
        answers: {
          create: mine.map((a) => ({
            questionId: a.questionId,
            selectedOptionId: a.selectedOptionId,
            submittedAnswer: a.submittedAnswer,
            isCorrect: a.isCorrect,
            elapsedMilliseconds: a.elapsedMilliseconds,
            answeredAt: a.answeredAt,
          })),
        },
      },
    });
  }
}

// ---- public state -------------------------------------------------------
export type DuelPlayer = { id: string; name: string; score: number };
export type DuelState = {
  id: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  role: "host" | "guest" | null;
  host: DuelPlayer;
  guest: DuelPlayer | null;
  round: number;
  totalRounds: number;
  mode: "grila" | "rapide" | null;
  /** id of the question the current round serves (null between rounds) */
  questionId: string | null;
  prompt: string | null;
  options: { id: string; text: string }[] | null;
  responseType: string | null;
  startedAt: number | null;
  windowMs: number | null;
  myAnswered: boolean;
  opponentAnswered: boolean;
  history: {
    round: number;
    mode: "grila" | "rapide";
    /** id of the question behind the round — lets players report it / editors fix it */
    questionId: string;
    prompt: string;
    reveal: string;
    /** grilă variants with the correct flag (editors need it to prefill the inline editor) */
    options: { text: string; isCorrect: boolean }[] | null;
    winnerId: string | null;
    answers: { userId: string; isCorrect: boolean; elapsedMs: number; score: number | null; mine: boolean }[];
  }[];
  winnerId: string | null;
  draw: boolean;
  /** round wins in a row needed to knock the opponent off the cliff */
  streakToWin: number;
  /** current consecutive-win run for each side (resets on a loss or a draw) */
  streaks: { host: number; guest: number };
  pushedOffId: string | null;
};

export async function buildDuelState(duelId: string, viewerId: string): Promise<DuelState | null> {
  const duel = await prisma.duel.findUnique({
    where: { id: duelId },
    include: { host: { select: { id: true, displayName: true } }, guest: { select: { id: true, displayName: true } } },
  });
  if (!duel) return null;
  const plan = duel.plan as PlanEntry[];
  const role: DuelState["role"] = duel.hostId === viewerId ? "host" : duel.guestId === viewerId ? "guest" : null;
  const answers = await prisma.duelAnswer.findMany({ where: { duelId } });

  const totalRounds = Math.max(DUEL_BASE_ROUNDS, plan.length);
  const open = duel.status === "IN_PROGRESS" && duel.currentRound < plan.length;
  // Once the match is over the round list doubles as a review screen: editors fix
  // a question right there, so read the live text back instead of the plan
  // snapshot (otherwise the fix would only be visible to the player who made it).
  const live = open
    ? new Map<string, { prompt: string; options: { text: string; isCorrect: boolean }[] }>()
    : new Map(
        (
          await prisma.question.findMany({
            where: { id: { in: plan.slice(0, duel.currentRound).map((e) => e.questionId) } },
            select: {
              id: true,
              prompt: true,
              options: { select: { text: true, isCorrect: true }, orderBy: { position: "asc" } },
            },
          })
        ).map((q) => [q.id, { prompt: q.prompt, options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) }]),
      );

  const history = plan.slice(0, duel.currentRound).map((entry, i) => {
    const mine = answers.filter((a) => a.round === i);
    const now = live.get(entry.questionId);
    const options = entry.mode === "grila" ? (now?.options.length ? now.options : null) : null;
    const reveal = options
      ? options.find((o) => o.isCorrect)?.text ?? ""
      : entry.mode === "grila"
        ? entry.options.find((o) => o.id === entry.correctOptionId)?.text ?? ""
        : String(entry.answer);
    return {
      round: i,
      mode: entry.mode,
      questionId: entry.questionId,
      prompt: now?.prompt ?? entry.prompt,
      reveal,
      options:
        options ??
        (entry.mode === "grila"
          ? entry.options.map((o) => ({ text: o.text, isCorrect: o.id === entry.correctOptionId }))
          : null),
      winnerId: decideRound(entry, mine),
      answers: mine
        .map((a) => ({
          userId: a.userId,
          isCorrect: a.isCorrect,
          elapsedMs: a.elapsedMilliseconds,
          score: a.score,
          mine: a.userId === viewerId,
        }))
        .sort((a, b) => Number(b.mine) - Number(a.mine)),
    };
  });

  const winners = history.map((h) => h.winnerId);
  const streaks = {
    host: trailingStreak(winners, duel.hostId),
    guest: duel.guestId ? trailingStreak(winners, duel.guestId) : 0,
  };

  const entry = open ? plan[duel.currentRound] : null;
  const roundAnswers = open ? answers.filter((a) => a.round === duel.currentRound) : [];

  return {
    id: duel.id,
    status: duel.status,
    role,
    host: { id: duel.host.id, name: duel.host.displayName, score: duel.hostScore },
    guest: duel.guest ? { id: duel.guest.id, name: duel.guest.displayName, score: duel.guestScore } : null,
    round: duel.currentRound,
    totalRounds,
    mode: entry?.mode ?? null,
    questionId: entry?.questionId ?? null,
    prompt: entry?.prompt ?? null,
    options: entry?.mode === "grila" ? entry.options : null,
    responseType: entry?.mode === "rapide" ? entry.responseType : null,
    startedAt: duel.roundStartedAt?.getTime() ?? null,
    windowMs: entry ? roundWindowMs(entry.mode) : null,
    myAnswered: roundAnswers.some((a) => a.userId === viewerId),
    opponentAnswered: !!duel.guestId && roundAnswers.some((a) => a.userId !== viewerId),
    history,
    winnerId:
      duel.status === "COMPLETED"
        ? duel.hostScore !== duel.guestScore
          ? duel.hostScore > duel.guestScore
            ? duel.hostId
            : duel.guestId
          : null
        : null,
    draw: duel.status === "COMPLETED" && duel.hostScore === duel.guestScore,
    streakToWin: DUEL_STREAK_TO_WIN,
    streaks,
    pushedOffId:
      duel.status === "COMPLETED" && streaks.host >= DUEL_STREAK_TO_WIN
        ? duel.guestId
        : duel.status === "COMPLETED" && streaks.guest >= DUEL_STREAK_TO_WIN
          ? duel.hostId
          : null,
  };
}

/** Expire my own stale lobbies so a forgotten open game never blocks a new one. */
export async function expireStaleLobbies(userId: string): Promise<void> {
  await prisma.duel.updateMany({
    where: {
      hostId: userId,
      status: "WAITING",
      createdAt: { lt: new Date(Date.now() - DUEL_WAITING_TTL_MS) },
    },
    data: { status: "ABANDONED", completedAt: new Date() },
  });
}
