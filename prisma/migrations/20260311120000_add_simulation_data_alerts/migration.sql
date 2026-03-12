-- CreateTable
CREATE TABLE IF NOT EXISTS "SimulationDataAlert" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "userId" TEXT,
  "userEmail" TEXT,
  "houseId" TEXT,
  "houseLabel" TEXT,
  "scenarioId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "reasonMessage" TEXT NOT NULL,
  "missingDataJson" JSONB NOT NULL,
  "contextJson" JSONB,
  "seenCount" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SimulationDataAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SimulationDataAlert_fingerprint_key" ON "SimulationDataAlert"("fingerprint");
CREATE INDEX IF NOT EXISTS "SimulationDataAlert_resolvedAt_lastSeenAt_idx" ON "SimulationDataAlert"("resolvedAt", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "SimulationDataAlert_source_resolvedAt_idx" ON "SimulationDataAlert"("source", "resolvedAt");
CREATE INDEX IF NOT EXISTS "SimulationDataAlert_userId_idx" ON "SimulationDataAlert"("userId");
CREATE INDEX IF NOT EXISTS "SimulationDataAlert_houseId_idx" ON "SimulationDataAlert"("houseId");

