-- Add helper indexes so admin diagnostics queries avoid full-table scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UsageIntervalModule_ts_idx"
  ON "UsageIntervalModule" ("ts");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "GreenButtonInterval_timestamp_idx"
  ON "GreenButtonInterval" ("timestamp");

