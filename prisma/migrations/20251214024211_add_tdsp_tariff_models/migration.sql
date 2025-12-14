-- CreateTable
CREATE TABLE "TdspUtility" (
    "id" TEXT NOT NULL,
    "code" "TdspCode" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "serviceTerritory" TEXT,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TdspUtility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdspTariffVersion" (
    "id" TEXT NOT NULL,
    "tdspId" TEXT NOT NULL,
    "tariffCode" TEXT,
    "tariffName" TEXT,
    "effectiveStart" TIMESTAMP(3) NOT NULL,
    "effectiveEnd" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "sourceDocSha256" TEXT,
    "planSource" "PlanSource" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TdspTariffVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdspTariffComponent" (
    "id" TEXT NOT NULL,
    "tariffVersionId" TEXT NOT NULL,
    "chargeName" TEXT NOT NULL,
    "chargeType" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "minKwh" INTEGER,
    "maxKwh" INTEGER,
    "notes" TEXT,
    "rawSourceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TdspTariffComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TdspUtility_code_key" ON "TdspUtility"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TdspTariffVersion_sourceDocSha256_key" ON "TdspTariffVersion"("sourceDocSha256");

-- CreateIndex
CREATE INDEX "TdspTariffVersion_tdspId_effectiveStart_effectiveEnd_idx" ON "TdspTariffVersion"("tdspId", "effectiveStart", "effectiveEnd");

-- CreateIndex
CREATE INDEX "TdspTariffComponent_tariffVersionId_chargeType_unit_idx" ON "TdspTariffComponent"("tariffVersionId", "chargeType", "unit");

-- AddForeignKey
ALTER TABLE "TdspTariffVersion" ADD CONSTRAINT "TdspTariffVersion_tdspId_fkey" FOREIGN KEY ("tdspId") REFERENCES "TdspUtility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdspTariffComponent" ADD CONSTRAINT "TdspTariffComponent_tariffVersionId_fkey" FOREIGN KEY ("tariffVersionId") REFERENCES "TdspTariffVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
