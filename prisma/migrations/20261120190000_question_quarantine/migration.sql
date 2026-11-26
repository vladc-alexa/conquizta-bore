-- Quarantine: pull questions out of rotation for review.
-- Quarantined rows keep isPublished=false so every game query already skips them.
ALTER TABLE "Question" ADD COLUMN "quarantinedAt" TIMESTAMP(3),
ADD COLUMN "quarantineReason" VARCHAR(24);

CREATE INDEX "Question_quarantinedAt_idx" ON "Question"("quarantinedAt");
