// Seeds a Carciuma sitting whose round 0 has already been answered by every
// patron: one GET on the state settles the round, so the breather panel (which
// now reveals the correct grilă option, not just the rapidă number) can be
// checked without playing a round in real time.
// Usage: DATABASE_URL=... BASE=http://localhost:3214 node scripts/carciuma-reveal-e2e.mjs
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3214";
const prisma = new PrismaClient();

const email = `reveal-${Date.now()}@example.com`;
const password = "parola1234";

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ displayName: `Rev${Date.now() % 100000}`, email, password }),
});
console.log("register", reg.status);
const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
const user = await prisma.user.findUnique({ where: { email } });
if (!user) throw new Error("user not created");

const opt = (text) => ({ id: crypto.randomUUID(), text });
const options = [opt("București"), opt("Cluj-Napoca"), opt("Timișoara"), opt("Iași")];
const plan = [
  { mode: "grila", questionId: crypto.randomUUID(), prompt: "Care este capitala României?", options, correctOptionId: options[0].id },
  { mode: "rapide", questionId: crypto.randomUUID(), prompt: "În ce an s-a format România Mare?", answer: 1918, responseType: "an" },
  { mode: "grila", questionId: crypto.randomUUID(), prompt: "Al doilea rând, tot capitala", options, correctOptionId: options[0].id },
];

const game = await prisma.carciumaGame.create({
  data: {
    hostId: user.id,
    status: "IN_PROGRESS",
    plan,
    currentRound: 0,
    roundStartedAt: new Date(Date.now() - 60_000),
    startedAt: new Date(Date.now() - 60_000),
    players: {
      create: [
        { userId: user.id, name: "VladRev", seat: 0 },
        { name: "Ornellaia", seat: 1, isBot: true },
        { name: "Gică", seat: 2, isBot: true },
      ],
    },
  },
  include: { players: true },
});
const seats = Object.fromEntries(game.players.map((p) => [p.name, p]));
for (const [name, idx] of [["VladRev", 0], ["Ornellaia", 2], ["Gică", 1]]) {
  await prisma.carciumaAnswer.create({
    data: {
      gameId: game.id,
      playerId: seats[name].id,
      round: 0,
      questionId: plan[0].questionId,
      selectedOptionId: options[idx].id,
      isCorrect: idx === 0,
      score: idx === 0 ? 300 : 0,
      elapsedMilliseconds: 1200 + idx * 700,
      drank: idx !== 0,
    },
  });
}

const state = await fetch(`${BASE}/api/carciuma/${game.id}`, { headers: { cookie } }).then((r) => r.json());
console.log("GAME_ID", game.id);
console.log("COOKIE", cookie);
console.log(
  "LAST_ROUND",
  JSON.stringify({
    mode: state.lastRound?.mode,
    answer: state.lastRound?.answer,
    rows: state.lastRound?.rows?.map((r) => `${r.correct ? "✓" : "✗"} ${r.answer ?? "—"}`),
  })
);
await prisma.$disconnect();
