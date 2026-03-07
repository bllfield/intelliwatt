/**
 * Simple test for Open-Meteo historical weather + DB cache.
 * Run twice: first run fetches from API and inserts; second run uses cache.
 *
 * Usage: npx tsx scripts/testWeatherFetch.ts
 */

import { getHistoricalWeather } from "@/lib/weather/weatherService";

const LAT = 32.7555;
const LON = -97.3308;
const START = "2025-01-01";
const END = "2025-01-10";

async function main() {
  console.log("Fetching historical weather:", { lat: LAT, lon: LON, start: START, end: END });
  const startMs = Date.now();
  const rows = await getHistoricalWeather(LAT, LON, START, END);
  const elapsed = Date.now() - startMs;
  console.log("Rows returned:", rows.length, `(${elapsed}ms)`);
  if (rows.length > 0) {
    console.log("First row:", {
      timestampUtc: rows[0]!.timestampUtc.toISOString(),
      temperatureC: rows[0]!.temperatureC,
      cloudcoverPct: rows[0]!.cloudcoverPct,
      solarRadiation: rows[0]!.solarRadiation,
    });
    console.log("Last row:", {
      timestampUtc: rows[rows.length - 1]!.timestampUtc.toISOString(),
      temperatureC: rows[rows.length - 1]!.temperatureC,
      cloudcoverPct: rows[rows.length - 1]!.cloudcoverPct,
      solarRadiation: rows[rows.length - 1]!.solarRadiation,
    });
  }
  console.log("\nRun this script again to verify cache: second run should be faster and return same data.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
