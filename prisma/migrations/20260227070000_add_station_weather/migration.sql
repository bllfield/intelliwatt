-- Station-based weather storage + house pointer (additive; legacy per-house weather remains).

-- CreateEnum
CREATE TYPE "WeatherKind" AS ENUM ('ACTUAL_LAST_YEAR', 'NORMAL_AVG');

-- CreateTable
CREATE TABLE "WeatherStation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherDaily" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "kind" "WeatherKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tAvgF" DOUBLE PRECISION NOT NULL,
    "tMinF" DOUBLE PRECISION NOT NULL,
    "tMaxF" DOUBLE PRECISION NOT NULL,
    "hdd65" DOUBLE PRECISION NOT NULL,
    "cdd65" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherDaily_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "HouseAddress" ADD COLUMN "weatherStationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WeatherStation_code_key" ON "WeatherStation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherDaily_stationId_dateKey_kind_version_key" ON "WeatherDaily"("stationId", "dateKey", "kind", "version");

-- CreateIndex
CREATE INDEX "WeatherDaily_stationId_kind_version_idx" ON "WeatherDaily"("stationId", "kind", "version");

-- CreateIndex
CREATE INDEX "WeatherDaily_stationId_dateKey_idx" ON "WeatherDaily"("stationId", "dateKey");

-- CreateIndex
CREATE INDEX "HouseAddress_weatherStationId_idx" ON "HouseAddress"("weatherStationId");

-- AddForeignKey
ALTER TABLE "HouseAddress" ADD CONSTRAINT "HouseAddress_weatherStationId_fkey" FOREIGN KEY ("weatherStationId") REFERENCES "WeatherStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherDaily" ADD CONSTRAINT "WeatherDaily_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WeatherStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
