/*
  Corrective migration.

  Why:
  - Production DB has _prisma_migrations entries indicating that
    `20251211073247_efl_plan_rules_persistence` did not apply (0 steps)
    due to a pre-existing `GreenButtonUpload` table.
  - As a result, RatePlan is missing EFL persistence columns used by the app
    (`rateStructure`, `eflPdfSha256`, etc.).

  What:
  - Add missing RatePlan columns with IF NOT EXISTS (idempotent).
  - Add unique index on eflPdfSha256 (safe: new nullable column).
*/

-- RatePlan EFL persistence columns (idempotent)
ALTER TABLE "RatePlan"
  ADD COLUMN IF NOT EXISTS "eflPdfSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "repPuctCertificate" TEXT,
  ADD COLUMN IF NOT EXISTS "eflVersionCode" TEXT,
  ADD COLUMN IF NOT EXISTS "eflSourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "eflValidationIssues" JSONB,
  ADD COLUMN IF NOT EXISTS "rateStructure" JSONB;

-- Boolean flag (needs NOT NULL default)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'RatePlan'
      AND column_name = 'eflRequiresManualReview'
  ) THEN
    ALTER TABLE "RatePlan"
      ADD COLUMN "eflRequiresManualReview" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Unique index for fingerprinting (safe: allows multiple NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS "RatePlan_eflPdfSha256_key"
  ON "RatePlan" ("eflPdfSha256");


