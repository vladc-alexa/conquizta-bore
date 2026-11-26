/**
 * list-five-answers.mjs — Bucket 2: published rapide questions whose stored
 * answer is literally "5". Root cause: the log parser captured the game's
 * `CORRECT:` line (the player's typed guess / no-answer filler), not ground
 * truth — "5" shows up in 38% of all source answer lines. NOT recoverable by
 * regex, so the safe move is to unpublish (players stop seeing garbage).
 *
 *   node --env-file=.env scripts/list-five-answers.mjs           # dry run -> CSV
 *   node --env-file=.env scripts/list-five-answers.mjs --apply   # unpublish + rollback
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join("audit", `five-answers-${TS}`);
mkdirSync(OUT, { recursive: true });

const csv = (rows) =>
  rows
    .map((r) =>
      r.map((v) => {
        const x = String(v ?? "");
        return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
      }).join(",")
    )
    .join("\n");

const rows = await prisma.question.findMany({
  where: { isPublished: true },
  include: { options: true },
});

const targets = rows.filter(
  (q) => q.options.length === 1 && q.options[0].text.trim() === "5"
);

// a "5" that is part of a decimal (0,5 / 1.5) is still a bad key, not a mention
const mentions5 = (s) => /(?<![\d.,])5(?!\d)/.test(s) || /\bcinci\b/i.test(s);

const table = [["id", "prompt", "prompt_mentions_5_or_cinci"]];
for (const q of targets) {
  table.push([q.id, q.prompt.replace(/\s+/g, " "), mentions5(q.prompt) ? "yes" : ""]);
}
writeFileSync(join(OUT, "five-answers.csv"), csv(table));

const suspicious = targets.filter((q) => !mentions5(q.prompt));

console.log(`OUT ${OUT}`);
console.log(`rapide with answer "5"     : ${targets.length}`);
console.log(`  prompt never mentions 5  : ${suspicious.length}  <- almost certainly wrong key`);
console.log(`  prompt mentions 5/cinci  : ${targets.length - suspicious.length}  <- maybe legit`);
console.log(`\n${APPLY ? "APPLYING..." : "DRY RUN — rerun with --apply to unpublish"}`);

if (APPLY) {
  writeFileSync(
    join(OUT, "rollback.json"),
    JSON.stringify(suspicious.map((q) => ({ id: q.id, isPublished: true })), null, 2)
  );
  const res = await prisma.question.updateMany({
    where: { id: { in: suspicious.map((q) => q.id) } },
    data: { isPublished: false },
  });
  console.log(`UNPUBLISHED ${res.count} (kept ${targets.length - suspicious.length} that mention 5). rollback -> ${join(OUT, "rollback.json")}`);
}

await prisma.$disconnect();
