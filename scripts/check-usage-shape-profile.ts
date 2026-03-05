/**
 * Check if the UsageShapeProfile table exists in the usage DB.
 * Uses USAGE_DATABASE_URL from .env or .env.local (loaded from repo root).
 * Run from repo root: npx tsx scripts/check-usage-shape-profile.ts
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    process.env[key] = value;
  }
}

const cwd = process.cwd();
loadEnvFile(resolve(cwd, ".env"));
loadEnvFile(resolve(cwd, ".env.local"));

const url = process.env.USAGE_DATABASE_URL;
if (!url) {
  console.error("USAGE_DATABASE_URL is not set. Add it to .env or .env.local (usage database URL).");
  process.exit(1);
}

async function main() {
  const { getUsagePrisma } = await import("../lib/db/usageClient");
  const usage = getUsagePrisma();
  try {
    // Use raw SQL so we don't depend on the generated model (works even if schema wasn't regenerated)
    const result = await usage.$queryRawUnsafe<[{ exists: boolean }]>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'UsageShapeProfile') AS exists"
    );
    const exists = result?.[0]?.exists === true;
    if (exists) {
      console.log("UsageShapeProfile table EXISTS in the usage database.");
      process.exit(0);
    } else {
      console.log("UsageShapeProfile table DOES NOT EXIST in the usage database.");
      console.log("Run the migration: see docs/MIGRATION_USAGE_SHAPE_PROFILE.md");
      process.exit(1);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("does not exist") || msg.includes("UsageShapeProfile")) {
      console.log("UsageShapeProfile table DOES NOT EXIST in the usage database.");
      console.log("Run the migration: see docs/MIGRATION_USAGE_SHAPE_PROFILE.md");
      process.exit(1);
    }
    console.error("Error checking table:", msg);
    process.exit(1);
  }
}

main();
