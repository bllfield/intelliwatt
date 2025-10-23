/* Postgres migration for TDSP rate snapshots */
CREATE TABLE IF NOT EXISTS "TdspRateSnapshot" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tdsp"        "TdspCode" NOT NULL,
  "sourceUrl"   TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  "effectiveAt" TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tdsp_rate_snapshot_tdsp_created_idx ON "TdspRateSnapshot" ("tdsp","createdAt");
CREATE INDEX IF NOT EXISTS tdsp_rate_snapshot_effective_idx ON "TdspRateSnapshot" ("effectiveAt");
