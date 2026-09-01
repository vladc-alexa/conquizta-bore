// PRC — Precizia Răspunsurilor Corecte.
//
// PRC grilă  = % corecte din ultimele GRILA_WINDOW răspunsuri grilă × 10.000
// PRC rapide = media punctajelor din ultimele RAPIDE_WINDOW răspunsuri rapide × 100
//   unde punctajul unei întrebări rapide (joc de aproximare):
//     - apropiere: cu cât ești mai aproape de răspunsul corect, cu atât mai bine
//       (eroare relativă față de răspunsul corect, indiferent de semn)
//     - viteză: bonus pentru cât de repede răspunzi (fereastră = RAPIDE_TIMER_SECONDS)
//     - punctaj = 100 × (0.7 × apropiere + 0.3 × viteză), minim 5 puncte
//   => maxim 100 puncte/întrebare, deci PRC rapide maxim 10.000
// PRC total = (PRC grilă + PRC rapide) / 2; dacă jucătorul are doar un mod,
// se mediează cu 5000 (mijlocul scalei 0–10.000) pentru celălalt
import type { PrismaClient } from "@prisma/client";

export const GRILA_WINDOW = 50;
export const RAPIDE_WINDOW = 50;
export const RAPIDE_MAX_SCORE = 100;
export const RAPIDE_MIN_SCORE = 5;
export const RAPIDE_TIMER_SECONDS = 10;
export const CLOSENESS_WEIGHT = 0.7;
export const SPEED_WEIGHT = 0.3;

// Score for one rapide answer, 5..100.
export function rapideAnswerScore(guess: number, correct: number, elapsedMs: number): number {
  const denom = Math.max(Math.abs(correct), 1); // protect against correct == 0
  const relErr = Math.min(Math.abs(guess - correct) / denom, 1);
  const closeness = 1 - relErr;
  const windowMs = RAPIDE_TIMER_SECONDS * 1000;
  const speed = Math.max(0, 1 - Math.min(elapsedMs, windowMs) / windowMs);
  const score = Math.round(RAPIDE_MAX_SCORE * (CLOSENESS_WEIGHT * closeness + SPEED_WEIGHT * speed));
  return Math.max(RAPIDE_MIN_SCORE, Math.min(RAPIDE_MAX_SCORE, score));
}

export interface PrcResult {
  grila: number | null;
  rapide: number | null;
  total: number | null;
  games: number;
}

interface RawAnswer {
  quizSession: { userId: string };
  quizSessionId: string;
  questionId: string;
  selectedOptionId: string | null;
  submittedAnswer: string | null;
  isCorrect: boolean;
  elapsedMilliseconds: number;
  answeredAt: Date;
}

export async function computeAllPrc(prisma: PrismaClient): Promise<Map<string, PrcResult>> {
  const [answers, questions] = await Promise.all([
    prisma.sessionAnswer.findMany({
      where: { quizSession: { status: "COMPLETED" } },
      select: {
        quizSession: { select: { userId: true } },
        quizSessionId: true,
        questionId: true,
        selectedOptionId: true,
        submittedAnswer: true,
        isCorrect: true,
        elapsedMilliseconds: true,
        answeredAt: true,
      },
    }),
    prisma.question.findMany({
      where: { options: { some: { isCorrect: true } } },
      select: {
        id: true,
        options: { where: { isCorrect: true }, select: { text: true } },
      },
    }),
  ]);

  // correct answer text per question (numeric -> rapide-capable)
  const correctText = new Map<string, string | null>();
  for (const q of questions) {
    correctText.set(q.id, q.options[0]?.text.trim() ?? null);
  }
  const isNumeric = (s: string | null) => !!s && /^-?\d+$/.test(s);

  // split answers
  const grilaByUser = new Map<string, RawAnswer[]>();
  const rapideByUser = new Map<string, RawAnswer[]>();
  const gamesByUser = new Map<string, Set<string>>();

  for (const a of answers as RawAnswer[]) {
    const uid = a.quizSession.userId;
    if (!uid) continue; // session lost its user (deleted) — skip
    const sessions = gamesByUser.get(uid) ?? new Set<string>();
    sessions.add(a.quizSessionId);
    gamesByUser.set(uid, sessions);
    if (a.selectedOptionId) {
      const arr = grilaByUser.get(uid) ?? [];
      arr.push(a);
      grilaByUser.set(uid, arr);
    } else if (isNumeric(a.submittedAnswer) && isNumeric(correctText.get(a.questionId))) {
      const arr = rapideByUser.get(uid) ?? [];
      arr.push(a);
      rapideByUser.set(uid, arr);
    }
  }

  const out = new Map<string, PrcResult>();
  const userIds = new Set([...grilaByUser.keys(), ...rapideByUser.keys()]);

  for (const uid of userIds) {
    // grila: last GRILA_WINDOW answers, % correct × 10000
    let grila: number | null = null;
    const g = grilaByUser.get(uid);
    if (g && g.length > 0) {
      const last = g.slice().sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime()).slice(0, GRILA_WINDOW);
      const correctCount = last.filter((a) => a.isCorrect).length;
      grila = Math.round((correctCount / last.length) * 10000);
    }

    // rapide: last RAPIDE_WINDOW answers, mean score × 100 (approximation + speed)
    let rapide: number | null = null;
    const r = rapideByUser.get(uid);
    if (r && r.length > 0) {
      const last = r
        .slice()
        .sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime())
        .slice(0, RAPIDE_WINDOW);
      const sum = last.reduce((s, a) => {
        const correct = parseInt(correctText.get(a.questionId)!, 10);
        return s + rapideAnswerScore(parseInt(a.submittedAnswer!, 10), correct, a.elapsedMilliseconds);
      }, 0);
      rapide = Math.round((sum / last.length) * 100);
    }

    let total: number | null = null;
    if (grila !== null && rapide !== null) total = Math.round((grila + rapide) / 2);
    else if (grila !== null) total = Math.round((grila + 5000) / 2);
    else if (rapide !== null) total = Math.round((rapide + 5000) / 2);

    out.set(uid, { grila, rapide, total, games: gamesByUser.get(uid)?.size ?? 0 });
  }

  return out;
}
