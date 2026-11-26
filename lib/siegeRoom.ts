// Server-side round engine for the SIEGE mini-game (1v1, 3 towers × 2 HP).
//
// The siege battlefield is rendered client-side, but every round decision is
// made here so two browser clients stay perfectly in sync:
//   - the question for a round is served once, by the server, to both seats
//   - the round clock is the server clock (roundStartedAt + limit)
//   - correctness / timeout / tiebreaker is resolved server-side, and both
//     clients animate the same outcome (same attacker, same target tower)

export const SIEGE_GRILA_SECONDS = 12;
export const SIEGE_TIE_SECONDS = 10;
export const SIEGE_LEAD_MS = 2600; // "ready?" countdown before the first question
export const SIEGE_NEXT_LEAD_MS = 1500; // short countdown between rounds
export const SIEGE_TIE_LEAD_MS = 2200; // countdown before the tiebreaker question

export type SiegeMode = "grila" | "rapide";
export type SiegeSide = "left" | "right";

export interface SiegeSeatLike {
  seatIndex: number;
  userId: string;
  name: string;
  isBot: boolean;
  botDifficulty?: "easy" | "medium" | "hard";
  started?: boolean;
}

export interface SiegeAnswer {
  seq: number;
  choice?: number | null;
  guess?: number | null;
  elapsedMs: number;
}

export interface SiegeQuestion {
  id: string;
  prompt: string;
  options?: string[];
  correctIndex?: number;
  answer?: number;
  category?: string;
}

export interface SiegeRoundResult {
  round: number;
  kind: "hit" | "both-wrong";
  attacker: SiegeSide; // side that fires (ignored when both-wrong)
  tie: boolean;
  targetSeed: number; // deterministic tower pick on the target castle
  correctText: string;
  times: { left: number; right: number };
  guesses?: { left: number | null; right: number | null };
  exact?: number;
}

export interface SiegeRoomLike {
  status: "waiting" | "playing" | "finished";
  seats: SiegeSeatLike[];
  currentRound: number;
  roundSeq: number;
  roundMode: SiegeMode;
  roundStartedAt: number;
  roundQuestion: SiegeQuestion | null;
  roundAnswers: Record<string, SiegeAnswer>;
  lastResult: SiegeRoundResult | null;
}

const BOT_ACCURACY = { easy: 0.45, medium: 0.64, hard: 0.8 };
const BOT_TIME_RANGE = { easy: [4800, 9000], medium: [3100, 6900], hard: [1900, 4800] };
const BOT_SPREAD = { easy: 0.35, medium: 0.16, hard: 0.06 };

export function limitFor(mode: SiegeMode): number {
  return (mode === "grila" ? SIEGE_GRILA_SECONDS : SIEGE_TIE_SECONDS) * 1000;
}

export function sideOf(seat: SiegeSeatLike): SiegeSide {
  return seat.seatIndex === 0 ? "left" : "right";
}

export function playingSeats(room: SiegeRoomLike): SiegeSeatLike[] {
  return [...room.seats].sort((a, b) => a.seatIndex - b.seatIndex).slice(0, 2);
}

/** Deterministically simulate a bot's answer for the current question. */
export function simulateBotAnswer(room: SiegeRoomLike, seat: SiegeSeatLike): SiegeAnswer {
  const diff = seat.botDifficulty || "medium";
  const q = room.roundQuestion;
  const [lo, hi] = BOT_TIME_RANGE[diff];
  const elapsedMs = Math.round(lo + Math.random() * (hi - lo));
  if (room.roundMode === "rapide") {
    const exact = q?.answer ?? 0;
    const scale = Math.max(Math.abs(exact), 12);
    const offset = Math.round((Math.random() * 2 - 1) * scale * BOT_SPREAD[diff]);
    return { seq: room.roundSeq, guess: exact + offset, elapsedMs };
  }
  const optionCount = q?.options?.length ?? 4;
  const correctIndex = q?.correctIndex ?? 0;
  const isCorrect = Math.random() < BOT_ACCURACY[diff];
  const choice = isCorrect
    ? correctIndex
    : (correctIndex + 1 + Math.floor(Math.random() * Math.max(optionCount - 1, 1))) % Math.max(optionCount, 1);
  return { seq: room.roundSeq, choice, elapsedMs };
}

/** The answer recorded for a seat this round (timeout / bot fallback included). */
export function answerFor(room: SiegeRoomLike, seat: SiegeSeatLike): SiegeAnswer {
  const stored = room.roundAnswers?.[seat.userId];
  if (stored && stored.seq === room.roundSeq) return stored;
  if (seat.isBot) return simulateBotAnswer(room, seat);
  return { seq: room.roundSeq, choice: null, guess: null, elapsedMs: limitFor(room.roundMode) };
}

/** True when every human seat has locked in an answer for the current question. */
export function allHumansAnswered(room: SiegeRoomLike): boolean {
  const humans = playingSeats(room).filter((s) => !s.isBot);
  if (humans.length === 0) return false;
  return humans.every((s) => {
    const a = room.roundAnswers?.[s.userId];
    return Boolean(a && a.seq === room.roundSeq);
  });
}

/** Hard deadline for the current question (server clock). */
export function roundDeadline(room: SiegeRoomLike): number {
  return (room.roundStartedAt || 0) + limitFor(room.roundMode);
}

export interface Evaluation {
  /** null => the round is not decided yet (tiebreaker must be played). */
  result: SiegeRoundResult | null;
  goToTie: boolean;
}

export function evaluateRound(room: SiegeRoomLike): Evaluation {
  const q = room.roundQuestion;
  const seats = playingSeats(room);
  if (!q || seats.length < 2) return { result: null, goToTie: false };

  const left = seats[0];
  const right = seats[1];
  const aLeft = answerFor(room, left);
  const aRight = answerFor(room, right);
  const times = { left: aLeft.elapsedMs, right: aRight.elapsedMs };
  const base = {
    round: room.currentRound,
    tie: room.roundMode === "rapide",
    targetSeed: room.currentRound,
  };

  if (room.roundMode === "grila") {
    const correctText = q.options?.[q.correctIndex ?? -1] ?? "";
    const leftCorrect = aLeft.choice != null && aLeft.choice === q.correctIndex;
    const rightCorrect = aRight.choice != null && aRight.choice === q.correctIndex;

    if (leftCorrect && rightCorrect) return { result: null, goToTie: true };
    if (!leftCorrect && !rightCorrect) {
      return {
        result: { ...base, kind: "both-wrong", attacker: "left", correctText, times },
        goToTie: false,
      };
    }
    return {
      result: {
        ...base,
        kind: "hit",
        attacker: leftCorrect ? "left" : "right",
        correctText,
        times,
      },
      goToTie: false,
    };
  }

  // Tiebreaker: closest numeric guess wins, ties broken by the faster answer.
  const exact = q.answer ?? 0;
  const correctText = String(exact);
  const dl = aLeft.guess == null ? Infinity : Math.abs(aLeft.guess - exact);
  const dr = aRight.guess == null ? Infinity : Math.abs(aRight.guess - exact);
  const guesses = { left: aLeft.guess ?? null, right: aRight.guess ?? null };

  let attacker: SiegeSide | null = null;
  if (dl < dr) attacker = "left";
  else if (dr < dl) attacker = "right";
  else if (aLeft.elapsedMs < aRight.elapsedMs) attacker = "left";
  else if (aRight.elapsedMs < aLeft.elapsedMs) attacker = "right";

  if (!attacker) {
    return {
      result: { ...base, kind: "both-wrong", attacker: "left", correctText, times, guesses, exact },
      goToTie: false,
    };
  }
  return {
    result: { ...base, kind: "hit", attacker, correctText, times, guesses, exact },
    goToTie: false,
  };
}

/** Reset the room for a new question and pin the server-side start time. */
export function armRound(
  room: SiegeRoomLike,
  question: SiegeQuestion,
  mode: SiegeMode,
  leadMs: number,
  round: number
): void {
  room.roundQuestion = question;
  room.roundMode = mode;
  room.roundSeq = (room.roundSeq || 0) + 1;
  room.roundAnswers = {};
  room.lastResult = null;
  room.currentRound = round;
  room.roundStartedAt = Date.now() + leadMs;
}
