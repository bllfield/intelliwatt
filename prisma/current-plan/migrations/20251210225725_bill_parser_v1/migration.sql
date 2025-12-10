-- AlterTable
ALTER TABLE "CurrentPlanManualEntry" ALTER COLUMN "lastConfirmedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ParsedCurrentPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT,
    "sourceUploadId" TEXT,
    "uploadId" TEXT,
    "rawText" TEXT,
    "rawTextSnippet" TEXT,
    "esiid" TEXT,
    "meterNumber" TEXT,
    "providerName" TEXT,
    "tdspName" TEXT,
    "accountNumber" TEXT,
    "esiId" TEXT,
    "accountNumberLast4" TEXT,
    "customerName" TEXT,
    "serviceAddressLine1" TEXT,
    "serviceAddressLine2" TEXT,
    "serviceAddressCity" TEXT,
    "serviceAddressState" TEXT,
    "serviceAddressZip" TEXT,
    "rateType" "CurrentPlanRateType",
    "variableIndexType" TEXT,
    "planName" TEXT,
    "termMonths" INTEGER,
    "termLengthMonths" INTEGER,
    "contractStartDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "earlyTerminationFeeCents" INTEGER,
    "earlyTerminationFee" DECIMAL(8,2),
    "baseChargeCentsPerMonth" INTEGER,
    "energyRateCents" DECIMAL(8,4),
    "baseMonthlyFee" DECIMAL(8,2),
    "billCreditDollars" DECIMAL(8,2),
    "energyRateTiersJson" JSONB,
    "timeOfUseConfigJson" JSONB,
    "billCreditsJson" JSONB,
    "rateStructure" JSONB,
    "billingPeriodStart" TIMESTAMP(3),
    "billingPeriodEnd" TIMESTAMP(3),
    "billIssueDate" TIMESTAMP(3),
    "billDueDate" TIMESTAMP(3),
    "totalAmountDueCents" INTEGER,
    "parserVersion" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParsedCurrentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParsedCurrentPlan_userId_idx" ON "ParsedCurrentPlan"("userId");

-- CreateIndex
CREATE INDEX "ParsedCurrentPlan_userId_houseId_idx" ON "ParsedCurrentPlan"("userId", "houseId");

-- AddForeignKey
ALTER TABLE "ParsedCurrentPlan" ADD CONSTRAINT "ParsedCurrentPlan_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CurrentPlanBillUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
