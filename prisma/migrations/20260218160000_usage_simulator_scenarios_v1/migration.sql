-- Usage Simulator Scenarios (V1)
-- Notes:
-- - Uses TEXT ids (Prisma uuid() defaults are client-generated in this repo)
-- - Baseline builds are keyed by scenarioKey='BASELINE' to avoid Postgres NULL uniqueness behavior.

-- CreateTable
CREATE TABLE "UsageSimulatorScenario" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageSimulatorScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSimulatorScenarioEvent" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "effectiveMonth" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageSimulatorScenarioEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "UsageSimulatorBuild"
ADD COLUMN     "scenarioKey" TEXT NOT NULL DEFAULT 'BASELINE',
ADD COLUMN     "estimatorVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "reshapeCoeffVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "intradayTemplateVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN     "smtShapeDerivationVersion" TEXT NOT NULL DEFAULT 'v1';

-- DropIndex
DROP INDEX IF EXISTS "UsageSimulatorBuild_userId_houseId_key";

-- CreateIndex
CREATE UNIQUE INDEX "UsageSimulatorBuild_userId_houseId_scenarioKey_key" ON "UsageSimulatorBuild"("userId", "houseId", "scenarioKey");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_scenarioKey_idx" ON "UsageSimulatorBuild"("scenarioKey");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenario_userId_idx" ON "UsageSimulatorScenario"("userId");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenario_houseId_idx" ON "UsageSimulatorScenario"("houseId");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenario_archivedAt_idx" ON "UsageSimulatorScenario"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageSimulatorScenario_userId_houseId_name_key" ON "UsageSimulatorScenario"("userId", "houseId", "name");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenarioEvent_scenarioId_idx" ON "UsageSimulatorScenarioEvent"("scenarioId");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenarioEvent_effectiveMonth_idx" ON "UsageSimulatorScenarioEvent"("effectiveMonth");

-- CreateIndex
CREATE INDEX "UsageSimulatorScenarioEvent_kind_idx" ON "UsageSimulatorScenarioEvent"("kind");

-- AddForeignKey
ALTER TABLE "UsageSimulatorScenario" ADD CONSTRAINT "UsageSimulatorScenario_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSimulatorScenario" ADD CONSTRAINT "UsageSimulatorScenario_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSimulatorScenarioEvent" ADD CONSTRAINT "UsageSimulatorScenarioEvent_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "UsageSimulatorScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

