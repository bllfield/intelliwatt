-- CreateEnum
CREATE TYPE "SimulatorFingerprintStatus" AS ENUM ('ready', 'stale', 'building', 'failed');

-- CreateTable
CREATE TABLE "WholeHomeFingerprint" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "status" "SimulatorFingerprintStatus" NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "staleReason" TEXT,
    "builtAt" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholeHomeFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageFingerprint" (
    "id" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "status" "SimulatorFingerprintStatus" NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "staleReason" TEXT,
    "builtAt" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholeHomeFingerprint_houseId_key" ON "WholeHomeFingerprint"("houseId");

-- CreateIndex
CREATE INDEX "WholeHomeFingerprint_houseId_idx" ON "WholeHomeFingerprint"("houseId");

-- CreateIndex
CREATE INDEX "WholeHomeFingerprint_status_idx" ON "WholeHomeFingerprint"("status");

-- CreateIndex
CREATE INDEX "WholeHomeFingerprint_sourceHash_idx" ON "WholeHomeFingerprint"("sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "UsageFingerprint_houseId_key" ON "UsageFingerprint"("houseId");

-- CreateIndex
CREATE INDEX "UsageFingerprint_houseId_idx" ON "UsageFingerprint"("houseId");

-- CreateIndex
CREATE INDEX "UsageFingerprint_status_idx" ON "UsageFingerprint"("status");

-- CreateIndex
CREATE INDEX "UsageFingerprint_sourceHash_idx" ON "UsageFingerprint"("sourceHash");
