-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressState" TEXT,
ADD COLUMN     "addressValidated" BOOLEAN,
ADD COLUMN     "addressZip" TEXT,
ADD COLUMN     "esiid" TEXT,
ADD COLUMN     "smartMeterConsent" BOOLEAN,
ADD COLUMN     "smartMeterConsentDate" TIMESTAMP(3),
ADD COLUMN     "tdspSlug" TEXT;
