CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "key"       TEXT PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "SupplierControl" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "supplierName"   TEXT NOT NULL,
  "isBlocked"      BOOLEAN NOT NULL DEFAULT FALSE,
  "rolloutPercent" INTEGER,
  "notes"          TEXT,
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_control_supplier_idx ON "SupplierControl" ("supplierName");
