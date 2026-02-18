-- CreateTable
CREATE TABLE "UsageSimulatorBuild" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "baseKind" TEXT NOT NULL,
    "canonicalEndMonth" TEXT NOT NULL,
    "canonicalMonths" JSONB NOT NULL,
    "buildInputs" JSONB NOT NULL,
    "buildInputsHash" TEXT NOT NULL,
    "lastBuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageSimulatorBuild_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageSimulatorBuild_userId_houseId_key" ON "UsageSimulatorBuild"("userId", "houseId");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_userId_idx" ON "UsageSimulatorBuild"("userId");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_houseId_idx" ON "UsageSimulatorBuild"("houseId");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_baseKind_idx" ON "UsageSimulatorBuild"("baseKind");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_lastBuiltAt_idx" ON "UsageSimulatorBuild"("lastBuiltAt");

-- AddForeignKey
ALTER TABLE "UsageSimulatorBuild" ADD CONSTRAINT "UsageSimulatorBuild_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSimulatorBuild" ADD CONSTRAINT "UsageSimulatorBuild_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

