CREATE TYPE "SmtEmailConfirmationStatus" AS ENUM ('PENDING','APPROVED','DECLINED');

ALTER TABLE "SmtAuthorization"
  ADD COLUMN "emailConfirmationStatus" "SmtEmailConfirmationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "emailConfirmationAt" TIMESTAMP(3);

CREATE INDEX "SmtAuthorization_emailConfirmationStatus_idx"
  ON "SmtAuthorization"("emailConfirmationStatus");
