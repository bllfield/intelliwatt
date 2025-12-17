-- Link WattBuy offer_id -> RatePlan template without changing existing OfferRateMap behavior.

-- 1) Add nullable column
ALTER TABLE "OfferRateMap"
ADD COLUMN IF NOT EXISTS "ratePlanId" TEXT;

-- 2) Add FK (idempotent)
DO $$
BEGIN
  ALTER TABLE "OfferRateMap"
    ADD CONSTRAINT "OfferRateMap_ratePlanId_fkey"
    FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    -- constraint already exists
    NULL;
END $$;

-- 3) Add index (idempotent)
CREATE INDEX IF NOT EXISTS "OfferRateMap_ratePlanId_idx"
  ON "OfferRateMap"("ratePlanId");


