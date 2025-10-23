/*
  Warnings:

  - You are about to drop the column `entryCount` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `referralCode` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `referralCount` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `User` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appliance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "energyStar" BOOLEAN,
    "dailyKWh" REAL,
    "photoUrl" TEXT,
    "vin" TEXT,
    "schedule" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Appliance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiConnection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SolarSystem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "numPanels" INTEGER,
    "panelModel" TEXT,
    "panelWattage" INTEGER,
    "annualKWh" REAL,
    "azimuth" INTEGER,
    "tilt" INTEGER,
    "batteryModel" TEXT,
    "batteryCount" INTEGER,
    "batteryCapacity" REAL,
    "exportRate" REAL,
    "netMetering" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SolarSystem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageData" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UtilityPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "rateImport" REAL NOT NULL,
    "rateExport" REAL NOT NULL,
    "deliveryFee" REAL NOT NULL,
    "monthlyFee" REAL NOT NULL,
    "expiration" DATETIME,
    "isCurrent" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UtilityPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referredById" TEXT NOT NULL,
    "referredEmail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinanceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "leadEmail" TEXT,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "earnedAt" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JackpotPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "drawingDate" DATETIME NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JackpotPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RateConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "OfferRateMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "offerId" TEXT NOT NULL,
    "supplierSlug" TEXT NOT NULL,
    "planId" TEXT,
    "nameId" TEXT,
    "tdspSlug" TEXT,
    "eflUrl" TEXT,
    "rateConfigId" TEXT NOT NULL,
    CONSTRAINT "OfferRateMap_rateConfigId_fkey" FOREIGN KEY ("rateConfigId") REFERENCES "RateConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referredById" TEXT
);
INSERT INTO "new_User" ("createdAt", "email", "id", "referredById") SELECT "createdAt", "email", "id", "referredById" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SolarSystem_profileId_key" ON "SolarSystem"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

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
