-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MagicLinkToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MagicLinkToken" ("createdAt", "email", "expiresAt", "id", "token", "used") SELECT "createdAt", "email", "expiresAt", "id", "token", "used" FROM "MagicLinkToken";
DROP TABLE "MagicLinkToken";
ALTER TABLE "new_MagicLinkToken" RENAME TO "MagicLinkToken";
CREATE UNIQUE INDEX "MagicLinkToken_token_key" ON "MagicLinkToken"("token");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
