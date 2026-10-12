-- CreateEnum
CREATE TYPE "DuelStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "Duel" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "guestId" UUID,
    "status" "DuelStatus" NOT NULL DEFAULT 'WAITING',
    "hostScore" INTEGER NOT NULL DEFAULT 0,
    "guestScore" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "roundStartedAt" TIMESTAMP(3),
    "plan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelAnswer" (
    "id" UUID NOT NULL,
    "duelId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "submittedAnswer" TEXT,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "elapsedMilliseconds" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Duel_hostId_idx" ON "Duel"("hostId");

-- CreateIndex
CREATE INDEX "Duel_guestId_idx" ON "Duel"("guestId");

-- CreateIndex
CREATE INDEX "Duel_status_createdAt_idx" ON "Duel"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DuelAnswer_duelId_userId_round_key" ON "DuelAnswer"("duelId", "userId", "round");

-- CreateIndex
CREATE INDEX "DuelAnswer_duelId_idx" ON "DuelAnswer"("duelId");

-- AddForeignKey
ALTER TABLE "Duel" ADD CONSTRAINT "Duel_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duel" ADD CONSTRAINT "Duel_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelAnswer" ADD CONSTRAINT "DuelAnswer_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
