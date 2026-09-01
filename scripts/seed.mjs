// Demo seed: admin user + leaderboard entries + a chat message.
// Local:  npm run seed   (reads .env)
// Coolify: npm run seed  (env comes from the container)
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@conquizta.ro" },
    update: {},
    create: {
      email: "admin@conquizta.ro",
      displayName: "Demo",
      passwordHash: hashPassword("demo1234"),
    },
  });
  console.log(`user ${admin.email} (demo1234) -> ${admin.displayName}`);

  const testUser = await prisma.user.upsert({
    where: { email: "test@test.com" },
    update: {
      passwordHash: hashPassword("test"),
      displayName: "test",
    },
    create: {
      email: "test@test.com",
      displayName: "test",
      passwordHash: hashPassword("test"),
    },
  });
  console.log(`user ${testUser.email} (test) created/updated`);

  const demoNames = ["Rovi", "Lxcxfxr13", "Thinker", "St0ne", "BoreKing"];
  const demoUsers = [];
  for (const n of demoNames) {
    let u = await prisma.user.findUnique({ where: { displayName: n } });
    if (!u) u = await prisma.user.create({ data: { displayName: n } });
    demoUsers.push(u);
  }

  // wipe previous demo sessions (fresh re-seed of PRC data)
  await prisma.sessionAnswer.deleteMany({
    where: { quizSession: { user: { displayName: { in: demoNames } } } },
  });
  await prisma.quizSession.deleteMany({
    where: { user: { displayName: { in: demoNames } } },
  });

  // shared question pools so rapide ranks actually compute
  const grilaPool = await prisma.question.findMany({
    where: { isPublished: true, options: { some: {} } },
    take: 100,
    select: { id: true, options: { select: { id: true, isCorrect: true } } },
  });
  const grilaQ = grilaPool.filter((q) => q.options.length === 4 && q.options.filter((o) => o.isCorrect).length === 1).slice(0, 50);
  const rapidePool = await prisma.question.findMany({
    where: { isPublished: true, options: { some: { isCorrect: true } } },
    take: 200,
    select: { id: true, options: { select: { text: true, isCorrect: true } } },
  });
  const rapideQ = rapidePool
    .map((q) => ({ id: q.id, answer: parseInt(q.options.find((o) => o.isCorrect).text.trim(), 10) }))
    .filter((q) => !isNaN(q.answer))
    .slice(0, 50);

  const now = Date.now();
  const RAPIDE_ROUNDS = 6; // 5 users × 6 rounds = 30 answers/question ≥ MIN_ANSWERS(20)
  for (const u of demoUsers) {
    // grila session: ~75% correct
    const gSess = await prisma.quizSession.create({
      data: { userId: u.id, status: "COMPLETED", questionCount: grilaQ.length, startedAt: new Date(now - 3600_000), completedAt: new Date(now) },
    });
    let gCorrect = 0;
    for (let i = 0; i < grilaQ.length; i++) {
      const q = grilaQ[i];
      const correctId = q.options.find((o) => o.isCorrect).id;
      const right = Math.random() < 0.75;
      if (right) gCorrect++;
      const chosen = right ? correctId : q.options[Math.floor(Math.random() * q.options.length)].id;
      await prisma.sessionAnswer.create({
        data: {
          quizSessionId: gSess.id,
          questionId: q.id,
          selectedOptionId: chosen,
          isCorrect: right,
          elapsedMilliseconds: 3000 + Math.floor(Math.random() * 5000),
          answeredAt: new Date(now - (grilaQ.length - i) * 30_000),
        },
      });
    }
    await prisma.quizSession.update({ where: { id: gSess.id }, data: { correctCount: gCorrect } });

    // rapide: multiple rounds so every question gets enough answers for ranks
    let rCorrect = 0;
    let rTotal = 0;
    for (let round = 0; round < RAPIDE_ROUNDS; round++) {
      const rSess = await prisma.quizSession.create({
        data: { userId: u.id, status: "COMPLETED", questionCount: rapideQ.length, startedAt: new Date(now - 3600_000), completedAt: new Date(now) },
      });
      for (let i = 0; i < rapideQ.length; i++) {
        const q = rapideQ[i];
        const exact = Math.random() < 0.6;
        const val = exact ? q.answer : q.answer + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 5));
        if (val === q.answer) rCorrect++;
        rTotal++;
        await prisma.sessionAnswer.create({
          data: {
            quizSessionId: rSess.id,
            questionId: q.id,
            submittedAnswer: String(val),
            isCorrect: val === q.answer,
            elapsedMilliseconds: 2000 + Math.floor(Math.random() * 7000),
            answeredAt: new Date(now - (round * rapideQ.length + i) * 30_000),
          },
        });
      }
      await prisma.quizSession.update({ where: { id: rSess.id }, data: { correctCount: rCorrect } });
    }
    console.log(`seeded PRC data for ${u.displayName} (grila ${gCorrect}/${grilaQ.length}, rapide ${rCorrect}/${rTotal})`);
  }

  const chatCount = await prisma.chatMessage.count();
  if (chatCount === 0) {
    await prisma.chatMessage.create({
      data: {
        userId: admin.id,
        authorName: admin.displayName,
        text: "Salut! Bine ai venit în chat. 👋",
      },
    });
  }

  console.log("seed done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
