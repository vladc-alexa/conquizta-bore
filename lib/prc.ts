import type { PrismaClient } from "@prisma/client";

export const GRILA_WINDOW = 50;
export const RAPIDE_WINDOW = 50;
export const RAPIDE_MAX_SCORE = 100;
export const RAPIDE_MIN_SCORE = 5;
export const RAPIDE_TIMER_SECONDS = 10;
export const CLOSENESS_WEIGHT = 0.7;
export const SPEED_WEIGHT = 0.3;

export interface PrcResult {
  grila: number | null;
  rapide: number | null;
  total: number | null;
  games: number;
}

/** PRC rapide score for a single answer (closeness + speed). */
export function rapideAnswerScore(guess: number, correct: number, elapsedMs: number): number {
  const diff = Math.abs(guess - correct);
  const span = Math.max(Math.abs(correct), Math.abs(guess), 1);
  const closeness = Math.max(0, 1 - diff / span);
  const speed = Math.max(0, Math.min(1, 1 - elapsedMs / (RAPIDE_TIMER_SECONDS * 1000)));
  const score =
    (closeness * CLOSENESS_WEIGHT + speed * SPEED_WEIGHT) * (RAPIDE_MAX_SCORE - RAPIDE_MIN_SCORE) +
    RAPIDE_MIN_SCORE;
  return Math.max(RAPIDE_MIN_SCORE, Math.min(RAPIDE_MAX_SCORE, score));
}

interface WindowRow {
  user_id: string;
  session_id: string;
  question_id: string;
  selected_option_id: string | null;
  submitted_answer: string | null;
  is_correct: boolean;
  elapsed_ms: number;
  answered_at: Date;
  correct_text: string | null;
  mode: string;
}

/**
 * Computes PRC for every player from their most recent answers only.
 *
 * Bounded by design: a player's score depends on at most GRILA_WINDOW grila +
 * RAPIDE_WINDOW rapide answers, so the window function fetches exactly that
 * per player instead of the entire answer history. The old implementation
 * pulled ALL completed answers (no LIMIT) plus every question with a correct
 * option — cost grew without bound as people played. See scripts/capacity-bench.mjs.
 *
 * `games` (distinct completed sessions) must reflect full history, so it is
 * counted separately rather than from the capped window.
 */
export async function computeAllPrc(prisma: PrismaClient): Promise<Map<string, PrcResult>> {
  const [rows, gameCounts] = await Promise.all([
    prisma.$queryRaw<WindowRow[]>`
      WITH correct AS (
        SELECT DISTINCT ON (qo."questionId") qo."questionId" AS qid, btrim(qo.text) AS ctext
        FROM "QuestionOption" qo
        WHERE qo."isCorrect" = true
        ORDER BY qo."questionId", qo."position"
      ),
      numbered AS (
        SELECT
          qs."userId"           AS uid,
          sa."quizSessionId"    AS sid,
          sa."questionId"       AS qid,
          sa.id                 AS aid,
          sa."selectedOptionId" AS soid,
          sa."submittedAnswer"  AS sub,
          sa."isCorrect"        AS ok,
          sa."elapsedMilliseconds" AS ms,
          sa."answeredAt"       AS at,
          c.ctext               AS ctext,
          sa.ctid               AS ct,
          CASE
            WHEN sa."selectedOptionId" IS NOT NULL THEN 'g'
            WHEN sa."submittedAnswer" ~ '^-?[0-9]+$' AND c.ctext ~ '^-?[0-9]+$' THEN 'r'
            ELSE 'x'
          END AS mode
        FROM "SessionAnswer" sa
        JOIN "QuizSession" qs ON qs.id = sa."quizSessionId"
        LEFT JOIN correct c ON c.qid = sa."questionId"
        WHERE qs.status = 'COMPLETED' AND qs."userId" IS NOT NULL
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY uid, mode ORDER BY at DESC, ct ASC) AS rn
        FROM numbered
        WHERE mode <> 'x'
      )
      SELECT
        uid                AS user_id,
        sid                AS session_id,
        qid                AS question_id,
        soid               AS selected_option_id,
        sub                AS submitted_answer,
        ok                 AS is_correct,
        ms                 AS elapsed_ms,
        at                 AS answered_at,
        ctext              AS correct_text,
        mode               AS mode
      FROM ranked
      WHERE (mode = 'g' AND rn <= ${GRILA_WINDOW}) OR (mode = 'r' AND rn <= ${RAPIDE_WINDOW})
    `,
    prisma.quizSession.groupBy({
      by: ["userId"],
      where: { status: "COMPLETED", userId: { not: null }, answers: { some: {} } },
      _count: { _all: true },
    }),
  ]);

  const gamesByUser = new Map<string, number>();
  for (const g of gameCounts) {
    if (g.userId) gamesByUser.set(g.userId, g._count._all);
  }

  // group the (already windowed, newest-first) rows per user + mode
  const grilaByUser = new Map<string, WindowRow[]>();
  const rapideByUser = new Map<string, WindowRow[]>();
  const userIds = new Set<string>();
  for (const r of rows) {
    userIds.add(r.user_id);
    if (r.mode === "g") {
      const arr = grilaByUser.get(r.user_id) ?? [];
      arr.push(r);
      grilaByUser.set(r.user_id, arr);
    } else if (r.mode === "r") {
      const arr = rapideByUser.get(r.user_id) ?? [];
      arr.push(r);
      rapideByUser.set(r.user_id, arr);
    }
  }

  const out = new Map<string, PrcResult>();

  for (const uid of userIds) {
    // grila: last GRILA_WINDOW answers, % correct × 10000
    let grila: number | null = null;
    const g = grilaByUser.get(uid);
    if (g && g.length > 0) {
      const last = g
        .slice()
        .sort((a, b) => b.answered_at.getTime() - a.answered_at.getTime())
        .slice(0, GRILA_WINDOW);
      const correctCount = last.filter((a) => a.is_correct).length;
      grila = Math.round((correctCount / last.length) * 10000);
    }

    // rapide: last RAPIDE_WINDOW answers, mean score × 100 (approximation + speed)
    let rapide: number | null = null;
    const r = rapideByUser.get(uid);
    if (r && r.length > 0) {
      const last = r
        .slice()
        .sort((a, b) => b.answered_at.getTime() - a.answered_at.getTime())
        .slice(0, RAPIDE_WINDOW);
      const sum = last.reduce((s, a) => {
        const correct = parseInt(a.correct_text!, 10);
        return s + rapideAnswerScore(parseInt(a.submitted_answer!, 10), correct, a.elapsed_ms);
      }, 0);
      rapide = Math.round((sum / last.length) * 100);
    }

    let total: number | null = null;
    if (grila !== null && rapide !== null) total = Math.round((grila + rapide) / 2);
    else if (grila !== null) total = Math.round((grila + 5000) / 2);
    else if (rapide !== null) total = Math.round((rapide + 5000) / 2);

    out.set(uid, { grila, rapide, total, games: gamesByUser.get(uid) ?? 0 });
  }

  return out;
}
