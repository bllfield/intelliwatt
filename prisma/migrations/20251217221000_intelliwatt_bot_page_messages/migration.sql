-- IntelliWattBot: per-page messages used by the dashboard hero bot.

CREATE TABLE IF NOT EXISTS "IntelliwattBotPageMessage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "pageKey" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  CONSTRAINT "IntelliwattBotPageMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntelliwattBotPageMessage_pageKey_key"
  ON "IntelliwattBotPageMessage"("pageKey");

CREATE INDEX IF NOT EXISTS "IntelliwattBotPageMessage_enabled_idx"
  ON "IntelliwattBotPageMessage"("enabled");


