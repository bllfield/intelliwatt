-- CreateEnum
CREATE TYPE "TdspTariffIngestRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'ERROR');

-- CreateTable
CREATE TABLE "TdspTariffIngestRun" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "TdspTariffIngestRunStatus" NOT NULL,
    "trigger" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "processedTdspCount" INTEGER NOT NULL DEFAULT 0,
    "createdVersionCount" INTEGER NOT NULL DEFAULT 0,
    "noopVersionCount" INTEGER NOT NULL DEFAULT 0,
    "skippedTdspCount" INTEGER NOT NULL DEFAULT 0,
    "errorTdspCount" INTEGER NOT NULL DEFAULT 0,
    "changesJson" JSONB,
    "errorsJson" JSONB,
    "logs" TEXT,

    CONSTRAINT "TdspTariffIngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TdspTariffIngestRun_createdAt_idx" ON "TdspTariffIngestRun"("createdAt");
