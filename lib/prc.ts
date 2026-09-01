// PRC — Precizia Răspunsurilor Corecte.
//
// PRC grilă  = % corecte din ultimele GRILA_WINDOW răspunsuri grilă × 10.000
// PRC rapide = media punctajelor din ultimele RAPIDE_WINDOW răspunsuri rapide × 100
//   unde punctajul unei întrebări rapide:
//     - pool = ultimele RANK_POOL răspunsuri la acea întrebare (toți jucătorii)
//     - rank 1..pool după (|diferență față de răspunsul corect|, viteza de răspuns)
//     - poziția x -> 101 - x; în afara pool-ului -> 1 punct
//     - întrebările cu < MIN_ANSWERS răspunsuri în istoric nu dau punctaj
// PRC total = (PRC grilă + PRC rapide) / 2 (dacă există doar una, se folosește aceea)
import type { PrismaClient } from "@prisma/client";

export const GRILA_WINDOW = 50;
export const RAPIDE_WINDOW = 50;
export const RANK_POOL = 100;
export const MIN_ANSWERS = 20;

export interface PrcResult {
  grila: number | null;
  rapide: number | null;
  total: number | null;
  games: number;
}

interface RawAnswer {
  quizSession: { userId: string };
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
  const rapideByQuestion = new Map<string, RawAnswer[]>();
  const gamesByUser = new Map<string, number>();

  for (const a of answers as RawAnswer[]) {
    const uid = a.quizSession.userId;
    if (!uid) continue; // session lost its user (deleted) — skip
    gamesByUser.set(uid, (gamesByUser.get(uid) ?? 0) + 1);
    if (a.selectedOptionId) {
      const arr = grilaByUser.get(uid) ?? [];
      arr.push(a);
      grilaByUser.set(uid, arr);
    } else if (isNumeric(a.submittedAnswer) && isNumeric(correctText.get(a.questionId))) {
      const arr = rapideByUser.get(uid) ?? [];
      arr.push(a);
      rapideByUser.set(uid, arr);
      const qarr = rapideByQuestion.get(a.questionId) ?? [];
      qarr.push(a);
      rapideByQuestion.set(a.questionId, qarr);
    }
  }

  // ---- rapide: per-question ranking ----
  const questionAnswerCount = new Map<string, number>();
  for (const [qid, arr] of rapideByQuestion) {
    questionAnswerCount.set(qid, arr.length);
  }
  // score per answer id
  const rapideScore = new Map<string, number>();
  for (const [qid, arr] of rapideByQuestion) {
    if (arr.length < MIN_ANSWERS) continue; // question too new — no points
    const pool = arr
      .slice()
      .sort((a, b) => b.answeredAt.getTime() - a.answeredAt.getTime())
      .slice(0, RANK_POOL);
    const correct = parseInt(correctText.get(qid)!, 10);
    const ranked = pool
      .map((a) => ({
        id: `${a.quizSession.userId}:${a.answeredAt.getTime()}`,
        diff: Math.abs(parseInt(a.submittedAnswer!, 10) - correct),
        elapsed: a.elapsedMilliseconds,
      }))
      .sort((a, b) => a.diff - b.diff || a.elapsed - b.elapsed);
    ranked.forEach((r, i) => {
      rapideScore.set(r.id, Math.max(1, RANK_POOL + 1 - (i + 1)));
    });
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

    // rapide: last RAPIDE_WINDOW scored answers, mean × 100
    let rapide: number | null = null;
    const r = rapideByUser.get(uid);
    if (r && r.length > 0) {
      const scored = r
        .map((a) => ({ a, score: rapideScore.get(`${a.quizSession.userId}:${a.answeredAt.getTime()}`) ?? 1 }))
        .filter((x) => x.score !== null);
      if (scored.length > 0) {
        const last = scored
          .slice()
          .sort((x, y) => y.a.answeredAt.getTime() - x.a.answeredAt.getTime())
          .slice(0, RAPIDE_WINDOW);
        rapide = Math.round((last.reduce((s, x) => s + x.score, 0) / last.length) * 100);
      }
    }

    let total: number | null = null;
    if (grila !== null && rapide !== null) total = Math.round((grila + rapide) / 2);
    else if (grila !== null) total = grila;
    else if (rapide !== null) total = rapide;

    out.set(uid, { grila, rapide, total, games: gamesByUser.get(uid) ?? 0 });
  }

  return out;
}
