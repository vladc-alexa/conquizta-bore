-- Who is around right now: a heartbeat column on User, updated by open tabs.
-- Additive and nullable — existing rows simply read as "never seen".
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
