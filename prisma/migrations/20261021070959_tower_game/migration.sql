-- CreateEnum
CREATE TYPE "TowerStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "TowerGame" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "status" "TowerStatus" NOT NULL DEFAULT 'WAITING',
    "plan" JSONB NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "roundStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "winnerId" UUID,

    CONSTRAINT "TowerGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TowerPlayer" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "userId" UUID,
    "name" VARCHAR(32) NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "seat" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rungs" INTEGER NOT NULL DEFAULT 0,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,
    "fellRound" INTEGER,

    CONSTRAINT "TowerPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TowerAnswer" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rungs" INTEGER NOT NULL DEFAULT 0,
    "elapsedMilliseconds" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowerAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TowerGame_status_createdAt_idx" ON "TowerGame"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TowerGame_hostId_idx" ON "TowerGame"("hostId");

-- CreateIndex
CREATE INDEX "TowerPlayer_gameId_idx" ON "TowerPlayer"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "TowerPlayer_gameId_seat_key" ON "TowerPlayer"("gameId", "seat");

-- CreateIndex
CREATE INDEX "TowerAnswer_gameId_idx" ON "TowerAnswer"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "TowerAnswer_gameId_playerId_round_key" ON "TowerAnswer"("gameId", "playerId", "round");

-- AddForeignKey
ALTER TABLE "TowerGame" ADD CONSTRAINT "TowerGame_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TowerPlayer" ADD CONSTRAINT "TowerPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TowerGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TowerPlayer" ADD CONSTRAINT "TowerPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TowerAnswer" ADD CONSTRAINT "TowerAnswer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TowerGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TowerAnswer" ADD CONSTRAINT "TowerAnswer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TowerPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
