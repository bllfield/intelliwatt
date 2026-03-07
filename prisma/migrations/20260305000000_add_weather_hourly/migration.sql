-- Open-Meteo hourly weather cache keyed by bucketed coordinates (0.1°). Shared across homes.

-- CreateTable
CREATE TABLE "WeatherHourly" (
    "id" TEXT NOT NULL,
    "latBucket" DOUBLE PRECISION NOT NULL,
    "lonBucket" DOUBLE PRECISION NOT NULL,
    "timestampUtc" TIMESTAMP(3) NOT NULL,
    "temperatureC" DOUBLE PRECISION,
    "cloudcoverPct" DOUBLE PRECISION,
    "solarRadiation" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherHourly_latBucket_lonBucket_timestampUtc_idx" ON "WeatherHourly"("latBucket", "lonBucket", "timestampUtc");
