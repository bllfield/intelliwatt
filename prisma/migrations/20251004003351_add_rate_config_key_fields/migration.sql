/*
  Warnings:

  - Added the required column `rateKey` to the `OfferRateMap` table without a default value. This is not possible if the table is not empty.
  - Added the required column `key` to the `RateConfig` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OfferRateMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "offerId" TEXT NOT NULL,
    "rateKey" TEXT NOT NULL,
    "supplierSlug" TEXT NOT NULL,
    "planId" TEXT,
    "nameId" TEXT,
    "tdspSlug" TEXT,
    "eflUrl" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rateConfigId" TEXT NOT NULL,
    CONSTRAINT "OfferRateMap_rateConfigId_fkey" FOREIGN KEY ("rateConfigId") REFERENCES "RateConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OfferRateMap" ("createdAt", "eflUrl", "id", "nameId", "offerId", "planId", "rateConfigId", "supplierSlug", "tdspSlug", "updatedAt") SELECT "createdAt", "eflUrl", "id", "nameId", "offerId", "planId", "rateConfigId", "supplierSlug", "tdspSlug", "updatedAt" FROM "OfferRateMap";
DROP TABLE "OfferRateMap";
ALTER TABLE "new_OfferRateMap" RENAME TO "OfferRateMap";
CREATE UNIQUE INDEX "OfferRateMap_offerId_key" ON "OfferRateMap"("offerId");
CREATE INDEX "OfferRateMap_supplierSlug_planId_idx" ON "OfferRateMap"("supplierSlug", "planId");
CREATE INDEX "OfferRateMap_supplierSlug_nameId_idx" ON "OfferRateMap"("supplierSlug", "nameId");
CREATE INDEX "OfferRateMap_tdspSlug_idx" ON "OfferRateMap"("tdspSlug");
CREATE TABLE "new_RateConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    "greenPct" REAL,
    "eflUrl" TEXT,
    "tosUrl" TEXT,
    "yracUrl" TEXT,
    "baseMonthlyFeeCents" INTEGER,
    "tduDeliveryCentsPerKwh" REAL,
    "centsPerKwhJson" JSONB,
    "billCreditsJson" JSONB,
    "touWindowsJson" JSONB,
    "otherFeesJson" JSONB,
    "notes" TEXT,
    "checksum" TEXT,
    "eflHash" TEXT,
    "fetchedAt" DATETIME,
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_RateConfig" ("baseMonthlyFeeCents", "billCreditsJson", "centsPerKwhJson", "checksum", "createdAt", "eflUrl", "greenPct", "id", "isActive", "isGreen", "nameId", "notes", "otherFeesJson", "planId", "planName", "rateType", "supplierName", "supplierSlug", "tdsp", "tdspSlug", "tduDeliveryCentsPerKwh", "termMonths", "tosUrl", "touWindowsJson", "updatedAt", "validFrom", "validTo", "yracUrl") SELECT "baseMonthlyFeeCents", "billCreditsJson", "centsPerKwhJson", "checksum", "createdAt", "eflUrl", "greenPct", "id", "isActive", "isGreen", "nameId", "notes", "otherFeesJson", "planId", "planName", "rateType", "supplierName", "supplierSlug", "tdsp", "tdspSlug", "tduDeliveryCentsPerKwh", "termMonths", "tosUrl", "touWindowsJson", "updatedAt", "validFrom", "validTo", "yracUrl" FROM "RateConfig";
DROP TABLE "RateConfig";
ALTER TABLE "new_RateConfig" RENAME TO "RateConfig";
CREATE UNIQUE INDEX "RateConfig_key_key" ON "RateConfig"("key");
CREATE UNIQUE INDEX "RateConfig_checksum_key" ON "RateConfig"("checksum");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
