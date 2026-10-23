-- CreateEnum
CREATE TYPE "CarciumaStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "CarciumaGame" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "status" "CarciumaStatus" NOT NULL DEFAULT 'WAITING',
    "plan" JSONB NOT NULL,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "roundStartedAt" TIMESTAMP(3),
    "winnerSeat" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarciumaGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarciumaPlayer" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "userId" UUID,
    "name" VARCHAR(32) NOT NULL,
    "seat" INTEGER NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "drinks" INTEGER NOT NULL DEFAULT 0,
    "passedOut" BOOLEAN NOT NULL DEFAULT false,
    "outRound" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarciumaPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarciumaAnswer" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "questionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "elapsedMilliseconds" INTEGER NOT NULL DEFAULT 0,
    "drank" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarciumaAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarciumaGame_status_createdAt_idx" ON "CarciumaGame"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CarciumaGame_hostId_idx" ON "CarciumaGame"("hostId");

-- CreateIndex
CREATE INDEX "CarciumaPlayer_userId_idx" ON "CarciumaPlayer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CarciumaPlayer_gameId_seat_key" ON "CarciumaPlayer"("gameId", "seat");

-- CreateIndex
CREATE INDEX "CarciumaAnswer_gameId_round_idx" ON "CarciumaAnswer"("gameId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "CarciumaAnswer_gameId_round_playerId_key" ON "CarciumaAnswer"("gameId", "round", "playerId");

-- AddForeignKey
ALTER TABLE "CarciumaGame" ADD CONSTRAINT "CarciumaGame_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarciumaPlayer" ADD CONSTRAINT "CarciumaPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CarciumaGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarciumaPlayer" ADD CONSTRAINT "CarciumaPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarciumaAnswer" ADD CONSTRAINT "CarciumaAnswer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CarciumaGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarciumaAnswer" ADD CONSTRAINT "CarciumaAnswer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "CarciumaPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

