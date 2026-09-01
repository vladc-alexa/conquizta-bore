-- CreateTable
CREATE TABLE "QuestionReport" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "userId" UUID,
    "note" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionReport_questionId_idx" ON "QuestionReport"("questionId");

-- AddForeignKey
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionReport" ADD CONSTRAINT "QuestionReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
