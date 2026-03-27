-- Durable queued compare payload for droplet async execution.
ALTER TABLE "GapfillCompareRunSnapshot" ADD COLUMN IF NOT EXISTS "queuedPayloadJson" JSONB;
