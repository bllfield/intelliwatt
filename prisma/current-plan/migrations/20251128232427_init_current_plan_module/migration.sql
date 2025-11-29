-- CreateEnum
CREATE TYPE "CurrentPlanRateType" AS ENUM ('FIXED', 'VARIABLE', 'TIME_OF_USE', 'OTHER');

-- CreateTable
CREATE TABLE "CurrentPlanManualEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT,
    "providerName" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "rateType" "CurrentPlanRateType" NOT NULL,
    "energyRateCents" DECIMAL(8,4),
    "baseMonthlyFee" DECIMAL(8,2),
    "billCreditDollars" DECIMAL(8,2),
    "termLengthMonths" INTEGER,
    "contractEndDate" TIMESTAMP(3),
    "earlyTerminationFee" DECIMAL(8,2),
    "esiId" TEXT,
    "accountNumberLast4" TEXT,
    "notes" TEXT,
    "rateStructure" JSONB,
    "normalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentPlanManualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentPlanBillUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "billData" BYTEA NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrentPlanBillUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrentPlanManualEntry_userId_idx" ON "CurrentPlanManualEntry"("userId");

-- CreateIndex
CREATE INDEX "CurrentPlanManualEntry_userId_houseId_idx" ON "CurrentPlanManualEntry"("userId", "houseId");

-- CreateIndex
CREATE INDEX "CurrentPlanBillUpload_userId_idx" ON "CurrentPlanBillUpload"("userId");

-- CreateIndex
CREATE INDEX "CurrentPlanBillUpload_userId_houseId_idx" ON "CurrentPlanBillUpload"("userId", "houseId");
