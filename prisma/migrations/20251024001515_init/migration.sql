-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('wattbuy', 'manual', 'tdsp_feed');

-- CreateEnum
CREATE TYPE "TdspCode" AS ENUM ('ONCOR', 'CENTERPOINT', 'AEP_NORTH', 'AEP_CENTRAL', 'TNMP');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('fixed', 'variable', 'indexed', 'tou');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referredById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "zipCode" TEXT,
    "homeSqFt" INTEGER,
    "homeAge" INTEGER,
    "numStories" INTEGER,
    "numBedrooms" INTEGER,
    "numBathrooms" INTEGER,
    "wallMaterial" TEXT,
    "foundationType" TEXT,
    "insulationType" TEXT,
    "windowType" TEXT,
    "windowSealing" TEXT,
    "roofDirection" TEXT,
    "ledLighting" BOOLEAN,
    "smartThermostat" BOOLEAN,
    "thermostatType" TEXT,
    "summerTemp" INTEGER,
    "winterTemp" INTEGER,
    "heatingType" TEXT,
    "hvacType" TEXT,
    "waterHeaterType" TEXT,
    "pool" BOOLEAN,
    "poolPumpType" TEXT,
    "evChargerType" TEXT,
    "evMilesPerDay" INTEGER,
    "numOccupants" INTEGER,
    "numStayHome" INTEGER,
    "numWorkOrSchool" INTEGER,
    "numFridges" INTEGER,
    "lightingType" TEXT,
    "applianceImagesUploaded" BOOLEAN,
    "unusualTravelDates" TEXT,
    "hasSolar" BOOLEAN,
    "hasBattery" BOOLEAN,
    "plansToAddSolar" BOOLEAN,
    "plansToAddBattery" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appliance" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "energyStar" BOOLEAN,
    "dailyKWh" DOUBLE PRECISION,
    "photoUrl" TEXT,
    "vin" TEXT,
    "schedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiConnection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolarSystem" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "numPanels" INTEGER,
    "panelModel" TEXT,
    "panelWattage" INTEGER,
    "annualKWh" DOUBLE PRECISION,
    "azimuth" INTEGER,
    "tilt" INTEGER,
    "batteryModel" TEXT,
    "batteryCount" INTEGER,
    "batteryCapacity" DOUBLE PRECISION,
    "exportRate" DOUBLE PRECISION,
    "netMetering" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageData" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilityPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "rateImport" DOUBLE PRECISION NOT NULL,
    "rateExport" DOUBLE PRECISION NOT NULL,
    "deliveryFee" DOUBLE PRECISION NOT NULL,
    "monthlyFee" DOUBLE PRECISION NOT NULL,
    "expiration" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtilityPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referredById" TEXT NOT NULL,
    "referredEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceRecord" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadEmail" TEXT,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JackpotPayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "drawingDate" TIMESTAMP(3) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JackpotPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "supplierSlug" TEXT NOT NULL,
    "supplierName" TEXT,
    "planId" TEXT,
    "nameId" TEXT,
    "planName" TEXT,
    "tdsp" TEXT,
    "tdspSlug" TEXT,
    "termMonths" INTEGER,
    "rateType" TEXT,
    "isGreen" BOOLEAN,
    "greenPct" DOUBLE PRECISION,
    "eflUrl" TEXT,
    "tosUrl" TEXT,
    "yracUrl" TEXT,
    "baseMonthlyFeeCents" INTEGER,
    "tduDeliveryCentsPerKwh" DOUBLE PRECISION,
    "centsPerKwhJson" JSONB,
    "billCreditsJson" JSONB,
    "touWindowsJson" JSONB,
    "otherFeesJson" JSONB,
    "notes" TEXT,
    "checksum" TEXT,
    "eflHash" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RateConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRateMap" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "offerId" TEXT NOT NULL,
    "rateKey" TEXT NOT NULL,
    "supplierSlug" TEXT NOT NULL,
    "planId" TEXT,
    "nameId" TEXT,
    "tdspSlug" TEXT,
    "eflUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rateConfigId" TEXT NOT NULL,

    CONSTRAINT "OfferRateMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterPlan" (
    "id" TEXT NOT NULL,
    "source" "PlanSource" NOT NULL,
    "offerId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierPuctNo" TEXT,
    "tdsp" "TdspCode" NOT NULL,
    "planName" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "cancelFeeCents" INTEGER,
    "productType" "ProductType" NOT NULL,
    "minUsageKwh" INTEGER,
    "hasBillCredit" BOOLEAN NOT NULL DEFAULT false,
    "eflUrl" TEXT,
    "tosUrl" TEXT,
    "yracUrl" TEXT,
    "docs" JSONB NOT NULL,
    "rateModel" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdspRateSnapshot" (
    "id" TEXT NOT NULL,
    "tdsp" "TdspCode" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdspRateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferAudit" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "tdsp" TEXT NOT NULL,
    "userKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SupplierControl" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierControl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SolarSystem_profileId_key" ON "SolarSystem"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_token_key" ON "MagicLinkToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "RateConfig_key_key" ON "RateConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RateConfig_checksum_key" ON "RateConfig"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRateMap_offerId_key" ON "OfferRateMap"("offerId");

-- CreateIndex
CREATE INDEX "OfferRateMap_supplierSlug_planId_idx" ON "OfferRateMap"("supplierSlug", "planId");

-- CreateIndex
CREATE INDEX "OfferRateMap_supplierSlug_nameId_idx" ON "OfferRateMap"("supplierSlug", "nameId");

-- CreateIndex
CREATE INDEX "OfferRateMap_tdspSlug_idx" ON "OfferRateMap"("tdspSlug");

-- CreateIndex
CREATE UNIQUE INDEX "MasterPlan_offerId_key" ON "MasterPlan"("offerId");

-- CreateIndex
CREATE INDEX "MasterPlan_tdsp_termMonths_idx" ON "MasterPlan"("tdsp", "termMonths");

-- CreateIndex
CREATE INDEX "MasterPlan_supplierName_planName_idx" ON "MasterPlan"("supplierName", "planName");

-- CreateIndex
CREATE INDEX "MasterPlan_nameId_idx" ON "MasterPlan"("nameId");

-- CreateIndex
CREATE INDEX "MasterPlan_planId_idx" ON "MasterPlan"("planId");

-- CreateIndex
CREATE INDEX "MasterPlan_effectiveAt_idx" ON "MasterPlan"("effectiveAt");

-- CreateIndex
CREATE INDEX "MasterPlan_expiresAt_idx" ON "MasterPlan"("expiresAt");

-- CreateIndex
CREATE INDEX "TdspRateSnapshot_tdsp_createdAt_idx" ON "TdspRateSnapshot"("tdsp", "createdAt");

-- CreateIndex
CREATE INDEX "TdspRateSnapshot_effectiveAt_idx" ON "TdspRateSnapshot"("effectiveAt");

-- CreateIndex
CREATE INDEX "OfferAudit_planId_idx" ON "OfferAudit"("planId");

-- CreateIndex
CREATE INDEX "OfferAudit_supplierName_idx" ON "OfferAudit"("supplierName");

-- CreateIndex
CREATE INDEX "OfferAudit_tdsp_idx" ON "OfferAudit"("tdsp");

-- CreateIndex
CREATE INDEX "OfferAudit_createdAt_idx" ON "OfferAudit"("createdAt");

-- CreateIndex
CREATE INDEX "SupplierControl_supplierName_idx" ON "SupplierControl"("supplierName");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appliance" ADD CONSTRAINT "Appliance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiConnection" ADD CONSTRAINT "ApiConnection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolarSystem" ADD CONSTRAINT "SolarSystem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageData" ADD CONSTRAINT "UsageData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilityPlan" ADD CONSTRAINT "UtilityPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JackpotPayout" ADD CONSTRAINT "JackpotPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRateMap" ADD CONSTRAINT "OfferRateMap_rateConfigId_fkey" FOREIGN KEY ("rateConfigId") REFERENCES "RateConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
