-- Generic droplet job queue for shared Past sim recalc (same TS service layer as Vercel).
CREATE TABLE "SimDropletJob" (
    "id" TEXT NOT NULL,
    "jobKind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimDropletJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimDropletJob_status_idx" ON "SimDropletJob"("status");
CREATE INDEX "SimDropletJob_jobKind_status_idx" ON "SimDropletJob"("jobKind", "status");
