// Demo seed: admin user + a test user + a starter chat message.
// NOTE: no leaderboard/PRC demo data is seeded anymore — scores come only
// from real games (the old demo-session seeding was removed).
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
