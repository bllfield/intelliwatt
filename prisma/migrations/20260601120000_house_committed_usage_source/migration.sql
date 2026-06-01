-- CreateEnum
CREATE TYPE "HouseCommittedUsageSource" AS ENUM ('SMT', 'GREEN_BUTTON');

-- AlterTable
ALTER TABLE "HouseAddress" ADD COLUMN "committedUsageSource" "HouseCommittedUsageSource",
ADD COLUMN "committedUsageSourceAt" TIMESTAMP(3);
