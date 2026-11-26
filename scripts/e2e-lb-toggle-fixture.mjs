// E2E fixture for the clasament toggle (throwaway DB only).
// Four players, one per scoring path, so both orders are provable:
//   Turnist   -> tower answers only      (points from turn)
//   Carciumar -> carciuma answers only   (points from carciuma)
//   Blitzer   -> a 90s run + quiz session(PRC rating)
//   Vechi     -> quiz session only       (legacy: rating, no points)
// Usage: DATABASE_URL=postgresql://postgres:e2e@127.0.0.1:55433/mahalador node scripts/e2e-lb-toggle-fixture.mjs
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const qs = (await p.question.findMany({ where: { isPublished: true }, include: { options: true }, take: 60 })).filter(
  (q) => q.options.length === 4,
);
if (qs.length < 6) throw new Error("not enough grila questions seeded");

const user = async (email, displayName) => {
  const u = await p.user.findUnique({ where: { email } });
  if (!u) throw new Error(`register ${email} first`);
  await p.carciumaPlayer.deleteMany({ where: { userId: u.id } });
  await p.towerPlayer.deleteMany({ where: { userId: u.id } });
  await p.trainRun.deleteMany({ where: { userId: u.id } });
  await p.quizSession.deleteMany({ where: { userId: u.id } });
  return u;
};

const turn = await user("turnist@example.test", "Turnist");
const carciuma = await user("carciumar@example.test", "Carciumar");
const blitzer = await user("blitzer@example.test", "Blitzer");
const vechi = await user("vechi@example.test", "Vechi");

// --- tower: 2 games x 5 rounds, all correct, 100ms -> ~139 p each (1390)
for (let g = 0; g < 2; g++) {
  const game = await p.towerGame.create({ data: { hostId: turn.id, status: "COMPLETED", plan: {}, currentRound: 5 } });
  const seat = await p.towerPlayer.create({ data: { gameId: game.id, userId: turn.id, name: "Turnist", seat: 0 } });
  for (let r = 0; r < 5; r++) {
    const q = qs[r];
    await p.towerAnswer.create({
      data: {
        gameId: game.id,
        playerId: seat.id,
        round: r,
        questionId: q.id,
        selectedOptionId: (q.options.find((o) => o.isCorrect) ?? q.options[0]).id,
        isCorrect: true,
        elapsedMilliseconds: 100,
        score: 1,
        rungs: r,
      },
    });
  }
}

// --- carciuma: 6 correct answers at 4000ms -> ~95 p each (570)
const cgame = await p.carciumaGame.create({
  data: { hostId: carciuma.id, status: "COMPLETED", plan: {}, currentRound: 6 },
});
const cseat = await p.carciumaPlayer.create({
  data: { gameId: cgame.id, userId: carciuma.id, name: "Carciumar", seat: 0 },
});
for (let r = 0; r < 6; r++) {
  const q = qs[r];
  await p.carciumaAnswer.create({
    data: {
      gameId: cgame.id,
      playerId: cseat.id,
      round: r,
      questionId: q.id,
      selectedOptionId: (q.options.find((o) => o.isCorrect) ?? q.options[0]).id,
      isCorrect: true,
      elapsedMilliseconds: 4000,
      score: 1,
    },
  });
}

// --- blitzer: one 90s run worth 900 points, plus a perfect quiz session (PRC 10000)
await p.trainRun.create({ data: { userId: blitzer.id, correct: 7, total: 9, score: 900 } });
const perfect = async (u) => {
  const s = await p.quizSession.create({
    data: { userId: u.id, questionCount: qs.length, status: "COMPLETED", completedAt: new Date(), correctCount: qs.length },
  });
  for (const q of qs) {
    await p.sessionAnswer.create({
      data: {
        quizSessionId: s.id,
        questionId: q.id,
        selectedOptionId: (q.options.find((o) => o.isCorrect) ?? q.options[0]).id,
        isCorrect: true,
        elapsedMilliseconds: 1500,
      },
    });
  }
};
await perfect(blitzer);

// --- vechi: only a quiz session -> rating, zero points
await perfect(vechi);

console.log("fixture ok");
await p.$disconnect();
