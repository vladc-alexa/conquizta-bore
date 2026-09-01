// Publish eligible questions for the train game:
//   - grila:  exactly 4 options, exactly one marked correct
//   - rapide: correct answer is a plain integer (with optional minus sign)
// Unpublish anything that no longer qualifies (keeps the game clean).
//
// Usage: node --env-file-if-exists=.env scripts/publish_questions.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.question.findMany({
    where: { options: { some: {} } },
    select: { id: true, options: { select: { text: true, isCorrect: true } } },
  });

  const grila = new Set(
    all.filter((q) => q.options.length === 4 && q.options.filter((o) => o.isCorrect).length === 1).map((q) => q.id)
  );
  const rapide = new Set(
    all
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
  console.log(`unpublished: ${toUnpublish.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
