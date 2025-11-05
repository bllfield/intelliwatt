-- CreateTable
CREATE TABLE "SmtInterval" (
    "id" TEXT NOT NULL,
    "esiid" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "kwh" DECIMAL(10,5) NOT NULL,
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtInterval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmtInterval_esiid_meter_ts_idx" ON "SmtInterval"("esiid", "meter", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "SmtInterval_esiid_meter_ts_key" ON "SmtInterval"("esiid", "meter", "ts");
