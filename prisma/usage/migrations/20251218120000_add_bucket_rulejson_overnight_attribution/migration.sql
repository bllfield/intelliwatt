-- CreateEnum
CREATE TYPE "OvernightAttribution" AS ENUM ('ACTUAL_DAY', 'START_DAY');

-- AlterTable
ALTER TABLE "UsageBucketDefinition"
ADD COLUMN     "overnightAttribution" "OvernightAttribution" NOT NULL DEFAULT 'ACTUAL_DAY',
ADD COLUMN     "ruleJson" JSONB;


