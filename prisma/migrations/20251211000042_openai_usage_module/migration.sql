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


-- CreateIndex
CREATE INDEX "OpenAIUsageEvent_createdAt_idx" ON "OpenAIUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OpenAIUsageEvent_module_idx" ON "OpenAIUsageEvent"("module");
