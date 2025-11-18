-- Flag user profiles when their service address ESIID is reassigned
ALTER TABLE "UserProfile"
ADD COLUMN "esiidAttentionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "esiidAttentionCode" TEXT,
ADD COLUMN "esiidAttentionAt" TIMESTAMP;

