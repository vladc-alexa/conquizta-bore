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
  for (const n of demoNames) {
    let u = await prisma.user.findUnique({ where: { displayName: n } });
    if (!u) u = await prisma.user.create({ data: { displayName: n } });
    const wins = 3 + Math.floor(Math.random() * 12);
    for (let i = 0; i < wins; i++) {
      await prisma.quizSession.create({
        data: {
          userId: u.id,
          status: "COMPLETED",
          questionCount: 10,
          correctCount: 6 + Math.floor(Math.random() * 5),
          startedAt: new Date(Date.now() - (i + 1) * 3600000),
          completedAt: new Date(Date.now() - i * 3600000),
        },
      });
    }
    console.log(`seeded ${wins} sessions for ${n}`);
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
