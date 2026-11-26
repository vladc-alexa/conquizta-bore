-- La Carciuma also serves rapide rounds: the typed number has to be kept so the
-- round table can show what each patron actually guessed.
ALTER TABLE "CarciumaAnswer" ADD COLUMN "answerText" VARCHAR(40);
