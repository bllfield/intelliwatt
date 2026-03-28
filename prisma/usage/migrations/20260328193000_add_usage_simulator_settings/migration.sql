CREATE TABLE "UsageSimulatorSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "userDefaultValidationSelectionMode" TEXT NOT NULL DEFAULT 'random_simple',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageSimulatorSettings_pkey" PRIMARY KEY ("id")
);
