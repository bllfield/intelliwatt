-- CreateTable
CREATE TABLE "ApplianceProfileSimulated" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "appliancesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplianceProfileSimulated_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplianceProfileSimulated_userId_houseId_key" ON "ApplianceProfileSimulated"("userId", "houseId");

-- CreateIndex
CREATE INDEX "ApplianceProfileSimulated_userId_idx" ON "ApplianceProfileSimulated"("userId");

-- CreateIndex
CREATE INDEX "ApplianceProfileSimulated_houseId_idx" ON "ApplianceProfileSimulated"("houseId");

