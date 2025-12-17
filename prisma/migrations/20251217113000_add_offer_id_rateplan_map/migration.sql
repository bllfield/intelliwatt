-- Canonical offer_id -> RatePlan template link (independent of OfferRateMap/RateConfig)

CREATE TABLE IF NOT EXISTS "OfferIdRatePlanMap" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "offerId" TEXT NOT NULL,
  "ratePlanId" TEXT,
  "lastLinkedAt" TIMESTAMP(3),
  "linkedBy" TEXT,
  "notes" TEXT,
  CONSTRAINT "OfferIdRatePlanMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfferIdRatePlanMap_offerId_key"
  ON "OfferIdRatePlanMap"("offerId");

CREATE INDEX IF NOT EXISTS "OfferIdRatePlanMap_ratePlanId_idx"
  ON "OfferIdRatePlanMap"("ratePlanId");

DO $$
BEGIN
  ALTER TABLE "OfferIdRatePlanMap"
    ADD CONSTRAINT "OfferIdRatePlanMap_ratePlanId_fkey"
    FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;


