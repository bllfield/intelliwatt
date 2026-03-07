-- Add composite unique constraint so skipDuplicates works and no duplicate (latBucket, lonBucket, timestampUtc) rows.

-- Drop existing non-unique index
DROP INDEX IF EXISTS "WeatherHourly_latBucket_lonBucket_timestampUtc_idx";

-- Create unique index (enforces one row per bucket + timestamp; used by createMany skipDuplicates)
CREATE UNIQUE INDEX "WeatherHourly_latBucket_lonBucket_timestampUtc_key" ON "WeatherHourly"("latBucket", "lonBucket", "timestampUtc");
