-- Manual create script for SmtAuthorization (IntelliWatt)
-- NOTE: This is a temporary workaround because Prisma migrate dev is blocked by
-- historical ERCOT migration drift in the production database. Once migrations
-- are re-baselined, this table should be folded into a proper Prisma migration.

CREATE TABLE IF NOT EXISTS "SmtAuthorization" (
  -- Identity / foreign keys (Prisma: String @id, String @db.Text())
  "id"              TEXT PRIMARY KEY,
  "userId"          TEXT NOT NULL,
  "houseId"         TEXT NOT NULL,
  "houseAddressId"  TEXT NOT NULL,

  -- SMT / meter identity
  "esiid"           TEXT NOT NULL,
  "meterNumber"     TEXT NULL,

  -- Customer-entered values
  "customerName"    TEXT NOT NULL,

  -- Service address snapshot (from HouseAddress)
  "serviceAddressLine1" TEXT NOT NULL,
  "serviceAddressLine2" TEXT NULL,
  "serviceCity"         TEXT NOT NULL,
  "serviceState"        TEXT NOT NULL,
  "serviceZip"          TEXT NOT NULL,

  -- TDSP / utility snapshot
  "tdspCode"       TEXT NOT NULL,
  "tdspName"       TEXT NOT NULL,

  -- Authorization window (12-month consent)
  "authorizationStartDate" DATE NOT NULL,
  "authorizationEndDate"   DATE NOT NULL,

  -- Consent flags
  "allowIntervalUsage"     BOOLEAN NOT NULL,
  "allowHistoricalBilling" BOOLEAN NOT NULL,
  "allowSubscription"      BOOLEAN NOT NULL,

  -- Contact info
  "contactEmail"   TEXT NOT NULL,
  "contactPhone"   TEXT NULL,

  -- Internal SMT identifiers (from env/config)
  "smtRequestorId"     TEXT NOT NULL,
  "smtRequestorAuthId" TEXT NOT NULL,

  -- Timestamps
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Basic indexes for lookup by user/house/esiid
CREATE INDEX IF NOT EXISTS "SmtAuthorization_userId_idx"
  ON "SmtAuthorization"("userId");

CREATE INDEX IF NOT EXISTS "SmtAuthorization_houseId_idx"
  ON "SmtAuthorization"("houseId");

CREATE INDEX IF NOT EXISTS "SmtAuthorization_houseAddressId_idx"
  ON "SmtAuthorization"("houseAddressId");

CREATE INDEX IF NOT EXISTS "SmtAuthorization_esiid_idx"
  ON "SmtAuthorization"("esiid");

-- End of manual SmtAuthorization create

