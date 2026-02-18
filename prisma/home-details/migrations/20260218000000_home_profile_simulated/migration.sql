-- CreateTable
CREATE TABLE "HomeProfileSimulated" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "homeAge" INTEGER NOT NULL,
    "homeStyle" TEXT NOT NULL,
    "squareFeet" INTEGER NOT NULL,
    "stories" INTEGER NOT NULL,
    "insulationType" TEXT NOT NULL,
    "windowType" TEXT NOT NULL,
    "foundation" TEXT NOT NULL,
    "ledLights" BOOLEAN NOT NULL,
    "smartThermostat" BOOLEAN NOT NULL,
    "summerTemp" INTEGER NOT NULL,
    "winterTemp" INTEGER NOT NULL,
    "occupantsWork" INTEGER NOT NULL,
    "occupantsSchool" INTEGER NOT NULL,
    "occupantsHomeAllDay" INTEGER NOT NULL,
    "fuelConfiguration" TEXT NOT NULL,
    "provenanceJson" JSONB,
    "prefillJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeProfileSimulated_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeProfileSimulated_userId_houseId_key" ON "HomeProfileSimulated"("userId", "houseId");

-- CreateIndex
CREATE INDEX "HomeProfileSimulated_userId_idx" ON "HomeProfileSimulated"("userId");

-- CreateIndex
CREATE INDEX "HomeProfileSimulated_houseId_idx" ON "HomeProfileSimulated"("houseId");

