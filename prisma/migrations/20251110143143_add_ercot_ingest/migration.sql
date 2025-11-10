-- CreateTable
CREATE TABLE "ErcotIngest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "fileUrl" TEXT,
    "fileSha256" TEXT,
    "tdsp" TEXT,
    "rowCount" INTEGER,
    "headers" JSONB,
    "error" TEXT,
    "errorDetail" TEXT,

    CONSTRAINT "ErcotIngest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErcotIngest_fileSha256_key" ON "ErcotIngest"("fileSha256");