/**
 * Backfill house daily weather for the usage window (e.g. 366 days).
 * Fetches actual weather for dates that are missing or have only STUB_V1; replaces stale stubs when API returns data.
 * Never fabricates replacement weather rows.
 */

import { prisma } from "@/lib/db";
import { getWeatherForRange, hourlyRowsToDayWxMap } from "@/lib/sim/weatherProvider";
import { resolveHistoricalDailyTemperatures } from "@/lib/weather/weatherService";
import {
  deleteHouseWeatherStubRows,
  findDateKeysMissingOrStub,
  findMissingHouseWeatherDateKeys,
  upsertHouseWeatherDays,
} from "@/modules/weather/repo";
import { WEATHER_SOURCE, WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const NORMALS_START_DATE = "1991-01-01";
const NORMALS_END_DATE = "2020-12-31";

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

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function cToF(n: number): number {
  return (n * 9) / 5 + 32;
}

function monthDayFromDateKey(dateKey: string): string {
  return String(dateKey ?? "").slice(5, 10);
}

/**
 * Ensure house has daily ACTUAL_LAST_YEAR weather for the given date range.
 * If any dates are missing or stubbed, fetches real weather and persists it.
 * Returns skippedLatLng: true when house has no lat/lng (no API call made).
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
    return { fetched: 0, stubbed: 0 };
  }

  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;

  if (lat == null || lon == null) {
    return { fetched: 0, stubbed: 0, skippedLatLng: true };
  }

  let fetched = 0;
  const minDate = missingOrStub[0]!;
  const maxDate = missingOrStub[missingOrStub.length - 1]!;
  try {
    const weatherResult = await getWeatherForRange(lat, lon, minDate, maxDate, timezone);
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
  } catch (err) {
    throw new Error(
      `[weather/backfill] real weather fetch failed for house ${houseId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const stillMissing = await findMissingHouseWeatherDateKeys({
    houseId,
    dateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  return { fetched, stubbed: stillMissing.length };
}

export async function ensureHouseWeatherNormalAvgBackfill(args: {
  houseId: string;
  dateKeys: string[];
}): Promise<{ fetched: number; missing: number; skippedLatLng?: boolean }> {
  const houseId = String(args.houseId ?? "").trim();
  const dateKeys = (args.dateKeys ?? [])
    .map((dateKey) => String(dateKey ?? "").slice(0, 10))
    .filter((dateKey, index, arr) => YYYY_MM_DD.test(dateKey) && arr.indexOf(dateKey) === index)
    .sort();
  if (!houseId || dateKeys.length === 0) return { fetched: 0, missing: 0 };

  const missingOrStub = await findDateKeysMissingOrStub({
    houseId,
    dateKeys,
    kind: "NORMAL_AVG",
  });
  if (missingOrStub.length === 0) {
    return { fetched: 0, missing: 0 };
  }

  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;
  if (lat == null || lon == null) {
    return { fetched: 0, missing: missingOrStub.length, skippedLatLng: true };
  }

  const historicalDaily = await resolveHistoricalDailyTemperatures(
    lat,
    lon,
    NORMALS_START_DATE,
    NORMALS_END_DATE
  );
  const dailyRows = historicalDaily.rows;
  if (dailyRows.length === 0) {
    throw new Error("No real historical daily temperature rows were returned for NORMAL_AVG backfill.");
  }

  const aggregates = new Map<
    string,
    { sumMeanC: number; sumMinC: number; sumMaxC: number; count: number }
  >();
  for (const row of dailyRows) {
    const monthDay = monthDayFromDateKey(row.dateKey);
    if (
      !/^\d{2}-\d{2}$/.test(monthDay) ||
      row.temperatureMeanC == null ||
      row.temperatureMinC == null ||
      row.temperatureMaxC == null
    ) {
      continue;
    }
    const existing = aggregates.get(monthDay) ?? {
      sumMeanC: 0,
      sumMinC: 0,
      sumMaxC: 0,
      count: 0,
    };
    existing.sumMeanC += row.temperatureMeanC;
    existing.sumMinC += row.temperatureMinC;
    existing.sumMaxC += row.temperatureMaxC;
    existing.count += 1;
    aggregates.set(monthDay, existing);
  }

  const rowsToInsert = missingOrStub
    .map((dateKey) => {
      const aggregate = aggregates.get(monthDayFromDateKey(dateKey));
      if (!aggregate || aggregate.count <= 0) return null;
      const tAvgF = round2(cToF(aggregate.sumMeanC / aggregate.count));
      const tMinF = round2(cToF(aggregate.sumMinC / aggregate.count));
      const tMaxF = round2(cToF(aggregate.sumMaxC / aggregate.count));
      return {
        houseId,
        dateKey,
        kind: "NORMAL_AVG" as const,
        version: 1,
        tAvgF,
        tMinF,
        tMaxF,
        hdd65: round2(Math.max(0, 65 - tAvgF)),
        cdd65: round2(Math.max(0, tAvgF - 65)),
        source: historicalDaily.sourceLabel,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (rowsToInsert.length > 0) {
    await deleteHouseWeatherStubRows({
      houseId,
      dateKeys: rowsToInsert.map((row) => row.dateKey),
      kind: "NORMAL_AVG",
    });
    await upsertHouseWeatherDays({ rows: rowsToInsert });
  }

  const stillMissing = await findDateKeysMissingOrStub({
    houseId,
    dateKeys,
    kind: "NORMAL_AVG",
  });
  return { fetched: rowsToInsert.length, missing: stillMissing.length };
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