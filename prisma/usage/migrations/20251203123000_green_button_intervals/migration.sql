-- CreateTable
CREATE TABLE "GreenButtonInterval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rawId" TEXT NOT NULL,
    "homeId" TEXT,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "consumptionKwh" DECIMAL(10,5) NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,

    CONSTRAINT "GreenButtonInterval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GreenButtonInterval_rawId_idx" ON "GreenButtonInterval"("rawId");

-- CreateIndex
CREATE INDEX "GreenButtonInterval_homeId_timestamp_idx" ON "GreenButtonInterval"("homeId", "timestamp");

