// Import data/questions-en.json (Open Trivia DB) and data/questions-numeric-en.json into PostgreSQL via Prisma.
// Usage: node --env-file-if-exists=.env scripts/import_opentdb.mjs
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

function slugify(str) {
  return String(str ?? "general")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 95) || "general";
}

async function ensureCategory(name, cache) {
  const clean = String(name || "General Knowledge").slice(0, 100);
  const slug = slugify(clean);
  if (cache.has(slug)) return cache.get(slug);
  const cat = await prisma.category.upsert({
    where: { slug },
    update: {},
    create: { name: clean, slug },
  });
  cache.set(slug, cat.id);
  return cat.id;
}

async function main() {
  const mcFile = resolve(process.cwd(), "data/questions-en.json");
  const numFile = resolve(process.cwd(), "data/questions-numeric-en.json");
  const mcData = JSON.parse(readFileSync(mcFile, "utf8"));
  const numData = JSON.parse(readFileSync(numFile, "utf8"));

  const catCache = new Map();
  let created = 0;
  let skipped = 0;

  for (const q of mcData.questions ?? []) {
    const existing = await prisma.question.findFirst({
      where: { prompt: { equals: q.prompt, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    const categoryId = await ensureCategory(q.category, catCache);
    await prisma.question.create({
      data: {
        prompt: q.prompt,
        categoryId,
        difficulty: q.difficulty ?? 2,
        isPublished: true,
        options: {
          create: q.options.map((text, idx) => ({
            text,
            position: idx,
            isCorrect: idx === q.correctIndex,
          })),
        },
      },
    });
    created++;
  }

  for (const q of numData.questions ?? []) {
    const existing = await prisma.question.findFirst({
      where: { prompt: { equals: q.prompt, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    const categoryId = await ensureCategory(q.category, catCache);
    await prisma.question.create({
      data: {
        prompt: q.prompt,
        categoryId,
        difficulty: 2,
        isPublished: true,
        options: {
          create: [{ text: String(q.answer), position: 0, isCorrect: true }],
        },
      },
    });
    created++;
  }

  console.log(`Imported English trivia bank: ${created} created, ${skipped} already existed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
