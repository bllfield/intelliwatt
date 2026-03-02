-- CreateEnum
CREATE TYPE "IntervalSeriesKind" AS ENUM (
  'ACTUAL_USAGE_INTERVALS',
  'BASELINE_INTERVALS',
  'PAST_SIM_BASELINE',
  'FUTURE_SIM_BASELINE',
  'FUTURE_SIM_USAGE'
);

-- CreateTable
CREATE TABLE "IntervalSeries" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "houseId" TEXT NOT NULL,
  "kind" "IntervalSeriesKind" NOT NULL,
  "scenarioId" TEXT,
  "anchorStartUtc" TIMESTAMP(3) NOT NULL,
  "anchorEndUtc" TIMESTAMP(3) NOT NULL,
  "derivationVersion" TEXT NOT NULL,
  "buildInputsHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntervalSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntervalPoint15m" (
  "seriesId" TEXT NOT NULL,
  "tsUtc" TIMESTAMP(3) NOT NULL,
  "kwh" DECIMAL(12,6) NOT NULL,
  CONSTRAINT "IntervalPoint15m_pkey" PRIMARY KEY ("seriesId","tsUtc")
);

-- CreateIndex
CREATE INDEX "IntervalSeries_userId_idx" ON "IntervalSeries"("userId");
CREATE INDEX "IntervalSeries_houseId_idx" ON "IntervalSeries"("houseId");
CREATE INDEX "IntervalSeries_kind_idx" ON "IntervalSeries"("kind");
CREATE INDEX "IntervalSeries_scenarioId_idx" ON "IntervalSeries"("scenarioId");
CREATE INDEX "IntervalSeries_userId_houseId_kind_idx" ON "IntervalSeries"("userId", "houseId", "kind");
CREATE INDEX "IntervalSeries_userId_houseId_kind_scenarioId_idx" ON "IntervalSeries"("userId", "houseId", "kind", "scenarioId");
CREATE INDEX "IntervalPoint15m_tsUtc_idx" ON "IntervalPoint15m"("tsUtc");

-- Partial unique indexes for NULL-safe baseline vs scenario records
CREATE UNIQUE INDEX "IntervalSeries_unique_baseline_kind_per_house"
  ON "IntervalSeries"("userId", "houseId", "kind")
  WHERE "scenarioId" IS NULL;

CREATE UNIQUE INDEX "IntervalSeries_unique_scenario_kind_per_house"
  ON "IntervalSeries"("userId", "houseId", "kind", "scenarioId")
  WHERE "scenarioId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "IntervalSeries"
  ADD CONSTRAINT "IntervalSeries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntervalSeries"
  ADD CONSTRAINT "IntervalSeries_houseId_fkey"
  FOREIGN KEY ("houseId") REFERENCES "HouseAddress"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntervalPoint15m"
  ADD CONSTRAINT "IntervalPoint15m_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "IntervalSeries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
