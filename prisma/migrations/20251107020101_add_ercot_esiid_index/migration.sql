-- CreateTable
CREATE TABLE "ErcotEsiidIndex" (
    "id" BIGSERIAL NOT NULL,
    "esiid" VARCHAR(22) NOT NULL,
    "tdspCode" VARCHAR(16),
    "serviceAddress1" TEXT,
    "serviceCity" VARCHAR(64),
    "serviceState" CHAR(2),
    "serviceZip" VARCHAR(10),
    "status" VARCHAR(16),
    "premiseType" VARCHAR(32),
    "postedAtUtc" TIMESTAMPTZ NOT NULL,
    "normLine1" TEXT,
    "normCity" VARCHAR(64),
    "normZip" VARCHAR(10),

    CONSTRAINT "ErcotEsiidIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErcotEsiidIndex_esiid_key" ON "ErcotEsiidIndex"("esiid");

-- CreateIndex
CREATE INDEX "ErcotEsiidIndex_normZip_idx" ON "ErcotEsiidIndex"("normZip");

-- RenameIndex
ALTER INDEX "SmtInterval_esiid_meter_ts_idx" RENAME TO "esiid_meter_ts_idx";
