-- CreateTable
CREATE TABLE "smt_interval_day_ledger" (
    "id" TEXT NOT NULL,
    "esiid" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenAsCanonicalWindowEnd" BOOLEAN NOT NULL DEFAULT false,
    "repairAttemptedAt" TIMESTAMP(3),
    "repairAttemptedOnPullDate" TEXT,
    "intervalCountAtLastCheck" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smt_interval_day_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "smt_interval_day_ledger_esiid_dateKey_key" ON "smt_interval_day_ledger"("esiid", "dateKey");

-- CreateIndex
CREATE INDEX "smt_interval_day_ledger_esiid_status_idx" ON "smt_interval_day_ledger"("esiid", "status");
