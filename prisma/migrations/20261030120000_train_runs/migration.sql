-- 2-minute training blitz results: one row per finished run, so the clasament
-- page can rank today's best run per player.
CREATE TABLE "TrainRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "correct" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainRun_createdAt_idx" ON "TrainRun"("createdAt");
CREATE INDEX "TrainRun_userId_createdAt_idx" ON "TrainRun"("userId", "createdAt");

ALTER TABLE "TrainRun" ADD CONSTRAINT "TrainRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
