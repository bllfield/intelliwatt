-- Ensure trigram support is available for GIN indexes using gin_trgm_ops
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "SmtBillingRead" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SmtMeterInfo" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserProfile" ALTER COLUMN "esiidAttentionAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable: SmtAuthorization (idempotent)
CREATE TABLE IF NOT EXISTS "SmtAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "houseAddressId" TEXT NOT NULL,
    "esiid" TEXT NOT NULL,
    "meterNumber" TEXT,
    "customerName" TEXT NOT NULL,
    "serviceAddressLine1" TEXT NOT NULL,
    "serviceAddressLine2" TEXT,
    "serviceCity" TEXT NOT NULL,
    "serviceState" TEXT NOT NULL,
    "serviceZip" TEXT NOT NULL,
    "tdspCode" TEXT NOT NULL,
    "tdspName" TEXT NOT NULL,
    "authorizationStartDate" TIMESTAMP(3) NOT NULL,
    "authorizationEndDate" TIMESTAMP(3) NOT NULL,
    "allowIntervalUsage" BOOLEAN NOT NULL,
    "allowHistoricalBilling" BOOLEAN NOT NULL,
    "allowSubscription" BOOLEAN NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "smtRequestorId" TEXT NOT NULL,
    "smtRequestorAuthId" TEXT NOT NULL,
    "smtAgreementId" VARCHAR(100),
    "smtSubscriptionId" VARCHAR(100),
    "smtStatus" VARCHAR(50),
    "smtStatusMessage" TEXT,
    "smtBackfillRequestedAt" TIMESTAMP(3),
    "smtBackfillCompletedAt" TIMESTAMP(3),
    "smtLastSyncAt" TIMESTAMP(3),
    "consentTextVersion" VARCHAR(50),
    "consentIp" VARCHAR(64),
    "consentUserAgent" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PuctRep (new table)
CREATE TABLE "PuctRep" (
    "id" TEXT NOT NULL,
    "puctNumber" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dbaName" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PuctRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ErcotEsiidIndex (idempotent)
CREATE TABLE IF NOT EXISTS "ErcotEsiidIndex" (
    "id" BIGSERIAL NOT NULL,
    "esiid" VARCHAR(22) NOT NULL,
    "tdspCode" VARCHAR(16),
    "serviceAddress1" TEXT,
    "serviceCity" VARCHAR(64),
    "serviceState" CHAR(2),
    "serviceZip" VARCHAR(10),
    "status" VARCHAR(16),
    "premiseType" VARCHAR(32),
    "postedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "normLine1" TEXT,
    "normCity" VARCHAR(64),
    "normZip" VARCHAR(10),

    CONSTRAINT "ErcotEsiidIndex_pkey" PRIMARY KEY ("id")
);

-- Indexes on SmtAuthorization (idempotent)
CREATE INDEX IF NOT EXISTS "SmtAuthorization_userId_idx" ON "SmtAuthorization"("userId");
CREATE INDEX IF NOT EXISTS "SmtAuthorization_houseId_idx" ON "SmtAuthorization"("houseId");
CREATE INDEX IF NOT EXISTS "SmtAuthorization_houseAddressId_idx" ON "SmtAuthorization"("houseAddressId");
CREATE INDEX IF NOT EXISTS "SmtAuthorization_esiid_idx" ON "SmtAuthorization"("esiid");

-- Indexes on PuctRep (make idempotent to be safe)
CREATE INDEX IF NOT EXISTS "PuctRep_puctNumber_idx" ON "PuctRep"("puctNumber");
CREATE INDEX IF NOT EXISTS "PuctRep_legalName_idx" ON "PuctRep"("legalName");
CREATE INDEX IF NOT EXISTS "PuctRep_dbaName_idx" ON "PuctRep"("dbaName");
CREATE UNIQUE INDEX IF NOT EXISTS "PuctRep_puctNumber_legalName_key" ON "PuctRep"("puctNumber", "legalName");

-- Indexes on ErcotEsiidIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "ErcotEsiidIndex_esiid_key" ON "ErcotEsiidIndex"("esiid");
CREATE INDEX IF NOT EXISTS "ErcotEsiidIndex_normZip_idx" ON "ErcotEsiidIndex"("normZip");
CREATE INDEX IF NOT EXISTS "ercot_esiid_index_normline1_trgm" ON "ErcotEsiidIndex" USING GIN ("normLine1" gin_trgm_ops);

-- Foreign keys for SmtAuthorization
ALTER TABLE "SmtAuthorization" ADD CONSTRAINT "SmtAuthorization_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SmtAuthorization" ADD CONSTRAINT "SmtAuthorization_houseAddressId_fkey"
  FOREIGN KEY ("houseAddressId") REFERENCES "HouseAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex on RatePlan (leave as-is; no drift reported here)
ALTER INDEX "RatePlan_utilityId_state_supplier_planName_termMonths_isUtility"
  RENAME TO "RatePlan_utilityId_state_supplier_planName_termMonths_isUti_key";

-- Conditional rename of SmtInterval index:
-- On prod, this may already have been renamed by an earlier DB-only migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_class c
    WHERE  c.relname = 'SmtInterval_esiid_meter_ts_idx'
    AND    c.relkind = 'i'
  ) THEN
    EXECUTE 'ALTER INDEX "SmtInterval_esiid_meter_ts_idx" RENAME TO "esiid_meter_ts_idx"';
  END IF;
END
$$;
