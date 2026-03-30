/**
 * Backfill house daily weather for the usage window (e.g. 366 days).
 * Fetches actual weather for dates that are missing or have only STUB_V1; replaces stale stubs when API returns data.
 * Any still-missing dates get stubs. Never overwrites real rows with stubs.
 */

import { prisma } from "@/lib/db";
import { getWeatherForRange, hourlyRowsToDayWxMap } from "@/lib/sim/weatherProvider";
import {
  deleteHouseWeatherStubRows,
  findDateKeysMissingOrStub,
  findMissingHouseWeatherDateKeys,
  upsertHouseWeatherDays,
} from "@/modules/weather/repo";
import { ensureHouseWeatherStubbed } from "@/modules/weather/stubs";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function enumerateDateKeysUtc(startDate: string, endDate: string): string[] {
  const start = String(startDate).trim().slice(0, 10);
  const end = String(endDate).trim().slice(0, 10);
  if (!YYYY_MM_DD.test(start) || !YYYY_MM_DD.test(end) || end < start) return [];
  const out: string[] = [];
  const startMs = new Date(start + "T00:00:00.000Z").getTime();
  const endMs = new Date(end + "T00:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let t = startMs; t <= endMs; t += dayMs) {
    const dateKey = new Date(t).toISOString().slice(0, 10);
    if (YYYY_MM_DD.test(dateKey)) out.push(dateKey);
  }
  return out;
}

/**
 * Ensure house has daily weather for the given date range (e.g. 366 days used for usage).
 * If any dates are missing for ACTUAL_LAST_YEAR, fetches from the weather API and persists;
 * any still missing after fetch are filled with stubs. NORMAL_AVG stubs are also ensured.
 * Call from a frequent path (e.g. simulated usage house fetch) so weather is backfilled when absent.
 * Returns skippedLatLng: true when house has no lat/lng (no API call made; caller can set weatherFallbackReason).
 */
export async function ensureHouseWeatherBackfill(args: {
  houseId: string;
  startDate: string;
  endDate: string;
  timezone?: string;
}): Promise<{ fetched: number; stubbed: number; skippedLatLng?: boolean }> {
  const { houseId, startDate, endDate, timezone } = args;
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
  const boundedStartDate = String(startDate).slice(0, 10) < canonicalCoverage.startDate ? canonicalCoverage.startDate : String(startDate).slice(0, 10);
  const boundedEndDate = String(endDate).slice(0, 10) > canonicalCoverage.endDate ? canonicalCoverage.endDate : String(endDate).slice(0, 10);
  const dateKeys = enumerateDateKeysUtc(boundedStartDate, boundedEndDate);
  if (dateKeys.length === 0) return { fetched: 0, stubbed: 0 };

  // Fetch for dates that have no row or only a STUB_V1 row (so we can replace stale stubs with actual).
  const missingOrStub = await findDateKeysMissingOrStub({
    houseId,
    dateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  if (missingOrStub.length === 0) {
    await ensureHouseWeatherStubbed({ houseId, dateKeys });
    return { fetched: 0, stubbed: 0 };
  }

  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;

  if (lat == null || lon == null) {
    await ensureHouseWeatherStubbed({ houseId, dateKeys });
    return { fetched: 0, stubbed: dateKeys.length, skippedLatLng: true };
  }

  let fetched = 0;
  const minDate = missingOrStub[0]!;
  const maxDate = missingOrStub[missingOrStub.length - 1]!;
  try {
    const weatherResult = await getWeatherForRange(lat, lon, minDate, maxDate, timezone);
    if (!weatherResult.fromStub && weatherResult.rows.length > 0) {
      const dayWxMap = hourlyRowsToDayWxMap(weatherResult.rows, houseId);
      const dateKeysWithActual = missingOrStub.filter((dk) => dayWxMap.has(dk));
      if (dateKeysWithActual.length > 0) {
        // Replace stale STUB_V1 rows with actual: delete stubs so createMany can insert (never deletes real rows).
        await deleteHouseWeatherStubRows({
          houseId,
          dateKeys: dateKeysWithActual,
          kind: "ACTUAL_LAST_YEAR",
        });
        const rowsToInsert = dateKeysWithActual.map((dk) => dayWxMap.get(dk)!);
        fetched = await upsertHouseWeatherDays({ rows: rowsToInsert });
      }
    }
  } catch (err) {
    console.warn("[weather/backfill] getWeatherForRange failed", { houseId, err: err instanceof Error ? err.message : String(err) });
  }

  const stillMissing = await findMissingHouseWeatherDateKeys({
    houseId,
    dateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  await ensureHouseWeatherStubbed({ houseId, dateKeys });
  return { fetched, stubbed: stillMissing.length };
}

const YYYY_MM_DD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Repair stale ACTUAL_LAST_YEAR STUB_V1 rows: delete them and rerun backfill for the range.
 * Safe to rerun. Never deletes or overwrites real weather rows.
 * If startDate/endDate omitted, uses last 366 days from today (UTC).
 */
export async function repairStaleStubWeather(args: {
  houseId: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ deleted: number; fetched: number; stubbed: number }> {
  const { houseId } = args;
  let startDate = (args.startDate?.trim() ?? "").slice(0, 10);
  let endDate = (args.endDate?.trim() ?? "").slice(0, 10);
  if (!startDate || !endDate || !YYYY_MM_DD_RE.test(startDate) || !YYYY_MM_DD_RE.test(endDate)) {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    startDate = canonicalCoverage.startDate;
    endDate = canonicalCoverage.endDate;
  }
  if (startDate > endDate) {
    const t = startDate;
    startDate = endDate;
    endDate = t;
  }

  const stubRows = await (prisma as any).houseDailyWeather
    .findMany({
      where: {
        houseId,
        kind: "ACTUAL_LAST_YEAR",
        source: WEATHER_STUB_SOURCE,
        dateKey: { gte: startDate, lte: endDate },
      },
      select: { dateKey: true },
    })
    .catch(() => []);
  const stubDateKeys: string[] = Array.from(new Set((stubRows ?? []).map((r: { dateKey: string }) => String(r?.dateKey ?? "").slice(0, 10)).filter((k: string) => YYYY_MM_DD_RE.test(k))));
  if (stubDateKeys.length === 0) {
    return { deleted: 0, fetched: 0, stubbed: 0 };
  }

  const deleted = await deleteHouseWeatherStubRows({
    houseId,
    dateKeys: stubDateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  const result = await ensureHouseWeatherBackfill({ houseId, startDate, endDate });
  return { deleted, fetched: result.fetched, stubbed: result.stubbed };
}