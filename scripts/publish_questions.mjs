// Publish eligible questions for the train game:
//   - grila:  exactly 4 options, exactly one marked correct
//   - rapide: correct answer is a plain integer (with optional minus sign)
//   - no log artifacts (gemini/model tags, Nașpa, player names, brackets in
//     options, recap leftovers) in the prompt or any option
// Unpublish anything that no longer qualifies (keeps the game clean).
//
// Usage: node --env-file-if-exists=.env scripts/publish_questions.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BAD_WORDS =
  /gemini|gresit|greșit|local-ai|qwen|mistral|gemma|nașpa|naspă|naspa|coronect|Răspuns corect|CORRECT:|^Q:\s/i;
const BAD_CHARS_IN_OPTION = /[\[\]]/;

function clean(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const users = await prisma.user.findMany({ select: { displayName: true } });
  const playerNames = new Set(users.map((u) => clean(u.displayName)));

  const all = await prisma.question.findMany({
    where: { options: { some: {} } },
    select: { id: true, prompt: true, options: { select: { text: true, isCorrect: true } } },
  });

  const contaminated = new Set();
  for (const q of all) {
    if (BAD_WORDS.test(q.prompt)) contaminated.add(q.id);
    for (const o of q.options) {
      const words = clean(o.text).split(/\s+/);
      if (BAD_WORDS.test(o.text) || BAD_CHARS_IN_OPTION.test(o.text)) contaminated.add(q.id);
      if (words.some((w) => w.length > 2 && playerNames.has(w))) contaminated.add(q.id);
    }
  }

  const grila = new Set(
    all
      .filter((q) => !contaminated.has(q.id))
      .filter((q) => q.options.length === 4 && q.options.filter((o) => o.isCorrect).length === 1)
      .map((q) => q.id)
  );
  const rapide = new Set(
    all
      .filter((q) => !contaminated.has(q.id))
      .filter((q) => {
        const c = q.options.find((o) => o.isCorrect);
        return !!c && /^-?\d+$/.test(c.text.trim());
      })
      .map((q) => q.id)
  );
  const eligible = new Set([...grila, ...rapide]);
  const ineligible = all.map((q) => q.id).filter((id) => !eligible.has(id));

  const toPublish = [...eligible];
  const toUnpublish = ineligible;
  if (toPublish.length) {
    await prisma.question.updateMany({ where: { id: { in: toPublish } }, data: { isPublished: true } });
  }
  if (toUnpublish.length) {
    await prisma.question.updateMany({ where: { id: { in: toUnpublish } }, data: { isPublished: false } });
  }
  console.log(`published: ${toPublish.length} (grila ${grila.size}, rapide ${rapide.size})`);
  console.log(`unpublished: ${toUnpublish.length} (incl. ${contaminated.size} contaminated)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
