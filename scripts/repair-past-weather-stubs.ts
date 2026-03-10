/**
 * Repair stale ACTUAL_LAST_YEAR STUB_V1 weather rows for a house: delete stubs and rerun backfill.
 * Safe to rerun. Use when Past shows "mixed actual + stub" but real Open-Meteo data exists for some days.
 *
 * Usage:
 *   npx ts-node scripts/repair-past-weather-stubs.ts <houseId> [--start YYYY-MM-DD] [--end YYYY-MM-DD]
 * If --start/--end omitted, uses last 366 days from today (UTC).
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { repairStaleStubWeather } from "../modules/weather/backfill";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function loadEnvLocalIfPresent() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const rawValue = trimmed.slice(equalIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function parseArgs(argv: string[]): { houseId: string; start?: string; end?: string } {
  let houseId = "";
  let start: string | undefined;
  let end: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--start=")) {
      const v = arg.slice("--start=".length).trim();
      if (YYYY_MM_DD.test(v)) start = v;
    } else if (arg.startsWith("--end=")) {
      const v = arg.slice("--end=".length).trim();
      if (YYYY_MM_DD.test(v)) end = v;
    } else if (!arg.startsWith("-") && arg.length > 0) {
      houseId = arg.trim();
    }
  }
  return { houseId, start, end };
}

async function main() {
  loadEnvLocalIfPresent();
  const args = parseArgs(process.argv.slice(2));
  if (!args.houseId) {
    console.error("Usage: npx ts-node scripts/repair-past-weather-stubs.ts <houseId> [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]");
    process.exit(1);
  }

  const result = await repairStaleStubWeather({
    houseId: args.houseId,
    startDate: args.start,
    endDate: args.end,
  });

  console.log("deleted:", result.deleted);
  console.log("fetched:", result.fetched);
  console.log("stubbed:", result.stubbed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
