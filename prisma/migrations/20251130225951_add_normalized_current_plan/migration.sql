-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('FIXED', 'VARIABLE', 'TIME_OF_USE', 'OTHER');

-- DropForeignKey
ALTER TABLE "Entry" DROP CONSTRAINT "Entry_houseId_fkey";

-- DropForeignKey
ALTER TABLE "EntryStatusLog" DROP CONSTRAINT "EntryStatusLog_entryId_fkey";

-- DropForeignKey
ALTER TABLE "ManualUsageUpload" DROP CONSTRAINT "ManualUsageUpload_userId_fkey";

-- AlterTable
ALTER TABLE "ManualUsageUpload" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TestimonialSubmission" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "NormalizedCurrentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "homeId" TEXT,
    "providerName" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "rateType" "RateType" NOT NULL,
    "rateStructure" JSONB NOT NULL,
    "flatEnergyRateCents" DECIMAL(8,4),
    "baseMonthlyFeeCents" DECIMAL(10,2),
    "termLengthMonths" INTEGER,
    "contractEndDate" TIMESTAMP(3),
    "sourceModule" TEXT NOT NULL DEFAULT 'current-plan',
    "sourceEntryId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormalizedCurrentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NormalizedCurrentPlan_userId_idx" ON "NormalizedCurrentPlan"("userId");

-- CreateIndex
CREATE INDEX "NormalizedCurrentPlan_homeId_idx" ON "NormalizedCurrentPlan"("homeId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedCurrentPlan_sourceModule_sourceEntryId_key" ON "NormalizedCurrentPlan"("sourceModule", "sourceEntryId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryStatusLog" ADD CONSTRAINT "EntryStatusLog_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualUsageUpload" ADD CONSTRAINT "ManualUsageUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
