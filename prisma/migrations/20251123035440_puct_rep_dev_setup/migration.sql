-- Ensure trigram support is available for GIN indexes using gin_trgm_ops
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "SmtBillingRead" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SmtMeterInfo" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserProfile" ALTER COLUMN "esiidAttentionAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SmtAuthorization" (
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "ErcotEsiidIndex" (
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

-- CreateIndex
CREATE INDEX "SmtAuthorization_userId_idx" ON "SmtAuthorization"("userId");

-- CreateIndex
CREATE INDEX "SmtAuthorization_houseId_idx" ON "SmtAuthorization"("houseId");

-- CreateIndex
CREATE INDEX "SmtAuthorization_houseAddressId_idx" ON "SmtAuthorization"("houseAddressId");

-- CreateIndex
CREATE INDEX "SmtAuthorization_esiid_idx" ON "SmtAuthorization"("esiid");

-- CreateIndex
CREATE INDEX "PuctRep_puctNumber_idx" ON "PuctRep"("puctNumber");

-- CreateIndex
CREATE INDEX "PuctRep_legalName_idx" ON "PuctRep"("legalName");

-- CreateIndex
CREATE INDEX "PuctRep_dbaName_idx" ON "PuctRep"("dbaName");

-- CreateIndex
CREATE UNIQUE INDEX "PuctRep_puctNumber_legalName_key" ON "PuctRep"("puctNumber", "legalName");

-- CreateIndex
CREATE UNIQUE INDEX "ErcotEsiidIndex_esiid_key" ON "ErcotEsiidIndex"("esiid");

-- CreateIndex
CREATE INDEX "ErcotEsiidIndex_normZip_idx" ON "ErcotEsiidIndex"("normZip");

-- CreateIndex
CREATE INDEX "ercot_esiid_index_normline1_trgm" ON "ErcotEsiidIndex" USING GIN ("normLine1" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "SmtAuthorization" ADD CONSTRAINT "SmtAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmtAuthorization" ADD CONSTRAINT "SmtAuthorization_houseAddressId_fkey" FOREIGN KEY ("houseAddressId") REFERENCES "HouseAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "RatePlan_utilityId_state_supplier_planName_termMonths_isUtility" RENAME TO "RatePlan_utilityId_state_supplier_planName_termMonths_isUti_key";

-- RenameIndex
ALTER INDEX "SmtInterval_esiid_meter_ts_idx" RENAME TO "esiid_meter_ts_idx";
