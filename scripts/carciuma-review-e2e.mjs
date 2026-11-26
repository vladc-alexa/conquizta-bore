// Seeds a finished Carciuma sitting (3 patrons, 4 rounds: 2 grilă + 2 rapidă)
// so the post-game review section can be checked without playing 4 rounds.
// Usage: DATABASE_URL=... BASE=http://localhost:3214 node scripts/carciuma-review-e2e.mjs
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3214";
const prisma = new PrismaClient();

const email = `review-${Date.now()}@example.com`;
const password = "parola1234";

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ displayName: "VladRev", email, password }),
});
const regBody = await reg.json().catch(() => ({}));
console.log("register", reg.status, JSON.stringify(regBody).slice(0, 120));
const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];

const user = await prisma.user.findUnique({ where: { email } });
if (!user) throw new Error("user not created");

const opt = (n) => ({ id: crypto.randomUUID(), text: n });
const plan = [];
for (let i = 0; i < 2; i++) {
  const options = [opt("București"), opt("Cluj-Napoca"), opt("Timișoara"), opt("Iași")];
  plan.push({
    mode: "grila",
    questionId: crypto.randomUUID(),
    prompt: `Grila ${i + 1}: care este capitala României?`,
    options,
    correctOptionId: options[0].id,
  });
}
for (let i = 0; i < 2; i++) {
  plan.push({
    mode: "rapide",
    questionId: crypto.randomUUID(),
    prompt: `Rapidă ${i + 1}: în ce an s-a format România Mare?`,
    answer: 1918,
    responseType: "an",
  });
}

const game = await prisma.carciumaGame.create({
  data: {
    hostId: user.id,
    status: "COMPLETED",
    plan,
    currentRound: 3,
    startedAt: new Date(Date.now() - 600_000),
    completedAt: new Date(),
    players: {
      create: [
        { userId: user.id, name: "VladRev", seat: 0, score: 700 },
        { name: "Ornellaia", seat: 1, isBot: true, score: 500, drinks: 1 },
        { name: "Gică", seat: 2, isBot: true, score: 300, drinks: 2 },
      ],
    },
  },
  include: { players: true },
});

const seats = Object.fromEntries(game.players.map((p) => [p.name, p]));
const rows = [
  // round 0 grilă: Vlad right, Ornellaia wrong, Gică silent
  { name: "VladRev", round: 0, selectedOptionId: plan[0].options[0].id, isCorrect: true, score: 300, elapsedMilliseconds: 2100 },
  { name: "Ornellaia", round: 0, selectedOptionId: plan[0].options[2].id, isCorrect: false, score: 0, elapsedMilliseconds: 4300, drank: true },
  { name: "Gică", round: 0, selectedOptionId: null, isCorrect: false, score: 0, elapsedMilliseconds: 0 },
  // round 1 grilă
  { name: "Ornellaia", round: 1, selectedOptionId: plan[1].options[0].id, isCorrect: true, score: 280, elapsedMilliseconds: 1900 },
  { name: "Gică", round: 1, selectedOptionId: plan[1].options[1].id, isCorrect: false, score: 0, elapsedMilliseconds: 3200, drank: true },
  // round 2 rapidă
  { name: "VladRev", round: 2, answerText: "1918", isCorrect: true, score: 260, elapsedMilliseconds: 1500 },
  { name: "Gică", round: 2, answerText: "1919", isCorrect: false, score: 0, elapsedMilliseconds: 2600, drank: true },
  // round 3 rapidă
  { name: "VladRev", round: 3, answerText: "1918", isCorrect: true, score: 240, elapsedMilliseconds: 1700 },
  { name: "Ornellaia", round: 3, answerText: "1918", isCorrect: true, score: 220, elapsedMilliseconds: 2500 },
];

for (const r of rows) {
  await prisma.carciumaAnswer.create({
    data: {
      gameId: game.id,
      playerId: seats[r.name].id,
      round: r.round,
      questionId: plan[r.round].questionId,
      selectedOptionId: r.selectedOptionId ?? null,
      answerText: r.answerText ?? null,
      isCorrect: r.isCorrect,
      score: r.score,
      elapsedMilliseconds: r.elapsedMilliseconds,
      drank: r.drank ?? false,
    },
  });
}

const state = await fetch(`${BASE}/api/carciuma/${game.id}`, { headers: { cookie } }).then((r) => r.json());
const review = state?.game?.review ?? state?.review ?? [];
console.log("GAME_ID", game.id);
console.log("COOKIE", cookie);
console.log("REVIEW_ROUNDS", review.length);
console.log(JSON.stringify(review.map((r) => ({ round: r.round, mode: r.mode, prompt: r.prompt, correct: r.correctAnswer, rows: r.rows.map((x) => `${x.name}:${x.answer ?? "—"}${x.correct ? "✓" : "✗"}`) })), null, 1));
await prisma.$disconnect();
