-- Add persisted plan-calc requirements to RatePlan (best-effort auditing + future-proofing).
-- NOTE: This migration is intended for PostgreSQL.

ALTER TABLE "RatePlan"
ADD COLUMN "planCalcVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "planCalcStatus" TEXT,
ADD COLUMN "planCalcReasonCode" TEXT,
ADD COLUMN "requiredBucketKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "supportedFeatures" JSONB,
ADD COLUMN "planCalcDerivedAt" TIMESTAMP(3);


