CREATE INDEX IF NOT EXISTS ercot_esiid_index_normline1_trgm
ON "ErcotEsiidIndex"
USING gin ("normLine1" gin_trgm_ops);

