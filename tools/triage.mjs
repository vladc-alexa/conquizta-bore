#!/usr/bin/env node
/**
 * triage.mjs — question triage: pull broken / unproven questions out of rotation.
 *
 * Rules (see lib/questionTriage.ts):
 *   unvetted      published, never answered by anyone — nobody has proven the
 *                 answer is right, yet it is being served to players.
 *   low-accuracy  published, answered >= 8 times, <= 15% correct — wrong key,
 *                 ambiguous prompt, or an impossible question.
 *
 * Quarantined rows get isPublished=false so every game path skips them without
 * further changes; the admin "Carantină" tab lists them for review.
 *
 * Dry run by default. It prints what would change and writes a JSON dump to
 * audit/ so the run can be reviewed or restored.
 *
 *   node tools/triage.mjs            # count only
 *   node tools/triage.mjs --apply    # quarantine them
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const unvettedSql = prisma.$queryRaw`
  SELECT q.id, q.prompt
  FROM "Question" q
  WHERE q."isPublished" = true
    AND q."quarantinedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "SessionAnswer" a WHERE a."questionId" = q.id)`;

const lowAccuracySql = prisma.$queryRaw`
  SELECT q.id, q.prompt,
         count(a.id)::int AS attempts,
         (count(*) FILTER (WHERE a."isCorrect"))::int AS correct
  FROM "Question" q
  JOIN "SessionAnswer" a ON a."questionId" = q.id
  WHERE q."isPublished" = true
    AND q."quarantinedAt" IS NULL
  GROUP BY q.id, q.prompt
  HAVING count(a.id) >= 8
     AND (count(*) FILTER (WHERE a."isCorrect"))::float / count(a.id) <= 0.15
  ORDER BY attempts DESC`;

async function main() {
  const [unvetted, lowAccuracy] = await Promise.all([unvettedSql, lowAccuracySql]);

  const published = await prisma.question.count({ where: { isPublished: true } });
  const already = await prisma.question.count({ where: { quarantinedAt: { not: null } } });

  console.log(`published (in rotation) : ${published}`);
  console.log(`already quarantined     : ${already}`);
  console.log(`unvetted (never answered): ${unvetted.length}`);
  console.log(`low accuracy  (<=15% / >=8): ${lowAccuracy.length}`);
  console.log(`=> would leave in rotation : ${published - unvetted.length - lowAccuracy.length}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join("audit", `triage-${stamp}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "unvetted.json"), JSON.stringify(unvetted, null, 2));
  fs.writeFileSync(path.join(out, "low-accuracy.json"), JSON.stringify(lowAccuracy, null, 2));
  console.log(`dump: ${out}`);

  if (!APPLY) {
    console.log("\ndry run — nothing changed. re-run with --apply");
    return;
  }

  const now = new Date();
  const a = await prisma.question.updateMany({
    where: { id: { in: unvetted.map((q) => q.id) } },
    data: { isPublished: false, quarantinedAt: now, quarantineReason: "unvetted" },
  });
  const b = await prisma.question.updateMany({
    where: { id: { in: lowAccuracy.map((q) => q.id) } },
    data: { isPublished: false, quarantinedAt: now, quarantineReason: "low-accuracy" },
  });

  const left = await prisma.question.count({ where: { isPublished: true } });
  console.log(`\nquarantined unvetted     : ${a.count}`);
  console.log(`quarantined low-accuracy : ${b.count}`);
  console.log(`published left in rotation: ${left}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
