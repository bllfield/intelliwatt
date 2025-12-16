-- Fix for failed migration 20251216014000_dedupe_efl_review_queue
-- That migration attempted to create unique indexes but existing duplicate rows prevented it.
--
-- This migration:
-- 1) Marks duplicate OPEN rows as resolved (keeps the newest per key)
-- 2) Creates partial unique indexes that only enforce uniqueness for OPEN rows

-- --- 1) Resolve duplicate OPEN rows by eflUrl (keep newest by updatedAt/createdAt) ---
WITH ranked AS (
  SELECT
    "id",
    "eflUrl",
    ROW_NUMBER() OVER (
      PARTITION BY "eflUrl"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "EflParseReviewQueue"
  WHERE "eflUrl" IS NOT NULL AND "resolvedAt" IS NULL
)
UPDATE "EflParseReviewQueue" q
SET
  "resolvedAt" = NOW(),
  "resolvedBy" = COALESCE(q."resolvedBy", 'migration'),
  "resolutionNotes" = COALESCE(q."resolutionNotes", '') ||
    CASE WHEN q."resolutionNotes" IS NULL OR q."resolutionNotes" = '' THEN '' ELSE E'\n' END ||
    '[AUTO] Resolved as duplicate by migration 20251216014500_fix_dedupe_efl_review_queue'
FROM ranked r
WHERE q."id" = r."id" AND r.rn > 1;

-- --- 2) Resolve duplicate OPEN rows by repPuctCertificate+eflVersionCode (keep newest) ---
WITH ranked AS (
  SELECT
    "id",
    "repPuctCertificate",
    "eflVersionCode",
    ROW_NUMBER() OVER (
      PARTITION BY "repPuctCertificate", "eflVersionCode"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "EflParseReviewQueue"
  WHERE
    "repPuctCertificate" IS NOT NULL AND
    "eflVersionCode" IS NOT NULL AND
    "resolvedAt" IS NULL
)
UPDATE "EflParseReviewQueue" q
SET
  "resolvedAt" = NOW(),
  "resolvedBy" = COALESCE(q."resolvedBy", 'migration'),
  "resolutionNotes" = COALESCE(q."resolutionNotes", '') ||
    CASE WHEN q."resolutionNotes" IS NULL OR q."resolutionNotes" = '' THEN '' ELSE E'\n' END ||
    '[AUTO] Resolved as duplicate by migration 20251216014500_fix_dedupe_efl_review_queue'
FROM ranked r
WHERE q."id" = r."id" AND r.rn > 1;

-- --- 3) Create partial unique indexes for OPEN rows only ---
DROP INDEX IF EXISTS "EflParseReviewQueue_open_eflUrl_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EflParseReviewQueue_open_eflUrl_key"
ON "EflParseReviewQueue" ("eflUrl")
WHERE "eflUrl" IS NOT NULL AND "resolvedAt" IS NULL;

DROP INDEX IF EXISTS "EflParseReviewQueue_repPuctCertificate_eflVersionCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EflParseReviewQueue_open_repPuctCertificate_eflVersionCode_key"
ON "EflParseReviewQueue" ("repPuctCertificate", "eflVersionCode")
WHERE
  "repPuctCertificate" IS NOT NULL AND
  "eflVersionCode" IS NOT NULL AND
  "resolvedAt" IS NULL;


