-- English-first localization: tag every question with its language so the
-- Romanian archive stays recoverable after the English pivot.
-- Default 'ro' backfills the existing corpus; new English rows set 'en'.
ALTER TABLE "Question" ADD COLUMN "language" VARCHAR(2) NOT NULL DEFAULT 'ro';

-- Fast lookup for the English-serving path (language + publish state).
CREATE INDEX "Question_language_isPublished_idx" ON "Question"("language", "isPublished");
