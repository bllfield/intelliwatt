-- CreateTable
CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "utilityId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "supplier" TEXT,
    "supplierPUCT" TEXT,
    "planName" TEXT,
    "termMonths" INTEGER,
    "rate500" DOUBLE PRECISION,
    "rate1000" DOUBLE PRECISION,
    "rate2000" DOUBLE PRECISION,
    "cancelFee" TEXT,
    "eflUrl" TEXT,
    "tosUrl" TEXT,
    "yracUrl" TEXT,
    "isUtilityTariff" BOOLEAN NOT NULL DEFAULT false,
    "tariffStructure" JSONB,
    "customerCharge" DOUBLE PRECISION,
    "minimumBill" DOUBLE PRECISION,
    "effectiveStart" TIMESTAMP(3),
    "effectiveEnd" TIMESTAMP(3),
    "sourceRateUrl" TEXT,
    "sourceParentUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_utilityId_state_supplier_planName_termMonths_isUtilityTariff_key" ON "RatePlan"("utilityId", "state", "supplier", "planName", "termMonths", "isUtilityTariff");

-- CreateIndex
CREATE INDEX "RatePlan_utilityId_state_termMonths_idx" ON "RatePlan"("utilityId", "state", "termMonths");

