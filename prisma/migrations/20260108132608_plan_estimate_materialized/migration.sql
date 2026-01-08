-- CreateTable
CREATE TABLE "PlanEstimateMaterialized" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "houseAddressId" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "inputsSha256" TEXT NOT NULL,
    "monthsCount" INTEGER NOT NULL DEFAULT 12,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "annualCostDollars" DOUBLE PRECISION,
    "monthlyCostDollars" DOUBLE PRECISION,
    "effectiveCentsPerKwh" DOUBLE PRECISION,
    "confidence" TEXT,
    "componentsV2" JSONB,
    "tdspRatesApplied" JSONB,
    "computedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PlanEstimateMaterialized_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanEstimateMaterialized_houseAddressId_idx" ON "PlanEstimateMaterialized"("houseAddressId");

-- CreateIndex
CREATE INDEX "PlanEstimateMaterialized_ratePlanId_idx" ON "PlanEstimateMaterialized"("ratePlanId");

-- CreateIndex
CREATE INDEX "PlanEstimateMaterialized_houseAddressId_ratePlanId_idx" ON "PlanEstimateMaterialized"("houseAddressId", "ratePlanId");

-- CreateIndex
CREATE INDEX "PlanEstimateMaterialized_computedAt_idx" ON "PlanEstimateMaterialized"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEstimateMaterialized_houseAddressId_ratePlanId_inputsSh_key" ON "PlanEstimateMaterialized"("houseAddressId", "ratePlanId", "inputsSha256");

