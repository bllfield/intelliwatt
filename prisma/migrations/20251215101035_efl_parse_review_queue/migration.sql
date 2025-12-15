-- CreateTable
CREATE TABLE "EflParseReviewQueue" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "eflPdfSha256" TEXT NOT NULL,
    "repPuctCertificate" TEXT,
    "eflVersionCode" TEXT,
    "offerId" TEXT,
    "supplier" TEXT,
    "planName" TEXT,
    "eflUrl" TEXT,
    "tdspName" TEXT,
    "termMonths" INTEGER,
    "rawText" TEXT,
    "planRules" JSONB,
    "rateStructure" JSONB,
    "validation" JSONB,
    "derivedForValidation" JSONB,
    "finalStatus" TEXT NOT NULL,
    "queueReason" TEXT,
    "solverApplied" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNotes" TEXT,

    CONSTRAINT "EflParseReviewQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EflParseReviewQueue_eflPdfSha256_key" ON "EflParseReviewQueue"("eflPdfSha256");

-- CreateIndex
CREATE INDEX "EflParseReviewQueue_finalStatus_createdAt_idx" ON "EflParseReviewQueue"("finalStatus", "createdAt");
