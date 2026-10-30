-- The clasament aggregates answers per player over a time window (today).
CREATE INDEX "CarciumaAnswer_createdAt_idx" ON "CarciumaAnswer"("createdAt");
CREATE INDEX "TowerAnswer_answeredAt_idx" ON "TowerAnswer"("answeredAt");
