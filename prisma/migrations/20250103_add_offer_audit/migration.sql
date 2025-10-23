CREATE TABLE IF NOT EXISTS "OfferAudit" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event"        TEXT NOT NULL,
  "planId"       TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "planName"     TEXT NOT NULL,
  "tdsp"         TEXT NOT NULL,
  "userKey"      TEXT,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_audit_plan_idx ON "OfferAudit" ("planId");
CREATE INDEX IF NOT EXISTS offer_audit_supplier_idx ON "OfferAudit" ("supplierName");
CREATE INDEX IF NOT EXISTS offer_audit_tdsp_idx ON "OfferAudit" ("tdsp");
CREATE INDEX IF NOT EXISTS offer_audit_created_idx ON "OfferAudit" ("createdAt");
