// Import sanitized questions (JSON from tools/parse_questions.py) into the DB.
// Each entry: { question, answer, all_answers?, note?, times?, prefix_hits? }
// - Skips entries without an answer.
// - Upserts by normalized prompt (no duplicates).
// - Stores the answer as the single correct QuestionOption (position 0).
// - Imports as isPublished=false so they can be reviewed/published later.
//
// Usage:
//   node --env-file-if-exists=.env scripts/import_questions.mjs <questions.json>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

function norm(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/import_questions.mjs <questions.json>");
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(file, "utf8"));
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const e of entries) {
    if (!e.question || !e.answer) {
      skipped++;
      console.log(`SKIP (${e.note || "no answer"}): ${e.question || "(orphan answer)"}`);
      continue;
    }
    const existing = await prisma.question.findFirst({
      where: { prompt: { equals: e.question, mode: "insensitive" } },
      include: { options: { where: { isCorrect: true } } },
    });
    if (existing) {
      if (existing.options.length === 0) {
        await prisma.questionOption.create({
          data: { questionId: existing.id, text: e.answer, position: 0, isCorrect: true },
        });
      } else if (existing.options[0].text !== e.answer) {
        await prisma.questionOption.update({
          where: { id: existing.options[0].id },
          data: { text: e.answer },
        });
      }
      updated++;
      console.log(`UPDATE: ${e.question} -> ${e.answer}`);
    } else {
      await prisma.question.create({
        data: {
          prompt: e.question,
          isPublished: false,
          difficulty: 1,
          options: { create: [{ text: e.answer, position: 0, isCorrect: true }] },
        },
      });
      created++;
      console.log(`CREATE: ${e.question} -> ${e.answer}`);
    }
  }

  console.log(`\ndone: ${created} created, ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
