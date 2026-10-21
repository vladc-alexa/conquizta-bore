-- Rocks thrown between climbers: one per player per round; two hits in the same
-- round on the same climber knock him down a rung.
CREATE TABLE "TowerRock" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "throwerId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowerRock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TowerRock_gameId_round_throwerId_key" ON "TowerRock"("gameId", "round", "throwerId");
CREATE INDEX "TowerRock_gameId_round_targetId_idx" ON "TowerRock"("gameId", "round", "targetId");

ALTER TABLE "TowerRock" ADD CONSTRAINT "TowerRock_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "TowerGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
