-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isMuted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameColor" VARCHAR(16);
