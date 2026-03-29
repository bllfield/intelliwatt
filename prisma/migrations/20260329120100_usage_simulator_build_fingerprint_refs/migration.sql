-- AlterTable (additive build metadata for fingerprint provenance; usage-DB artifact ids are opaque strings)
ALTER TABLE "UsageSimulatorBuild" ADD COLUMN "wholeHomeFingerprintArtifactId" TEXT,
ADD COLUMN "usageFingerprintArtifactId" TEXT,
ADD COLUMN "fingerprintProvenanceJson" JSONB;

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_wholeHomeFingerprintArtifactId_idx" ON "UsageSimulatorBuild"("wholeHomeFingerprintArtifactId");

-- CreateIndex
CREATE INDEX "UsageSimulatorBuild_usageFingerprintArtifactId_idx" ON "UsageSimulatorBuild"("usageFingerprintArtifactId");
