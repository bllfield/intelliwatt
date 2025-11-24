-- Promote single primary house per user and track archived SMT authorizations

ALTER TABLE "HouseAddress"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SmtAuthorization"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "revokedReason" VARCHAR(100);

CREATE INDEX "HouseAddress_userId_isPrimary_idx" ON "HouseAddress"("userId", "isPrimary");

