-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('ALL', 'WEEKDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('ALL', 'SUMMER', 'WINTER', 'SHOULDER');

-- CreateTable
CREATE TABLE "UsageBucketDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL,
    "season" "Season",
    "startHHMM" TEXT NOT NULL,
    "endHHMM" TEXT NOT NULL,
    "tz" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageBucketDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeMonthlyUsageBucket" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "kwhTotal" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeMonthlyUsageBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageBucketDefinition_key_key" ON "UsageBucketDefinition"("key");

-- CreateIndex
CREATE INDEX "UsageBucketDefinition_dayType_idx" ON "UsageBucketDefinition"("dayType");

-- CreateIndex
CREATE INDEX "HomeMonthlyUsageBucket_homeId_yearMonth_idx" ON "HomeMonthlyUsageBucket"("homeId", "yearMonth");

-- CreateIndex
CREATE INDEX "HomeMonthlyUsageBucket_bucketKey_idx" ON "HomeMonthlyUsageBucket"("bucketKey");

-- CreateIndex
CREATE UNIQUE INDEX "HomeMonthlyUsageBucket_homeId_yearMonth_bucketKey_key" ON "HomeMonthlyUsageBucket"("homeId", "yearMonth", "bucketKey");

-- AddForeignKey
ALTER TABLE "HomeMonthlyUsageBucket" ADD CONSTRAINT "HomeMonthlyUsageBucket_bucketKey_fkey" FOREIGN KEY ("bucketKey") REFERENCES "UsageBucketDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
