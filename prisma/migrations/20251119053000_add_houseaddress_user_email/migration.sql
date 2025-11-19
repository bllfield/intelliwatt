ALTER TABLE "HouseAddress" ADD COLUMN "userEmail" TEXT;

UPDATE "HouseAddress"
SET "userEmail" = lower("userId")
WHERE POSITION('@' IN "userId") > 0;

UPDATE "HouseAddress" ha
SET "userEmail" = lower(u.email)
FROM "User" u
WHERE ha."userId" = u.id;

UPDATE "HouseAddress"
SET "userEmail" = lower("userEmail")
WHERE "userEmail" IS NOT NULL;

CREATE INDEX "HouseAddress_userEmail_idx" ON "HouseAddress" ("userEmail");
