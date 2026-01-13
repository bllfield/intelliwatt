-- Idempotent creation of BillPlanTemplate for the current-plan module.
-- This is safe to run multiple times.
--
-- Usage (PowerShell, repo root):
--   npx prisma db execute --schema prisma/current-plan/schema.prisma --file scripts/sql/current-plan/ensure_bill_plan_template.sql

CREATE TABLE IF NOT EXISTS "BillPlanTemplate" (
  "id" TEXT NOT NULL,
  "providerNameKey" TEXT NOT NULL,
  "planNameKey" TEXT NOT NULL,

  "providerName" TEXT,
  "planName" TEXT,
  "rateType" TEXT,
  "variableIndexType" TEXT,
  "termMonths" INTEGER,
  "contractEndDate" TIMESTAMP(3),
  "earlyTerminationFeeCents" INTEGER,
  "baseChargeCentsPerMonth" INTEGER,

  "energyRateTiersJson" JSONB,
  "timeOfUseConfigJson" JSONB,
  "billCreditsJson" JSONB,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillPlanTemplate_pkey" PRIMARY KEY ("id")
);

-- Mirror Prisma @@unique([providerNameKey, planNameKey])
CREATE UNIQUE INDEX IF NOT EXISTS "BillPlanTemplate_providerNameKey_planNameKey_key"
  ON "BillPlanTemplate"("providerNameKey", "planNameKey");

