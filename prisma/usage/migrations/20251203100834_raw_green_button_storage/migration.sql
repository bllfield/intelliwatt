-- CreateTable
CREATE TABLE "RawGreenButton" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "homeId" TEXT,
    "userId" TEXT,
    "utilityName" TEXT,
    "accountNumber" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "sha256" TEXT,
    "capturedAt" TIMESTAMP(3),

    CONSTRAINT "RawGreenButton_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawGreenButton_sha256_key" ON "RawGreenButton"("sha256");

-- CreateIndex
CREATE INDEX "RawGreenButton_homeId_idx" ON "RawGreenButton"("homeId");

-- CreateIndex
CREATE INDEX "RawGreenButton_userId_idx" ON "RawGreenButton"("userId");
