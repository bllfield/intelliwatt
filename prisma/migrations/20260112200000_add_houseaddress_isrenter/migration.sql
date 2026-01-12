-- Add HouseAddress.isRenter (defaults false)
ALTER TABLE "HouseAddress"
ADD COLUMN IF NOT EXISTS "isRenter" BOOLEAN NOT NULL DEFAULT false;

