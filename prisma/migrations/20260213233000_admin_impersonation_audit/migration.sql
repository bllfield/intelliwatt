-- CreateTable
CREATE TABLE "AdminImpersonationAudit" (
    "id" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "originalUserEmail" TEXT,
    "durationMinutes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startIp" TEXT,
    "startUserAgent" TEXT,
    "stopIp" TEXT,
    "stopUserAgent" TEXT,

    CONSTRAINT "AdminImpersonationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminImpersonationAudit_adminEmail_idx" ON "AdminImpersonationAudit"("adminEmail");

-- CreateIndex
CREATE INDEX "AdminImpersonationAudit_targetEmail_idx" ON "AdminImpersonationAudit"("targetEmail");

-- CreateIndex
CREATE INDEX "AdminImpersonationAudit_startedAt_idx" ON "AdminImpersonationAudit"("startedAt");

