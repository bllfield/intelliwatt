CREATE TABLE "SmtBillingRead" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawSmtFileId" BIGINT,
    "esiid" TEXT NOT NULL,
    "meter" TEXT,
    "tdspCode" TEXT,
    "tdspName" TEXT,
    "readStart" TIMESTAMP(3),
    "readEnd" TIMESTAMP(3),
    "billDate" TIMESTAMP(3),
    "kwhTotal" DOUBLE PRECISION,
    "kwhBilled" DOUBLE PRECISION,
    "source" TEXT,
    CONSTRAINT "SmtBillingRead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmtBillingRead_esiid_billDate_idx" ON "SmtBillingRead"("esiid", "billDate");
CREATE INDEX "SmtBillingRead_esiid_readStart_idx" ON "SmtBillingRead"("esiid", "readStart");
CREATE INDEX "SmtBillingRead_rawSmtFileId_idx" ON "SmtBillingRead"("rawSmtFileId");

ALTER TABLE "SmtBillingRead" ADD CONSTRAINT "SmtBillingRead_rawSmtFileId_fkey" FOREIGN KEY ("rawSmtFileId") REFERENCES "raw_smt_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
