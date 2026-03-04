-- CreateTable
CREATE TABLE "UsageShapeProfile" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStartUtc" TIMESTAMP(3) NOT NULL,
    "windowEndUtc" TIMESTAMP(3) NOT NULL,
    "baseloadKwhPer15m" DOUBLE PRECISION,
    "baseloadKwhPerDay" DOUBLE PRECISION,
    "shapeAll96" JSONB,
    "shapeWeekday96" JSONB,
    "shapeWeekend96" JSONB,
    "shapeByMonth96" JSONB,
    "avgKwhPerDayWeekdayByMonth" JSONB,
    "avgKwhPerDayWeekendByMonth" JSONB,
    "peakHourByMonth" JSONB,
    "p95KwByMonth" JSONB,
    "timeOfDayShares" JSONB,
    "configHash" TEXT NOT NULL,

    CONSTRAINT "UsageShapeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageShapeProfile_houseId_version_key" ON "UsageShapeProfile"("houseId", "version");

-- CreateIndex
CREATE INDEX "UsageShapeProfile_houseId_idx" ON "UsageShapeProfile"("houseId");
