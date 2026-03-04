-- CreateTable
CREATE TABLE "PastSimulatedDatasetCache" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "windowStartUtc" TEXT NOT NULL,
    "windowEndUtc" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "datasetJson" JSONB NOT NULL,
    "intervalsCodec" TEXT NOT NULL,
    "intervalsCompressed" BYTEA NOT NULL,

    CONSTRAINT "PastSimulatedDatasetCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PastSimulatedDatasetCache_houseId_scenarioId_inputHash_key" ON "PastSimulatedDatasetCache"("houseId", "scenarioId", "inputHash");

-- CreateIndex
CREATE INDEX "PastSimulatedDatasetCache_houseId_scenarioId_idx" ON "PastSimulatedDatasetCache"("houseId", "scenarioId");
