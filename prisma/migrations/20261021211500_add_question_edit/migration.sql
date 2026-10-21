-- "Who edited this question?" — an append-only trail of every question write.
-- questionId / editorId go null when the row they point at is deleted; the
-- name and prompt are snapshots, so the trail still reads sensibly afterwards.
CREATE TABLE "QuestionEdit" (
    "id" UUID NOT NULL,
    "questionId" UUID,
    "editorId" UUID,
    "editorName" VARCHAR(32) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "prompt" VARCHAR(1000) NOT NULL,
    "summary" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestionEdit_questionId_createdAt_idx" ON "QuestionEdit"("questionId", "createdAt");
CREATE INDEX "QuestionEdit_editorId_createdAt_idx" ON "QuestionEdit"("editorId", "createdAt");
CREATE INDEX "QuestionEdit_createdAt_idx" ON "QuestionEdit"("createdAt");

ALTER TABLE "QuestionEdit" ADD CONSTRAINT "QuestionEdit_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionEdit" ADD CONSTRAINT "QuestionEdit_editorId_fkey"
  FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
