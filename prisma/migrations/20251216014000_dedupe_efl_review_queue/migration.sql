-- Dedupe guardrails for EflParseReviewQueue
-- Goal: avoid duplicate OPEN review rows when PDFs drift (different sha) but represent the same EFL version.

-- 1) At most one OPEN row per EFL URL (helps when the same link is reprocessed).
CREATE UNIQUE INDEX IF NOT EXISTS "EflParseReviewQueue_open_eflUrl_key"
ON "EflParseReviewQueue" ("eflUrl")
WHERE "eflUrl" IS NOT NULL AND "resolvedAt" IS NULL;

-- 2) At most one row per REP certificate + EFL version (stable across byte-level PDF drift).
CREATE UNIQUE INDEX IF NOT EXISTS "EflParseReviewQueue_repPuctCertificate_eflVersionCode_key"
ON "EflParseReviewQueue" ("repPuctCertificate", "eflVersionCode")
WHERE "repPuctCertificate" IS NOT NULL AND "eflVersionCode" IS NOT NULL;


