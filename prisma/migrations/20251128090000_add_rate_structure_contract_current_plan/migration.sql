-- AlterTable
ALTER TABLE "CurrentPlanManualEntry"
    ALTER COLUMN "energyRateCents" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CurrentPlanManualEntry"
    ADD COLUMN "rateStructure" JSONB;

