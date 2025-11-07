-- MOCK DATA for local testing ONLY. Remove after verification.
INSERT INTO "ErcotEsiidIndex" (
  esiid, "tdspCode", "serviceAddress1", "serviceCity", "serviceState",
  "serviceZip", status, "premiseType", "postedAtUtc",
  "normLine1", "normCity", "normZip"
)
VALUES
('1044372000000000001', 'ONCOR', '9514 SANTA PAULA DRIVE', 'FORT WORTH', 'TX', '76116', 'ACTIVE', 'RES', NOW(),
 '9514 SANTA PAULA DR', 'FORT WORTH', '76116'),
('1044372000000000002', 'ONCOR', '9500 SANTA PAULA DR', 'FORT WORTH', 'TX', '76116', 'ACTIVE', 'RES', NOW(),
 '9500 SANTA PAULA DR', 'FORT WORTH', '76116')
ON CONFLICT (esiid) DO NOTHING;

