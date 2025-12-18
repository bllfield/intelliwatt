-- Add QueueKind + schema-level dedupeKey for EflParseReviewQueue.
-- This supports reusing the same table for multiple queue types (EFL parsing + plan calc quarantine),
-- while keeping existing writers compatible (dedupeKey defaults and is filled via trigger for EFL_PARSE).

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QueueKind') THEN
    CREATE TYPE "QueueKind" AS ENUM ('EFL_PARSE', 'PLAN_CALC_QUARANTINE');
  END IF;
END$$;

-- AlterTable
ALTER TABLE "EflParseReviewQueue"
ADD COLUMN IF NOT EXISTS "kind" "QueueKind" NOT NULL DEFAULT 'EFL_PARSE',
ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "ratePlanId" TEXT;

-- Backfill existing rows so dedupeKey is non-empty before adding uniqueness.
UPDATE "EflParseReviewQueue"
SET "dedupeKey" = "eflPdfSha256"
WHERE "dedupeKey" IS NULL OR "dedupeKey" = '';

-- Ensure future EFL_PARSE inserts/updates automatically inherit dedupeKey=eflPdfSha256
-- unless explicitly provided (PLAN_CALC_QUARANTINE should set its own dedupeKey).
CREATE OR REPLACE FUNCTION "EflParseReviewQueue_fill_dedupeKey"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kind" = 'EFL_PARSE' AND (NEW."dedupeKey" IS NULL OR NEW."dedupeKey" = '') THEN
    NEW."dedupeKey" := NEW."eflPdfSha256";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "EflParseReviewQueue_fill_dedupeKey" ON "EflParseReviewQueue";
CREATE TRIGGER "EflParseReviewQueue_fill_dedupeKey"
BEFORE INSERT OR UPDATE ON "EflParseReviewQueue"
FOR EACH ROW
EXECUTE FUNCTION "EflParseReviewQueue_fill_dedupeKey"();

-- Unique index for schema-level de-dupe per queue kind.
CREATE UNIQUE INDEX IF NOT EXISTS "EflParseReviewQueue_kind_dedupeKey_key"
ON "EflParseReviewQueue" ("kind", "dedupeKey");


