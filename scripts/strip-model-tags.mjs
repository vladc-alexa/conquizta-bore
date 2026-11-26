/** strip-model-tags.mjs — remove the generator tag ([gemini] /
 *  [gemini (gemini-2.5-flash-lite)]) that got appended to option text.
 *  These tags are what the publish filter rejects, so stripping them is a
 *  prerequisite to re-publishing the deactivated pool.
 *
 *   node --env-file=.env scripts/strip-model-tags.mjs          # dry run
 *   node --env-file=.env scripts/strip-model-tags.mjs --apply  # write + rollback
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join("audit", `strip-tags-${TS}`);
fs.mkdirSync(OUT, { recursive: true });

const TAG = /\s*\[gemini[^\]]*\]/gi;
const clean = (s) => s.replace(TAG, "").replace(/\s{2,}/g, " ").trim();

const opts = await prisma.questionOption.findMany({
  where: { text: { contains: "gemini" } },
  select: { id: true, text: true, questionId: true, question: { select: { isPublished: true } } },
});

const changes = [];
let emptied = 0;
for (const o of opts) {
  if (!TAG.test(o.text)) continue;
  TAG.lastIndex = 0;
  const fixed = clean(o.text);
  if (!fixed) emptied++;
  changes.push({ id: o.id, questionId: o.questionId, published: o.question.isPublished, before: o.text, after: fixed });
}

const byPub = { published: 0, deactivated: 0 };
for (const c of changes) byPub[c.published ? "published" : "deactivated"]++;

console.log(`OUT ${OUT}`);
console.log(`options carrying a [gemini...] tag: ${changes.length}`);
console.log(`  on deactivated questions: ${byPub.deactivated}`);
console.log(`  on published questions:   ${byPub.published}`);
console.log(`  would become empty:       ${emptied}`);
console.log("--- samples ---");
for (const c of changes.slice(0, 10)) console.log(`  ${JSON.stringify(c.before).slice(0, 46)} -> ${JSON.stringify(c.after)}`);
for (const c of changes.filter((x) => x.published).slice(0, 3)) console.log(`  [PUB] ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);

fs.writeFileSync(path.join(OUT, "rollback.json"), JSON.stringify(changes.map((c) => ({ id: c.id, text: c.before })), null, 2));
if (APPLY) {
  let n = 0;
  for (const c of changes) { await prisma.questionOption.update({ where: { id: c.id }, data: { text: c.after } }); n++; }
  const left = await prisma.questionOption.count({ where: { text: { contains: "gemini" } } });
  console.log(`APPLIED ${n}. options still containing 'gemini': ${left}. rollback -> ${path.join(OUT, "rollback.json")}`);
} else console.log("DRY RUN — rerun with --apply");
await prisma.$disconnect();
