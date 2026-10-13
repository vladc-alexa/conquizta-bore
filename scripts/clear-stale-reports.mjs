/** clear-stale-reports.mjs — one-off backfill: delete player reports that sit on
 *  questions which are already handled (isPublished=false). Editing a question
 *  now clears its reports going forward, but reports created before that fix
 *  still clutch the "Raportate" queue.
 *  ...
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join("audit", `clear-stale-reports-${TS}`);
fs.mkdirSync(OUT, { recursive: true });

const reports = await prisma.questionReport.findMany({
  where: { question: { isPublished: false } },
  select: { id: true, questionId: true, userId: true, note: true, createdAt: true },
});

const byQ = {};
for (const r of reports) byQ[r.questionId] = (byQ[r.questionId] || 0) + 1;
console.log(`OUT ${OUT}`);
console.log(`stale reports (on unpublished questions): ${reports.length} across ${Object.keys(byQ).length} questions`);

fs.writeFileSync(path.join(OUT, "rollback.json"), JSON.stringify(reports, null, 2));

if (APPLY) {
  const res = await prisma.questionReport.deleteMany({ where: { id: { in: reports.map((r) => r.id) } } });
  const left = await prisma.questionReport.count();
  console.log(`DELETED ${res.count}. reports left in DB: ${left}. rollback -> ${path.join(OUT, "rollback.json")}`);
} else {
  console.log("DRY RUN — rerun with --apply");
}
await prisma.$disconnect();
