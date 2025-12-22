-- CreateTable
CREATE TABLE "HomeDailyUsageBucket" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "kwhTotal" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeDailyUsageBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeDailyUsageBucket_homeId_day_bucketKey_key" ON "HomeDailyUsageBucket"("homeId", "day", "bucketKey");

-- CreateIndex
CREATE INDEX "HomeDailyUsageBucket_homeId_day_idx" ON "HomeDailyUsageBucket"("homeId", "day");

-- CreateIndex
CREATE INDEX "HomeDailyUsageBucket_bucketKey_idx" ON "HomeDailyUsageBucket"("bucketKey");

-- AddForeignKey
ALTER TABLE "HomeDailyUsageBucket" ADD CONSTRAINT "HomeDailyUsageBucket_bucketKey_fkey" FOREIGN KEY ("bucketKey") REFERENCES "UsageBucketDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


