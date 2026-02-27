-- AlterTable
ALTER TABLE "HomeProfileSimulated"
ADD COLUMN     "hvacType" TEXT,
ADD COLUMN     "heatingType" TEXT,
ADD COLUMN     "hasPool" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "poolPumpType" TEXT,
ADD COLUMN     "poolPumpHp" DOUBLE PRECISION,
ADD COLUMN     "poolSummerRunHoursPerDay" DOUBLE PRECISION,
ADD COLUMN     "poolWinterRunHoursPerDay" DOUBLE PRECISION,
ADD COLUMN     "hasPoolHeater" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "poolHeaterType" TEXT;
