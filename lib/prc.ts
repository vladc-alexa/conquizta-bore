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
  wins: number;
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
  const [rows, gameCounts, duelWinRows, towerWinRows, carciumaWinRows, trainWinRows] = await Promise.all([
    prisma.$queryRaw<WindowRow[]>`
      WITH correct AS (
        SELECT DISTINCT ON (qo."questionId") qo."questionId" AS qid, btrim(qo.text) AS ctext
        FROM "QuestionOption" qo
        WHERE qo."isCorrect" = true
        ORDER BY qo."questionId", qo."position"
      ),
      all_answers AS (
        -- 1. QuizSession answers
        SELECT
          qs."userId"              AS uid,
          sa."quizSessionId"::text AS sid,
          sa."questionId"::text    AS qid,
          sa."selectedOptionId"::text AS soid,
          sa."submittedAnswer"     AS sub,
          sa."isCorrect"           AS ok,
          sa."elapsedMilliseconds" AS ms,
          sa."answeredAt"          AS at,
          c.ctext                  AS ctext,
          CASE
            WHEN sa."selectedOptionId" IS NOT NULL THEN 'g'
            WHEN sa."submittedAnswer" ~ '^-?[0-9]+$' AND c.ctext ~ '^-?[0-9]+$' THEN 'r'
            ELSE 'x'
          END AS mode
        FROM "SessionAnswer" sa
        JOIN "QuizSession" qs ON qs.id = sa."quizSessionId"
        LEFT JOIN correct c ON c.qid = sa."questionId"
        WHERE qs.status = 'COMPLETED' AND qs."userId" IS NOT NULL

        UNION ALL

        -- 2. Duel answers (grila + rapide)
        SELECT
          da."userId"              AS uid,
          da."duelId"::text        AS sid,
          da."questionId"::text    AS qid,
          da."selectedOptionId"::text AS soid,
          da."submittedAnswer"     AS sub,
          da."isCorrect"           AS ok,
          da."elapsedMilliseconds" AS ms,
          da."answeredAt"          AS at,
          c.ctext                  AS ctext,
          CASE
            WHEN da."selectedOptionId" IS NOT NULL THEN 'g'
            WHEN da."submittedAnswer" ~ '^-?[0-9]+$' AND c.ctext ~ '^-?[0-9]+$' THEN 'r'
            ELSE 'g'
          END AS mode
        FROM "DuelAnswer" da
        LEFT JOIN correct c ON c.qid = da."questionId"

        UNION ALL

        -- 3. Tower (Turnul) answers
        SELECT
          tp."userId"              AS uid,
          ta."gameId"::text        AS sid,
          ta."questionId"::text    AS qid,
          ta."selectedOptionId"::text AS soid,
          NULL::text               AS sub,
          ta."isCorrect"           AS ok,
          ta."elapsedMilliseconds" AS ms,
          ta."answeredAt"          AS at,
          NULL::text               AS ctext,
          'g'                      AS mode
        FROM "TowerAnswer" ta
        JOIN "TowerPlayer" tp ON tp.id = ta."playerId"
        WHERE tp."userId" IS NOT NULL

        UNION ALL

        -- 4. Carciuma answers (grila + rapide)
        SELECT
          cp."userId"              AS uid,
          ca."gameId"::text        AS sid,
          ca."questionId"::text    AS qid,
          ca."selectedOptionId"::text AS soid,
          ca."answerText"          AS sub,
          ca."isCorrect"           AS ok,
          ca."elapsedMilliseconds" AS ms,
          ca."createdAt"           AS at,
          c.ctext                  AS ctext,
          CASE
            WHEN ca."selectedOptionId" IS NOT NULL THEN 'g'
            WHEN ca."answerText" ~ '^-?[0-9]+$' AND c.ctext ~ '^-?[0-9]+$' THEN 'r'
            ELSE 'g'
          END AS mode
        FROM "CarciumaAnswer" ca
        JOIN "CarciumaPlayer" cp ON cp.id = ca."playerId"
        LEFT JOIN correct c ON c.qid = ca."questionId"
        WHERE cp."userId" IS NOT NULL

        UNION ALL

        -- 5. TrainRun questions (expanded into individual grila answers)
        SELECT
          tr."userId"              AS uid,
          tr.id::text              AS sid,
          tr.id::text              AS qid,
          NULL::text               AS soid,
          NULL::text               AS sub,
          (gs.i <= tr.correct)     AS ok,
          0                        AS ms,
          tr."createdAt"           AS at,
          NULL::text               AS ctext,
          'g'                      AS mode
        FROM "TrainRun" tr
        CROSS JOIN LATERAL generate_series(1, LEAST(GREATEST(tr.total, 0), 50)) AS gs(i)
        WHERE tr.total > 0
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY uid, mode ORDER BY at DESC) AS rn
        FROM all_answers
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
    prisma.$queryRaw<{ uid: string; wins: number }[]>`
      SELECT uid, COUNT(*)::int AS wins FROM (
        SELECT "hostId" AS uid FROM "Duel" WHERE status = 'COMPLETED' AND "hostScore" > "guestScore"
        UNION ALL
        SELECT "guestId" AS uid FROM "Duel" WHERE status = 'COMPLETED' AND "guestId" IS NOT NULL AND "guestScore" > "hostScore"
      ) d GROUP BY uid
    `,
    prisma.$queryRaw<{ uid: string; wins: number }[]>`
      SELECT tp."userId" AS uid, COUNT(*)::int AS wins
      FROM "TowerGame" tg
      JOIN "TowerPlayer" tp ON tp.id = tg."winnerId"
      WHERE tg.status = 'COMPLETED' AND tp."userId" IS NOT NULL
      GROUP BY tp."userId"
    `,
    prisma.$queryRaw<{ uid: string; wins: number }[]>`
      SELECT cp."userId" AS uid, COUNT(*)::int AS wins
      FROM "CarciumaGame" cg
      JOIN "CarciumaPlayer" cp ON cp."gameId" = cg.id AND cp.seat = cg."winnerSeat"
      WHERE cg.status = 'COMPLETED' AND cg."winnerSeat" IS NOT NULL AND cp."userId" IS NOT NULL
      GROUP BY cp."userId"
    `,
    prisma.$queryRaw<{ uid: string; wins: number; games: number }[]>`
      SELECT "userId" AS uid,
             SUM(CASE WHEN total > 0 AND correct * 2 >= total THEN 1 ELSE 0 END)::int AS wins,
             COUNT(*)::int AS games
      FROM "TrainRun"
      GROUP BY "userId"
    `,
  ]);

  const gamesByUser = new Map<string, number>();
  const winsByUser = new Map<string, number>();
  const addWin = (uid: string | null | undefined, n: number) => {
    if (!uid || !n) return;
    winsByUser.set(uid, (winsByUser.get(uid) ?? 0) + n);
  };
  const addGame = (uid: string | null | undefined, n: number) => {
    if (!uid || !n) return;
    gamesByUser.set(uid, (gamesByUser.get(uid) ?? 0) + n);
  };

  for (const g of gameCounts) {
    addGame(g.userId, g._count._all);
    addWin(g.userId, g._count._all);
  }
  for (const r of duelWinRows) addWin(r.uid, r.wins);
  for (const r of towerWinRows) addWin(r.uid, r.wins);
  for (const r of carciumaWinRows) addWin(r.uid, r.wins);
  for (const r of trainWinRows) {
    addWin(r.uid, r.wins);
    addGame(r.uid, r.games);
  }

  // Merge in-memory mini-game stats (Quiz Fighter, Tower Siege, Turnul client games)
  const mem = (globalThis as unknown as {
    __stoneDailyStats?: Map<string, { wins: number; correct: number; wrong: number }>;
  }).__stoneDailyStats;
  if (mem) {
    for (const [uid, entry] of mem.entries()) {
      addWin(uid, entry.wins);
      addGame(uid, entry.wins > 0 ? entry.wins : entry.correct + entry.wrong > 0 ? 1 : 0);
    }
  }

  // group the (already windowed, newest-first) rows per user + mode
  const grilaByUser = new Map<string, WindowRow[]>();
  const rapideByUser = new Map<string, WindowRow[]>();
  const userIds = new Set<string>([...winsByUser.keys(), ...gamesByUser.keys()]);
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
    const memEntry = mem?.get(uid);
    if ((g && g.length > 0) || (memEntry && memEntry.correct + memEntry.wrong > 0)) {
      const last = (g ?? [])
        .slice()
        .sort((a, b) => b.answered_at.getTime() - a.answered_at.getTime())
        .slice(0, GRILA_WINDOW);
      const memCorrect = memEntry?.correct ?? 0;
      const memWrong = memEntry?.wrong ?? 0;
      const totalG = last.length + memCorrect + memWrong;
      const correctCount = last.filter((a) => a.is_correct).length + memCorrect;
      if (totalG > 0) grila = Math.round((correctCount / totalG) * 10000);
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

    out.set(uid, {
      grila,
      rapide,
      total,
      games: gamesByUser.get(uid) ?? 0,
      wins: winsByUser.get(uid) ?? 0,
    });
  }

  return out;
}
