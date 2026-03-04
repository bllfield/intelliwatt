-- AlterTable: Add EV block to HomeProfileSimulated (EV moved from Appliance Profile to Home Details).
ALTER TABLE "HomeProfileSimulated"
ADD COLUMN     "evHasVehicle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "evCount" INTEGER,
ADD COLUMN     "evChargerType" TEXT,
ADD COLUMN     "evAvgMilesPerDay" DOUBLE PRECISION,
ADD COLUMN     "evAvgKwhPerDay" DOUBLE PRECISION,
ADD COLUMN     "evChargingBehavior" TEXT,
ADD COLUMN     "evPreferredStartHr" INTEGER,
ADD COLUMN     "evPreferredEndHr" INTEGER,
ADD COLUMN     "evSmartCharger" BOOLEAN;
