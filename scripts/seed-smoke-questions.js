// Throwaway-DB fixture for local smoke tests: enough published questions for a
// tower/duel plan (40 grilă with 4 options + 40 rapidă with none).
// Usage: DATABASE_URL=postgres://... node scripts/seed-smoke-questions.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const existing = await prisma.question.count();
  if (existing >= 40) {
    console.log(`already seeded (${existing})`);
    return;
  }
  for (let i = 1; i <= 40; i++) {
    await prisma.question.create({
      data: {
        prompt: `Smoke grilă ${i}: 2+${i} = ?`,
        difficulty: 1,
        isPublished: true,
        options: {
          create: [
            { text: String(2 + i), position: 0, isCorrect: true },
            { text: String(99 + i), position: 1, isCorrect: false },
            { text: String(50 + i), position: 2, isCorrect: false },
            { text: String(7 + i), position: 3, isCorrect: false },
          ],
        },
      },
    });
    await prisma.question.create({
      data: { prompt: `Smoke rapidă ${i}: 3*${i} = ?`, difficulty: 1, isPublished: true },
    });
  }
  console.log("seeded 80");
  await prisma.$disconnect();
})();
