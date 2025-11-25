-- Entry expiry digest table for daily refresh summaries
CREATE TABLE "EntryExpiryDigest" (
  "entryId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "status" "EntryStatus" NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "EntryExpiryDigest_userId_idx" ON "EntryExpiryDigest" ("userId");
CREATE INDEX "EntryExpiryDigest_status_idx" ON "EntryExpiryDigest" ("status");
CREATE INDEX "EntryExpiryDigest_recordedAt_idx" ON "EntryExpiryDigest" ("recordedAt");

ALTER TABLE "EntryExpiryDigest"
  ADD CONSTRAINT "EntryExpiryDigest_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntryExpiryDigest"
  ADD CONSTRAINT "EntryExpiryDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

