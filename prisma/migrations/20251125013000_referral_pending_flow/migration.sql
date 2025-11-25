-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'CANCELLED');

-- AlterTable: Referral
ALTER TABLE "Referral"
ADD COLUMN     "entryAwardedAt" TIMESTAMP(3),
ADD COLUMN     "qualifiedAt" TIMESTAMP(3),
ADD COLUMN     "referredUserId" TEXT,
ADD COLUMN     "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable: Entry
ALTER TABLE "Entry"
ADD COLUMN     "referralId" TEXT;

-- CreateIndex
CREATE INDEX "Referral_referredById_idx" ON "Referral"("referredById");
CREATE INDEX "Referral_referredEmail_idx" ON "Referral"("referredEmail");
CREATE INDEX "Referral_referredUserId_idx" ON "Referral"("referredUserId");
CREATE INDEX "Referral_status_idx" ON "Referral"("status");
CREATE INDEX "Entry_referralId_idx" ON "Entry"("referralId");

-- AddUniqueConstraint
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_referralId_key" UNIQUE ("referralId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing referrals as qualified to avoid duplicate awards
UPDATE "Referral"
SET
  "status" = 'QUALIFIED',
  "qualifiedAt" = COALESCE("qualifiedAt", NOW()),
  "entryAwardedAt" = COALESCE("entryAwardedAt", NOW())
WHERE "status" = 'PENDING';

