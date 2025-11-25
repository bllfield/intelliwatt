-- Create Enum
CREATE TYPE "EntryStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED');

-- Alter Entry table
ALTER TABLE "Entry"
  ADD COLUMN "status" "EntryStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "lastValidated" TIMESTAMP(3),
  ADD COLUMN "expirationReason" TEXT,
  ADD COLUMN "manualUsageId" TEXT;

-- Ensure manual usage reference is unique
ALTER TABLE "Entry"
  ADD CONSTRAINT "Entry_manualUsageId_key" UNIQUE ("manualUsageId");

-- Create ManualUsageUpload table
CREATE TABLE "ManualUsageUpload" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "houseId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create EntryStatusLog table
CREATE TABLE "EntryStatusLog" (
  "id" TEXT PRIMARY KEY,
  "entryId" TEXT NOT NULL,
  "previous" "EntryStatus",
  "next" "EntryStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Entry
CREATE INDEX "Entry_expiresAt_idx" ON "Entry" ("expiresAt");
CREATE INDEX "Entry_status_idx" ON "Entry" ("status");

-- Indexes for ManualUsageUpload
CREATE INDEX "ManualUsageUpload_userId_idx" ON "ManualUsageUpload" ("userId");
CREATE INDEX "ManualUsageUpload_houseId_idx" ON "ManualUsageUpload" ("houseId");
CREATE INDEX "ManualUsageUpload_expiresAt_idx" ON "ManualUsageUpload" ("expiresAt");

-- Indexes for EntryStatusLog
CREATE INDEX "EntryStatusLog_entryId_idx" ON "EntryStatusLog" ("entryId");
CREATE INDEX "EntryStatusLog_createdAt_idx" ON "EntryStatusLog" ("createdAt");

-- Foreign keys
ALTER TABLE "Entry"
  ADD CONSTRAINT "Entry_manualUsageId_fkey" FOREIGN KEY ("manualUsageId") REFERENCES "ManualUsageUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ManualUsageUpload"
  ADD CONSTRAINT "ManualUsageUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ManualUsageUpload_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EntryStatusLog"
  ADD CONSTRAINT "EntryStatusLog_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigger to maintain updatedAt on ManualUsageUpload
CREATE OR REPLACE FUNCTION set_manual_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_manual_usage_updated_at
BEFORE UPDATE ON "ManualUsageUpload"
FOR EACH ROW
EXECUTE FUNCTION set_manual_usage_updated_at();

