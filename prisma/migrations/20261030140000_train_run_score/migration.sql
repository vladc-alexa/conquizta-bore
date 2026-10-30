-- Speed matters: a run is ranked by points, not by how many questions it got.
ALTER TABLE "TrainRun" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
