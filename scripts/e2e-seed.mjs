// Seed a throwaway DB with enough published questions for the duel/tower
// harnesses (≥6 grilă + ≥4 rapide, plus a few spare so rounds never run dry).
// Usage: DATABASE_URL=... node scripts/e2e-seed.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const grila = Array.from({ length: 14 }, (_, i) => ({
  prompt: `E2E grila ${i + 1}: cât fac ${i + 1} + ${i + 2}?`,
  options: [`${2 * i + 3}`, `${2 * i + 4}`, `${2 * i + 99}`, `${2 * i + 100}`],
  correct: 0,
}));
const rapide = Array.from({ length: 10 }, (_, i) => ({
  prompt: `E2E rapide ${i + 1}: cât fac ${i + 3} * 2?`,
  answer: `${(i + 3) * 2}`,
}));

async function main() {
  await prisma.question.deleteMany({ where: { prompt: { startsWith: "E2E " } } });
  for (const g of grila) {
    await prisma.question.create({
      data: {
        prompt: g.prompt,
        isPublished: true,
        difficulty: 1,
        options: { create: g.options.map((text, position) => ({ text, position, isCorrect: position === g.correct })) },
      },
    });
  }
  for (const r of rapide) {
    await prisma.question.create({
      data: {
        prompt: r.prompt,
        isPublished: true,
        difficulty: 1,
        options: { create: [{ text: r.answer, position: 0, isCorrect: true }] },
      },
    });
  }
  const n = await prisma.question.count({ where: { isPublished: true } });
  console.log(`seeded: ${grila.length} grila + ${rapide.length} rapide, published total ${n}`);
}

main().finally(() => prisma.$disconnect());
