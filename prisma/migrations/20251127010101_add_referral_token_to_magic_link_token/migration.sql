-- Add referralToken column to MagicLinkToken for preserving referral context
ALTER TABLE "MagicLinkToken"
ADD COLUMN "referralToken" TEXT;

