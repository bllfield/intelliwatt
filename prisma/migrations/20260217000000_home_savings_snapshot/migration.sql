-- CreateTable
CREATE TABLE "HomeSavingsSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "houseAddressId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contractEndDate" TIMESTAMP(3),
    "monthsRemainingOnContract" INTEGER,
    "earlyTerminationFeeDollars" DOUBLE PRECISION,
    "wouldIncurEtfIfSwitchNow" BOOLEAN,
    "savingsNext12MonthsNoEtf" DOUBLE PRECISION,
    "savingsUntilContractEndNoEtf" DOUBLE PRECISION,
    "savingsNext12MonthsNetEtf" DOUBLE PRECISION,
    "savingsUntilContractEndNetEtf" DOUBLE PRECISION,
    "currentAnnualCostDollars" DOUBLE PRECISION,
    "bestAnnualCostDollars" DOUBLE PRECISION,
    "bestRatePlanId" TEXT,
    "bestOfferId" TEXT,
    "bestTermMonths" INTEGER,

    CONSTRAINT "HomeSavingsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeSavingsSnapshot_houseAddressId_key" ON "HomeSavingsSnapshot"("houseAddressId");

-- CreateIndex
CREATE INDEX "HomeSavingsSnapshot_userId_idx" ON "HomeSavingsSnapshot"("userId");

-- CreateIndex
CREATE INDEX "HomeSavingsSnapshot_computedAt_idx" ON "HomeSavingsSnapshot"("computedAt");

-- CreateIndex
CREATE INDEX "HomeSavingsSnapshot_contractEndDate_idx" ON "HomeSavingsSnapshot"("contractEndDate");

-- AddForeignKey
ALTER TABLE "HomeSavingsSnapshot" ADD CONSTRAINT "HomeSavingsSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeSavingsSnapshot" ADD CONSTRAINT "HomeSavingsSnapshot_houseAddressId_fkey" FOREIGN KEY ("houseAddressId") REFERENCES "HouseAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

