-- Add WattBuy API snapshots table for audit + replay (OFFERS / ELECTRICITY / ELECTRICITY_INFO)

CREATE TABLE IF NOT EXISTS "WattBuyApiSnapshot" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endpoint" TEXT NOT NULL,
  "houseAddressId" TEXT,
  "esiid" TEXT,
  "wattkey" TEXT,
  "requestKey" TEXT,
  "payloadJson" JSONB NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  CONSTRAINT "WattBuyApiSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WattBuyApiSnapshot_endpoint_houseAddressId_idx"
  ON "WattBuyApiSnapshot"("endpoint", "houseAddressId");

CREATE INDEX IF NOT EXISTS "WattBuyApiSnapshot_endpoint_esiid_idx"
  ON "WattBuyApiSnapshot"("endpoint", "esiid");

CREATE INDEX IF NOT EXISTS "WattBuyApiSnapshot_endpoint_wattkey_idx"
  ON "WattBuyApiSnapshot"("endpoint", "wattkey");

CREATE INDEX IF NOT EXISTS "WattBuyApiSnapshot_payloadSha256_idx"
  ON "WattBuyApiSnapshot"("payloadSha256");


