-- CreateTable
CREATE TABLE "GameInvite" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "gameId" UUID NOT NULL,
    "fromId" UUID NOT NULL,
    "fromName" VARCHAR(32) NOT NULL,
    "toId" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameInvite_toId_status_idx" ON "GameInvite"("toId", "status");

-- CreateIndex
CREATE INDEX "GameInvite_expiresAt_idx" ON "GameInvite"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameInvite_gameId_toId_status_key" ON "GameInvite"("gameId", "toId", "status");

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameInvite" ADD CONSTRAINT "GameInvite_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
