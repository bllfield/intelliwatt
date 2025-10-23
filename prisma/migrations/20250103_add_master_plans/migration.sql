/* GPT: Postgres migration for Step 62. Safe to run on empty/non-empty DB. */

-- Enums (create if not exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plansource') THEN
    CREATE TYPE "PlanSource" AS ENUM ('wattbuy', 'manual', 'tdsp_feed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tdspcode') THEN
    CREATE TYPE "TdspCode" AS ENUM ('ONCOR','CENTERPOINT','AEP_NORTH','AEP_CENTRAL','TNMP');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'producttype') THEN
    CREATE TYPE "ProductType" AS ENUM ('fixed','variable','indexed','tou');
  END IF;
END $$;

-- Table
CREATE TABLE IF NOT EXISTS "MasterPlan" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"           "PlanSource" NOT NULL,
  "offerId"          TEXT UNIQUE,                                -- present for wattbuy or external feeds
  "supplierName"     TEXT NOT NULL,
  "supplierPuctNo"   TEXT,
  "tdsp"             "TdspCode" NOT NULL,
  "planName"         TEXT NOT NULL,
  "nameId"           TEXT NOT NULL,                              -- normalized join key (Step 61)
  "planId"           TEXT NOT NULL,                              -- normalized join key (Step 61)
  "termMonths"       INTEGER NOT NULL,
  "cancelFeeCents"   INTEGER,
  "productType"      "ProductType" NOT NULL,
  "minUsageKwh"      INTEGER,
  "hasBillCredit"    BOOLEAN NOT NULL DEFAULT FALSE,

  "eflUrl"           TEXT,
  "tosUrl"           TEXT,
  "yracUrl"          TEXT,

  "docs"             JSONB NOT NULL,                             -- raw offer payload
  "rateModel"        JSONB,                                      -- to be populated in Step 64

  "effectiveAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt"        TIMESTAMPTZ,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers for updatedAt
CREATE OR REPLACE FUNCTION set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_master_plans ON "MasterPlan";
CREATE TRIGGER set_timestamp_master_plans
BEFORE UPDATE ON "MasterPlan"
FOR EACH ROW EXECUTE FUNCTION set_timestamp();

-- Core indexes for ingestion, queries, and matching
CREATE INDEX IF NOT EXISTS master_plans_tdsp_term_idx ON "MasterPlan" ("tdsp","termMonths");
CREATE INDEX IF NOT EXISTS master_plans_supplier_plan_idx ON "MasterPlan" ("supplierName","planName");
CREATE INDEX IF NOT EXISTS master_plans_nameId_idx ON "MasterPlan" ("nameId");
CREATE INDEX IF NOT EXISTS master_plans_planId_idx ON "MasterPlan" ("planId");
CREATE INDEX IF NOT EXISTS master_plans_effectiveAt_idx ON "MasterPlan" ("effectiveAt");
CREATE INDEX IF NOT EXISTS master_plans_expiresAt_idx ON "MasterPlan" ("expiresAt");
CREATE INDEX IF NOT EXISTS master_plans_docs_gin ON "MasterPlan" USING GIN ("docs");

-- Partial unique to guard duplicate offers when present (allows NULLs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'master_plans_source_offerid_uidx'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX master_plans_source_offerid_uidx ON "MasterPlan"("source","offerId") WHERE "offerId" IS NOT NULL';
  END IF;
END $$;

-- Helpful partials for active windows (optional, used by nightly ingestion)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'master_plans_active_window_idx'
  ) THEN
    EXECUTE 'CREATE INDEX master_plans_active_window_idx ON "MasterPlan"("tdsp","termMonths","effectiveAt") WHERE "expiresAt" IS NULL OR "expiresAt" > now()';
  END IF;
END $$;

-- End of migration
