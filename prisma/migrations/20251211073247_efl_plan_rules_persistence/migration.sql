/*
  Warnings:

  - A unique constraint covering the columns `[eflPdfSha256]` on the table `RatePlan` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RatePlan" ADD COLUMN     "eflPdfSha256" TEXT,
ADD COLUMN     "eflRequiresManualReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eflSourceUrl" TEXT,
ADD COLUMN     "eflValidationIssues" JSONB,
ADD COLUMN     "eflVersionCode" TEXT,
ADD COLUMN     "rateStructure" JSONB,
ADD COLUMN     "repPuctCertificate" TEXT;

-- CreateTable
CREATE TABLE "GreenButtonUpload" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "houseId" TEXT NOT NULL,
    "utilityName" TEXT,
    "accountNumber" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "storageKey" TEXT NOT NULL,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "intervalMinutes" INTEGER,
    "parseStatus" TEXT,
    "parseMessage" TEXT,

    CONSTRAINT "GreenButtonUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GreenButtonUpload_houseId_idx" ON "GreenButtonUpload"("houseId");

-- CreateIndex
CREATE INDEX "GreenButtonUpload_dateRangeStart_dateRangeEnd_idx" ON "GreenButtonUpload"("dateRangeStart", "dateRangeEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_eflPdfSha256_key" ON "RatePlan"("eflPdfSha256");

-- AddForeignKey
ALTER TABLE "GreenButtonUpload" ADD CONSTRAINT "GreenButtonUpload_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
