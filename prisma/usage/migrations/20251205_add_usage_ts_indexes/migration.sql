-- Add helper indexes so admin diagnostics queries avoid full-table scans.
CREATE INDEX IF NOT EXISTS "UsageIntervalModule_ts_idx"
  ON "UsageIntervalModule" ("ts");

CREATE INDEX IF NOT EXISTS "GreenButtonInterval_timestamp_idx"
  ON "GreenButtonInterval" ("timestamp");

CREATE INDEX IF NOT EXISTS "GreenButtonInterval_rawId_timestamp_idx"
  ON "GreenButtonInterval" ("rawId", "timestamp");
