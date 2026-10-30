// Visual fixture only (throwaway DB): three ranked players so /leaderboard
// renders real rows at phone width. Usage:
//   DATABASE_URL=postgresql://postgres:e2e@127.0.0.1:55433/mahalador node scripts/seed-lb-visual.mjs
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const PW = "lb-visual-pass";
const players = ["Andrei Longname", "Mihai", "Cristina Popescu"];

// grilă = exactly 4 options (the app derives the type from option count)
const all = await p.question.findMany({
  where: { isPublished: true },
  include: { options: true },
  take: 40,
});
const qs = all.filter((q) => q.options.length === 4).slice(0, 3);
if (!qs.length) throw new Error("no grilă questions seeded");

for (const [i, name] of players.entries()) {
  const email = `lb-vis-${i}@example.test`;
  await p.user.deleteMany({ where: { email } });
  const u = await p.user.create({
    data: { email, displayName: name },
  });
  const s = await p.quizSession.create({
    data: { userId: u.id, questionCount: qs.length, status: "COMPLETED", completedAt: new Date(), correctCount: qs.length },
  });
  for (const q of qs) {
    const right = q.options.find((o) => o.isCorrect) ?? q.options[0];
    await p.sessionAnswer.create({
      data: {
        quizSessionId: s.id,
        questionId: q.id,
        selectedOptionId: right.id,
        isCorrect: true,
        elapsedMilliseconds: 3000 + i * 900,
      },
    });
  }
}
console.log(`seeded ${players.length} ranked players`);
await p.$disconnect();
