// Import sanitized questions (JSON from tools/parse_questions.py) into the DB.
// Entry: { question, answer, options?, correct_index?, note?, ... }
// - Skips entries without an answer.
// - Upserts by normalized prompt (no duplicates).
// - Multiple-choice: creates QuestionOption rows, isCorrect on correct_index
//   (falls back to the option matching `answer` text).
// - Free-text: single correct QuestionOption (position 0).
// - Imports as isPublished=false so they can be reviewed/published later.
//
// Usage:
//   node --env-file-if-exists=.env scripts/import_questions.mjs <questions.json>
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

function norm(s) {
  return String(s ?? "")
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
  const data = JSON.parse(readFileSync(file, "utf8"));
  const entries = Array.isArray(data) ? data : data.questions ?? [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const e of entries) {
    if (!e.question || !e.answer) {
      skipped++;
      console.log(`SKIP (${e.note || "no answer"}): ${e.question || "(no question)"}`);
      continue;
    }
    const existing = await prisma.question.findFirst({
      where: { prompt: { equals: e.question, mode: "insensitive" } },
      include: { options: true },
    });

    if (existing) {
      // keep existing options; just ensure the correct one is marked
      let correct = existing.options.find((o) => o.isCorrect);
      if (!correct && e.options?.length) {
        let idx = e.correct_index ?? -1;
        if (idx < 0 || idx >= e.options.length) {
          idx = e.options.findIndex((o) => norm(o) === norm(e.answer));
        }
        if (idx >= 0 && existing.options[idx] && !existing.options[idx].isCorrect) {
          await prisma.questionOption.update({ where: { id: existing.options[idx].id }, data: { isCorrect: true } });
          correct = existing.options[idx];
        }
      }
      if (!correct && !e.options?.length && existing.options[0]) {
        if (existing.options[0].text !== e.answer) {
          await prisma.questionOption.update({ where: { id: existing.options[0].id }, data: { text: e.answer, isCorrect: true } });
        }
      }
      updated++;
      console.log(`UPDATE: ${e.question.slice(0, 70)} -> ${e.answer}`);
      continue;
    }

    const optionData = e.options?.length
      ? e.options.map((text, i) => {
          let isCorrect = false;
          if (e.correct_index === i) isCorrect = true;
          else if (norm(text) === norm(e.answer)) isCorrect = true;
          return { text, position: i, isCorrect };
        })
      : [{ text: e.answer, position: 0, isCorrect: true }];

    await prisma.question.create({
      data: {
        prompt: e.question,
        isPublished: false,
        difficulty: 1,
        options: { create: optionData },
      },
    });
    created++;
    console.log(`CREATE${e.options?.length ? " (MC)" : ""}: ${e.question.slice(0, 70)} -> ${e.answer}`);
  }

  console.log(`\ndone: ${created} created, ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
