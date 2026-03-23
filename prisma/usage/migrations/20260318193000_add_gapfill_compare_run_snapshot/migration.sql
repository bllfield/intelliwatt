-- Durable compare-core run persistence for gapfill compare snapshots.
CREATE TABLE IF NOT EXISTS "GapfillCompareRunSnapshot" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "phase" TEXT,
  "houseId" TEXT,
  "userId" TEXT,
  "compareFreshMode" TEXT NOT NULL,
  "requestedInputHash" TEXT,
  "artifactScenarioId" TEXT,
  "requireExactArtifactMatch" BOOLEAN NOT NULL DEFAULT false,
  "artifactIdentitySource" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "snapshotReady" BOOLEAN NOT NULL DEFAULT false,
  "snapshotVersion" TEXT,
  "snapshotPersistedAt" TIMESTAMP(3),
  "snapshotJson" JSONB,
  "statusMetaJson" JSONB,
  CONSTRAINT "GapfillCompareRunSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GapfillCompareRunSnapshot_houseId_createdAt_idx"
  ON "GapfillCompareRunSnapshot"("houseId", "createdAt");

CREATE INDEX IF NOT EXISTS "GapfillCompareRunSnapshot_userId_createdAt_idx"
  ON "GapfillCompareRunSnapshot"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "GapfillCompareRunSnapshot_status_updatedAt_idx"
  ON "GapfillCompareRunSnapshot"("status", "updatedAt");
