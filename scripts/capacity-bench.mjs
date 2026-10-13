#!/usr/bin/env node
/**
 * capacity-bench.mjs — leaderboard capacity probe for conquizta-bore.
 *
 * Measures the DB work behind `/api/leaderboard` two ways:
 *   • LEGACY  — the old query set: ALL completed SessionAnswers + ALL questions
 *               with a correct option. This is what ran on every request before
 *               the 60s cache, and what grew linearly with answer history.
 *   • WINDOWED — the current query set: only the last 50 grila + 50 rapide
 *               answers per player, correct text joined in SQL (no question
 *               preload), plus a cheap grouped count of completed sessions.
 *
 * Run against the live DB to compare the two ceilings and see how LEGACY grows
 * with history while WINDOWED stays bounded.
 *
 * Usage:  node --env-file=.env scripts/capacity-bench.mjs
 *         node --env-file=.env scripts/capacity-bench.mjs --concurrency 1,5,10,20
 *
 * Why direct Prisma and not HTTP: `/api/leaderboard` returns 401 anonymously, so
 * an un-authed curl load test measures nothing.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CONC = String(arg("concurrency", "1,5,10,20")).split(",").map(Number);

// ---- LEGACY: unbounded full scan (pre-cache behaviour) --------------------
function legacyQuerySet() {
  return Promise.all([
    prisma.sessionAnswer.findMany({
      where: { quizSession: { status: "COMPLETED" } },
      select: { quizSessionId: true, questionId: true, selectedOptionId: true },
    }),
    prisma.question.findMany({
      where: { options: { some: { isCorrect: true } } },
      select: { id: true, options: { where: { isCorrect: true }, select: { text: true } } },
    }),
  ]);
}

// ---- WINDOWED: last 50 per mode per player + grouped session count --------
function windowedQuerySet() {
  return Promise.all([
    prisma.$queryRaw`
      WITH correct AS (
        SELECT DISTINCT ON (qo."questionId") qo."questionId" AS qid, btrim(qo.text) AS ctext
        FROM "QuestionOption" qo WHERE qo."isCorrect" = true
        ORDER BY qo."questionId", qo."position"
      ),
      numbered AS (
        SELECT qs."userId" AS uid, sa."questionId" AS qid, sa."selectedOptionId" AS soid,
               sa."submittedAnswer" AS sub, sa."isCorrect" AS ok, sa."elapsedMilliseconds" AS ms,
               sa."answeredAt" AS at, c.ctext AS ctext, sa.ctid AS ct,
               CASE WHEN sa."selectedOptionId" IS NOT NULL THEN 'g'
                    WHEN sa."submittedAnswer" ~ '^-?[0-9]+$' AND c.ctext ~ '^-?[0-9]+$' THEN 'r'
                    ELSE 'x' END AS mode
        FROM "SessionAnswer" sa
        JOIN "QuizSession" qs ON qs.id = sa."quizSessionId"
        LEFT JOIN correct c ON c.qid = sa."questionId"
        WHERE qs.status = 'COMPLETED' AND qs."userId" IS NOT NULL
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY uid, mode ORDER BY at DESC, ct ASC) AS rn
        FROM numbered WHERE mode <> 'x'
      )
      SELECT uid, qid, soid, sub, ok, ms, at, ctext, mode
      FROM ranked WHERE (mode = 'g' AND rn <= 50) OR (mode = 'r' AND rn <= 50)`,
    prisma.quizSession.groupBy({
      by: ["userId"],
      where: { status: "COMPLETED", userId: { not: null }, answers: { some: {} } },
      _count: { _all: true },
    }),
  ]);
}

async function bench(label, qs, conc) {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, () => qs().then(() => {})));
  const ms = Date.now() - t0;
  return { label, conc, ms, rps: +(conc / (ms / 1000)).toFixed(2) };
}

const [answers, questions, users] = await Promise.all([
  prisma.sessionAnswer.count({ where: { quizSession: { status: "COMPLETED" } } }),
  prisma.question.count(),
  prisma.user.count(),
]);
console.log(`DB size: ${answers} completed answers / ${questions} questions / ${users} users`);
console.log("One query set = one uncached /api/leaderboard call.");
console.log("With the 60s cache this runs once per minute for ALL players, not per player.\n");

for (const [label, qs] of [["LEGACY  ", legacyQuerySet], ["WINDOWED", windowedQuerySet]]) {
  console.log(`== ${label.trim()} ==\nconc\twallMs\treq/s`);
  const results = [];
  for (const c of CONC) {
    const r = await bench(label, qs, c);
    results.push(r);
    console.log(`${r.conc}\t${r.ms}\t\t${r.rps}`);
  }
  const ceiling = Math.max(...results.map((r) => r.rps));
  console.log(`ceiling ≈ ${ceiling} req/s (CPU-bound on this host)\n`);
}

await prisma.$disconnect();
