-- Reports for questions served from the JSON bank (no Question row exists).

CREATE TABLE "BankQuestionReport" (
    "id" UUID NOT NULL,
    "bankId" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankQuestionReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankQuestionReport_bankId_userId_key" ON "BankQuestionReport"("bankId", "userId");
CREATE INDEX "BankQuestionReport_createdAt_idx" ON "BankQuestionReport"("createdAt");
CREATE INDEX "BankQuestionReport_userId_createdAt_idx" ON "BankQuestionReport"("userId", "createdAt");

ALTER TABLE "BankQuestionReport" ADD CONSTRAINT "BankQuestionReport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
