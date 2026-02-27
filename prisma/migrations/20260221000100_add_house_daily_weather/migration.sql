-- House daily weather storage for Past simulation stubs/API backfill.

-- CreateEnum
CREATE TYPE "HouseDailyWeatherKind" AS ENUM ('ACTUAL_LAST_YEAR', 'NORMAL_AVG');

-- CreateTable
CREATE TABLE "HouseDailyWeather" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "kind" "HouseDailyWeatherKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tAvgF" DOUBLE PRECISION NOT NULL,
    "tMinF" DOUBLE PRECISION NOT NULL,
    "tMaxF" DOUBLE PRECISION NOT NULL,
    "hdd65" DOUBLE PRECISION NOT NULL,
    "cdd65" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseDailyWeather_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseDailyWeather_houseId_dateKey_kind_version_key" ON "HouseDailyWeather"("houseId", "dateKey", "kind", "version");

-- CreateIndex
CREATE INDEX "HouseDailyWeather_houseId_kind_version_idx" ON "HouseDailyWeather"("houseId", "kind", "version");

-- CreateIndex
CREATE INDEX "HouseDailyWeather_houseId_dateKey_idx" ON "HouseDailyWeather"("houseId", "dateKey");

-- AddForeignKey
ALTER TABLE "HouseDailyWeather" ADD CONSTRAINT "HouseDailyWeather_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
