-- CreateTable
CREATE TABLE "ManualUsageInput" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "anchorEndMonth" TEXT,
    "anchorEndDate" TIMESTAMP(3),
    "annualEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualUsageInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualUsageInput_userId_houseId_key" ON "ManualUsageInput"("userId", "houseId");

-- CreateIndex
CREATE INDEX "ManualUsageInput_userId_idx" ON "ManualUsageInput"("userId");

-- CreateIndex
CREATE INDEX "ManualUsageInput_houseId_idx" ON "ManualUsageInput"("houseId");

-- AddForeignKey
ALTER TABLE "ManualUsageInput" ADD CONSTRAINT "ManualUsageInput_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualUsageInput" ADD CONSTRAINT "ManualUsageInput_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

