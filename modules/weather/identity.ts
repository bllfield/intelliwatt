import { createHash } from "crypto";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  if (endDate < startDate) return [];
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  let d = Number(startDate.slice(8, 10));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  const endD = Number(endDate.slice(8, 10));
  while (y < endY || (y === endY && m < endM) || (y === endY && m === endM && d <= endD)) {
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

function normalizeNum(value: unknown): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function toStableRows(map: Map<string, any>): Array<Record<string, unknown>> {
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateKey, row]) => ({
      dateKey,
      source: String(row?.source ?? ""),
      tAvgF: normalizeNum(row?.tAvgF),
      tMinF: normalizeNum(row?.tMinF),
      tMaxF: normalizeNum(row?.tMaxF),
      hdd65: normalizeNum(row?.hdd65),
      cdd65: normalizeNum(row?.cdd65),
    }));
}

/**
 * Shared weather identity for Past simulation cache keying.
 * Covers both ACTUAL_LAST_YEAR and NORMAL_AVG weather rows used by shared Past simulation.
 */
export async function computePastWeatherIdentity(args: {
  houseId: string;
  startDate: string;
  endDate: string;
}): Promise<string> {
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
  const requestedStart = String(args.startDate ?? "").slice(0, 10);
  const requestedEnd = String(args.endDate ?? "").slice(0, 10);
  const boundedStartDate =
    requestedStart < canonicalCoverage.startDate ? canonicalCoverage.startDate : requestedStart;
  const boundedEndDate = requestedEnd > canonicalCoverage.endDate ? canonicalCoverage.endDate : requestedEnd;
  const dateKeys = enumerateDateKeysInclusive(boundedStartDate, boundedEndDate);
  if (!args.houseId || dateKeys.length === 0) return "weather:none";

  const [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
    getHouseWeatherDays({ houseId: args.houseId, dateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId: args.houseId, dateKeys, kind: "NORMAL_AVG" }),
  ]);

  const canonical = {
    windowStartUtc: boundedStartDate,
    windowEndUtc: boundedEndDate,
    dateKeyCount: dateKeys.length,
    actual: toStableRows(actualWxByDateKey),
    normal: toStableRows(normalWxByDateKey),
  };
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("base64url");
  return digest.slice(0, 44);
}

