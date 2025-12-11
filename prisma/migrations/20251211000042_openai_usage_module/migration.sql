-- CreateTable
CREATE TABLE "OpenAIUsageEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "module" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(128) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,4) NOT NULL,
    "requestId" VARCHAR(128),
    "userId" VARCHAR(64),
    "houseId" VARCHAR(64),
    "metadataJson" JSONB,

    CONSTRAINT "OpenAIUsageEvent_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "OpenAIUsageEvent_createdAt_idx" ON "OpenAIUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OpenAIUsageEvent_module_idx" ON "OpenAIUsageEvent"("module");

-- CreateIndex
CREATE INDEX "GreenButtonUpload_houseId_idx" ON "GreenButtonUpload"("houseId");

-- CreateIndex
CREATE INDEX "GreenButtonUpload_dateRangeStart_dateRangeEnd_idx" ON "GreenButtonUpload"("dateRangeStart", "dateRangeEnd");

-- AddForeignKey
ALTER TABLE "GreenButtonUpload" ADD CONSTRAINT "GreenButtonUpload_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
