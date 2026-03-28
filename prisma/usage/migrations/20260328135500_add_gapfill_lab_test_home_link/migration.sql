-- Global reusable lab test-home mapping for canonical Gap-Fill calibration flow.
CREATE TABLE "GapfillLabTestHomeLink" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "testHomeHouseId" TEXT NOT NULL,
    "sourceUserId" TEXT,
    "sourceHouseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "statusMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastReplacedAt" TIMESTAMP(3),

    CONSTRAINT "GapfillLabTestHomeLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GapfillLabTestHomeLink_ownerUserId_key" ON "GapfillLabTestHomeLink"("ownerUserId");
CREATE INDEX "GapfillLabTestHomeLink_testHomeHouseId_idx" ON "GapfillLabTestHomeLink"("testHomeHouseId");
CREATE INDEX "GapfillLabTestHomeLink_sourceUserId_sourceHouseId_idx" ON "GapfillLabTestHomeLink"("sourceUserId", "sourceHouseId");
CREATE INDEX "GapfillLabTestHomeLink_status_updatedAt_idx" ON "GapfillLabTestHomeLink"("status", "updatedAt");
