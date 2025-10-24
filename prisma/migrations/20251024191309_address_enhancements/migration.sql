-- CreateEnum
CREATE TYPE "ValidationSource" AS ENUM ('NONE', 'GOOGLE', 'USER', 'OTHER');

-- CreateTable
CREATE TABLE "HouseAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "addressCity" TEXT NOT NULL,
    "addressState" TEXT NOT NULL,
    "addressZip5" TEXT NOT NULL,
    "addressZip4" TEXT,
    "addressCountry" TEXT NOT NULL DEFAULT 'US',
    "placeId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "addressValidated" BOOLEAN NOT NULL DEFAULT false,
    "validationSource" "ValidationSource" NOT NULL DEFAULT 'NONE',
    "esiid" TEXT,
    "tdspSlug" TEXT,
    "utilityName" TEXT,
    "utilityPhone" TEXT,
    "smartMeterConsent" BOOLEAN NOT NULL DEFAULT false,
    "smartMeterConsentDate" TIMESTAMP(3),
    "rawGoogleJson" JSONB,
    "rawWattbuyJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseAddress_esiid_key" ON "HouseAddress"("esiid");

-- CreateIndex
CREATE INDEX "HouseAddress_placeId_idx" ON "HouseAddress"("placeId");

-- CreateIndex
CREATE INDEX "HouseAddress_addressState_addressZip5_idx" ON "HouseAddress"("addressState", "addressZip5");

-- CreateIndex
CREATE INDEX "HouseAddress_esiid_idx" ON "HouseAddress"("esiid");
