import { greenButtonShiftedTargetDateKeys } from "@/lib/usage/greenButtonPastYearShiftMerge";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import type { WeatherKind } from "@/modules/weather/types";

export function readGreenButtonSourceDateByTargetDateFromMeta(meta: unknown): Record<string, string> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const raw = (meta as Record<string, unknown>).greenButtonSourceDateByTargetDate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [target, source] of Object.entries(raw as Record<string, unknown>)) {
    const targetKey = String(target ?? "").slice(0, 10);
    const sourceKey = String(source ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetKey) || !/^\d{4}-\d{2}-\d{2}$/.test(sourceKey)) continue;
    out[targetKey] = sourceKey;
  }
  return out;
}

export function greenButtonShiftedTargetDateKeysFromMeta(meta: unknown): Set<string> {
  return greenButtonShiftedTargetDateKeys(readGreenButtonSourceDateByTargetDateFromMeta(meta));
}

export function isGreenButtonPriorYearShiftedDisplayDate(dateKey: string, meta: unknown): boolean {
  const dk = String(dateKey ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return false;
  return greenButtonShiftedTargetDateKeysFromMeta(meta).has(dk);
}

export function buildGreenButtonWeatherLookupDateByDisplayDate(args: {
  displayDateKeys: string[];
  sourceDateByTargetDate: Record<string, string> | null | undefined;
}): Map<string, string> {
  const out = new Map<string, string>();
  for (const dateKey of args.displayDateKeys) {
    const sourceDateKey = String(args.sourceDateByTargetDate?.[dateKey] ?? dateKey).slice(0, 10);
    out.set(dateKey, /^\d{4}-\d{2}-\d{2}$/.test(sourceDateKey) ? sourceDateKey : dateKey);
  }
  return out;
}

function formatDailyWeatherRow(w: {
  tAvgF?: number | null;
  tMinF?: number | null;
  tMaxF?: number | null;
  hdd65?: number | null;
  cdd65?: number | null;
  source?: string | null;
}) {
  return {
    tAvgF: Number(w?.tAvgF) || 0,
    tMinF: Number(w?.tMinF) || 0,
    tMaxF: Number(w?.tMaxF) || 0,
    hdd65: Number(w?.hdd65) || 0,
    cdd65: Number(w?.cdd65) || 0,
    source: String(w?.source ?? "").trim() || null,
  };
}

/**
 * Cached Past rows may already have dailyWeather keyed by display date with wrong (target-year) values.
 * Re-apply source-date weather for Green Button year-shifted display days.
 */
export async function remapGreenButtonShiftedDailyWeatherOnDataset(args: {
  dataset: Record<string, unknown>;
  weatherHouseId: string;
  weatherKind: WeatherKind;
  displayDateKeys?: string[];
}): Promise<number> {
  const sourceDateByTargetDate = readGreenButtonSourceDateByTargetDateFromMeta(args.dataset.meta);
  if (Object.keys(sourceDateByTargetDate).length === 0) return 0;
  const dailyWeather = args.dataset.dailyWeather;
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) return 0;

  const displayDateKeys =
    args.displayDateKeys ??
    (Array.isArray(args.dataset.daily)
      ? (args.dataset.daily as Array<{ date?: unknown }>)
          .map((row) => String(row?.date ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : []);
  if (displayDateKeys.length === 0) return 0;

  const weatherLookupDateByDisplayDate = buildGreenButtonWeatherLookupDateByDisplayDate({
    displayDateKeys,
    sourceDateByTargetDate,
  });
  const shiftedPairs = Array.from(weatherLookupDateByDisplayDate.entries()).filter(
    ([displayDate, lookupDate]) => displayDate !== lookupDate
  );
  if (shiftedPairs.length === 0) return 0;

  const lookupDateKeys = Array.from(
    new Set(shiftedPairs.map(([, lookupDate]) => lookupDate))
  ).sort();
  const lookupWxMap = await getHouseWeatherDays({
    houseId: args.weatherHouseId,
    dateKeys: lookupDateKeys,
    kind: args.weatherKind,
  });

  const weatherRecord = dailyWeather as Record<string, Record<string, unknown>>;
  let patchedCount = 0;
  for (const [displayDate, lookupDate] of shiftedPairs) {
    const weather = lookupWxMap.get(lookupDate);
    if (!weather) continue;
    weatherRecord[displayDate] = formatDailyWeatherRow(weather);
    patchedCount += 1;
  }

  if (patchedCount > 0 && args.dataset.meta && typeof args.dataset.meta === "object") {
    const meta = args.dataset.meta as Record<string, unknown>;
    meta.greenButtonShiftedWeatherDisplayDateCount = shiftedPairs.length;
    meta.greenButtonWeatherDisplayUsesSourceDateMap = true;
  }
  return patchedCount;
}
