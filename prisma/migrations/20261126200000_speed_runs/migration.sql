-- Speed board ("Măsoară viteza" / PRC sprint) results.

CREATE TABLE "SpeedRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "correct" INTEGER NOT NULL,
    "wrong" INTEGER NOT NULL DEFAULT 0,
    "seconds" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeedRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpeedRun_correct_createdAt_idx" ON "SpeedRun"("correct", "createdAt");
CREATE INDEX "SpeedRun_userId_createdAt_idx" ON "SpeedRun"("userId", "createdAt");

ALTER TABLE "SpeedRun" ADD CONSTRAINT "SpeedRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
