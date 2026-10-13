#!/usr/bin/env node
/**
 * capacity-bench.mjs — leaderboard capacity probe for conquizta-bore.
 *
 * Measures the cost that used to be the app's bottleneck: the exact
 * `computeAllPrc` query set (ALL completed SessionAnswers + ALL questions with a
 * correct option) that `/api/leaderboard` ran on EVERY request before the 60s
 * cache. Run it against the live DB to see the uncached ceiling and how it grows
 * with answer history.
 *
 * Usage:  node --env-file=.env scripts/capacity-bench.mjs
 *         node --env-file=.env scripts/capacity-bench.mjs --concurrency 1,5,10,20
 *
 * Why direct Prisma and not HTTP: `/api/leaderboard` returns 401 anonymously, so
 * an un-authed curl load test measures nothing. This reproduces the DB work that
 * the cache now serves once per TTL instead of once per player per 5s.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CONC = String(arg("concurrency", "1,5,10,20")).split(",").map(Number);

async function leaderboardQuerySet() {
  return Promise.all([
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
      select: { id: true, options: { select: { isCorrect: true, text: true } } },
    }),
  ]);
}

async function bench(conc) {
  const run = () =>
    Array.from({ length: conc }, () => leaderboardQuerySet().then(() => {}));
  const t0 = Date.now();
  await Promise.all(run());
  const ms = Date.now() - t0;
  return { conc, ms, rps: +(conc / (ms / 1000)).toFixed(2) };
}

const [answers, questions, users] = await Promise.all([
  prisma.sessionAnswer.count({ where: { quizSession: { status: "COMPLETED" } } }),
  prisma.question.count(),
  prisma.user.count(),
]);
console.log(
  `DB size: ${answers} completed answers / ${questions} questions / ${users} users`
);
console.log(
  "One query set = one uncached /api/leaderboard call.\n" +
    "Cached (60s TTL) it runs once per minute for ALL players, not per player.\n"
);

console.log("conc\twallMs\treq/s");
const results = [];
for (const c of CONC) {
  const r = await bench(c);
  results.push(r);
  console.log(`${r.conc}\t${r.ms}\t\t${r.rps}`);
}

const ceiling = Math.max(...results.map((r) => r.rps));
console.log(
  `\nUncached ceiling ≈ ${ceiling} req/s (CPU-bound on this host).` +
    `\nIdle dashboard player = 0.2 leaderboard req/s → uncached ceiling ≈ ` +
    `${Math.round(ceiling / 0.2)} idle players before the box pegs.` +
    `\nWith the 60s cache the leaderboard leaves the per-player path entirely.`
);

await prisma.$disconnect();
