-- AlterTable
ALTER TABLE "RatePlan" ADD COLUMN     "modeledComputedAt" TIMESTAMP(3),
ADD COLUMN     "modeledEflAvgPriceValidation" JSONB,
ADD COLUMN     "modeledRate1000" DOUBLE PRECISION,
ADD COLUMN     "modeledRate2000" DOUBLE PRECISION,
ADD COLUMN     "modeledRate500" DOUBLE PRECISION;
