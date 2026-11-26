-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastIp" VARCHAR(64);

-- CreateTable
CREATE TABLE "IpRule" (
    "ip" VARCHAR(64) NOT NULL,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpRule_pkey" PRIMARY KEY ("ip")
);
