-- CreateTable
CREATE TABLE "UpgradeLedger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT,
    "houseState" TEXT,
    "tdspRegion" TEXT,
    "scenarioId" TEXT,
    "scenarioEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "upgradeType" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "units" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "effectiveEndDate" TIMESTAMP(3),
    "vendorId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "costJson" JSONB,
    "measuredStartDate" TIMESTAMP(3),
    "measuredEndDate" TIMESTAMP(3),
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "inputsJson" JSONB,
    "notes" TEXT,
    "impactMethod" TEXT,
    "deltaKwhAnnualMeasured" DOUBLE PRECISION,
    "deltaKwhAnnualSimulated" DOUBLE PRECISION,
    "deltaKwhMonthlyMeasuredJson" JSONB,
    "deltaKwhMonthlySimulatedJson" JSONB,
    "confidence" DOUBLE PRECISION,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "calcVersion" TEXT,
    "normalizationVersion" TEXT,

    CONSTRAINT "UpgradeLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpgradeLedger_userId_idx" ON "UpgradeLedger"("userId");

-- CreateIndex
CREATE INDEX "UpgradeLedger_houseId_idx" ON "UpgradeLedger"("houseId");

-- CreateIndex
CREATE INDEX "UpgradeLedger_status_idx" ON "UpgradeLedger"("status");

-- CreateIndex
CREATE INDEX "UpgradeLedger_source_idx" ON "UpgradeLedger"("source");

-- CreateIndex
CREATE INDEX "UpgradeLedger_impactMethod_idx" ON "UpgradeLedger"("impactMethod");

-- CreateIndex
CREATE INDEX "UpgradeLedger_houseState_idx" ON "UpgradeLedger"("houseState");

-- CreateIndex
CREATE INDEX "UpgradeLedger_tdspRegion_idx" ON "UpgradeLedger"("tdspRegion");

-- CreateIndex
CREATE INDEX "UpgradeLedger_scenarioId_idx" ON "UpgradeLedger"("scenarioId");

-- CreateIndex
CREATE INDEX "UpgradeLedger_scenarioEventId_idx" ON "UpgradeLedger"("scenarioEventId");

-- CreateIndex
CREATE INDEX "UpgradeLedger_upgradeType_idx" ON "UpgradeLedger"("upgradeType");

-- CreateIndex
CREATE INDEX "UpgradeLedger_changeType_idx" ON "UpgradeLedger"("changeType");

-- CreateIndex
CREATE INDEX "UpgradeLedger_effectiveDate_idx" ON "UpgradeLedger"("effectiveDate");

-- CreateIndex
CREATE INDEX "UpgradeLedger_userId_upgradeType_idx" ON "UpgradeLedger"("userId", "upgradeType");

-- CreateIndex
CREATE INDEX "UpgradeLedger_userId_upgradeType_changeType_idx" ON "UpgradeLedger"("userId", "upgradeType", "changeType");
