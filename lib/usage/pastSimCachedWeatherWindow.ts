import { enumerateDateKeysInclusive } from "@/lib/time/chicago";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import type { WeatherKind } from "@/modules/weather/types";
import {
  resolveWeatherKindForLogicMode,
  type WeatherLogicMode,
} from "@/modules/onePathSim/usageSimulator/pastSimWeatherPolicy";

export type CachedWeatherSourceOwner = "cached_weather" | "artifact_daily_weather" | "fresh_fetch";

export type CanonicalDailyWeatherRow = {
  tAvgF: number;
  tMinF: number;
  tMaxF: number;
  hdd65: number;
  cdd65: number;
  source?: string | null;
};

export type CachedWeatherWindowCoverage = {
  complete: boolean;
  requiredDateCount: number;
  foundDateCount: number;
  missingDateKeys: string[];
  dailyWeatherByDateKey: Record<string, CanonicalDailyWeatherRow>;
  sourceOwner: CachedWeatherSourceOwner;
  requiredStartDate: string;
  requiredEndDate: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pickFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isUsableDailyWeatherRow(row: unknown): row is CanonicalDailyWeatherRow {
  const record = asRecord(row);
  const tAvgF = pickFiniteNumber(record.tAvgF ?? record.avgF);
  const tMinF = pickFiniteNumber(record.tMinF ?? record.minF);
  const tMaxF = pickFiniteNumber(record.tMaxF ?? record.maxF);
  const hdd65 = pickFiniteNumber(record.hdd65);
  const cdd65 = pickFiniteNumber(record.cdd65);
  if (tAvgF == null || tMinF == null || tMaxF == null || hdd65 == null || cdd65 == null) return false;
  const source = String(record.source ?? "").trim();
  if (source === WEATHER_STUB_SOURCE) return false;
  return true;
}

export function normalizeDailyWeatherRow(row: unknown): CanonicalDailyWeatherRow | null {
  if (!isUsableDailyWeatherRow(row)) return null;
  const record = asRecord(row);
  return {
    tAvgF: pickFiniteNumber(record.tAvgF ?? record.avgF) ?? 0,
    tMinF: pickFiniteNumber(record.tMinF ?? record.minF) ?? 0,
    tMaxF: pickFiniteNumber(record.tMaxF ?? record.maxF) ?? 0,
    hdd65: pickFiniteNumber(record.hdd65) ?? 0,
    cdd65: pickFiniteNumber(record.cdd65) ?? 0,
    source: String(record.source ?? "").trim() || null,
  };
}

export function readDailyWeatherFromDataset(
  dataset: Record<string, unknown> | null | undefined
): Record<string, CanonicalDailyWeatherRow> | null {
  if (!dataset || typeof dataset !== "object") return null;
  const meta = asRecord(dataset.meta);
  const fromMeta = asRecord(meta.dailyWeatherByDateKey);
  if (Object.keys(fromMeta).length > 0) {
    const out: Record<string, CanonicalDailyWeatherRow> = {};
    for (const [dateKey, row] of Object.entries(fromMeta)) {
      const normalized = normalizeDailyWeatherRow(row);
      if (normalized) out[dateKey] = normalized;
    }
    if (Object.keys(out).length > 0) return out;
  }
  const fromDataset = asRecord(dataset.dailyWeather);
  if (Object.keys(fromDataset).length > 0) {
    const out: Record<string, CanonicalDailyWeatherRow> = {};
    for (const [dateKey, row] of Object.entries(fromDataset)) {
      const normalized = normalizeDailyWeatherRow(row);
      if (normalized) out[dateKey] = normalized;
    }
    if (Object.keys(out).length > 0) return out;
  }
  return null;
}

export function dailyWeatherRecordToHouseWeatherMap(
  record: Record<string, CanonicalDailyWeatherRow>,
  args: { houseId: string; kind: WeatherKind }
): Map<string, ReturnType<typeof getHouseWeatherDays> extends Map<string, infer T> ? T : never> {
  const out = new Map<string, any>();
  for (const [dateKey, row] of Object.entries(record)) {
    out.set(dateKey, {
      houseId: args.houseId,
      dateKey,
      kind: args.kind,
      version: 1,
      tAvgF: row.tAvgF,
      tMinF: row.tMinF,
      tMaxF: row.tMaxF,
      hdd65: row.hdd65,
      cdd65: row.cdd65,
      source: String(row.source ?? "").trim() || "ARTIFACT_CACHE",
    });
  }
  return out;
}

function assessCoverageFromRecord(args: {
  requiredDateKeys: string[];
  dailyWeatherByDateKey: Record<string, CanonicalDailyWeatherRow>;
  sourceOwner: CachedWeatherSourceOwner;
  requiredStartDate: string;
  requiredEndDate: string;
}): CachedWeatherWindowCoverage {
  const missingDateKeys: string[] = [];
  for (const dateKey of args.requiredDateKeys) {
    if (!isUsableDailyWeatherRow(args.dailyWeatherByDateKey[dateKey])) missingDateKeys.push(dateKey);
  }
  return {
    complete: missingDateKeys.length === 0,
    requiredDateCount: args.requiredDateKeys.length,
    foundDateCount: args.requiredDateKeys.length - missingDateKeys.length,
    missingDateKeys,
    dailyWeatherByDateKey: args.dailyWeatherByDateKey,
    sourceOwner: args.sourceOwner,
    requiredStartDate: args.requiredStartDate,
    requiredEndDate: args.requiredEndDate,
  };
}

export function assessCachedWeatherWindowCoverage(args: {
  requiredDateKeys: string[];
  dailyWeatherByDateKey: Record<string, CanonicalDailyWeatherRow>;
  sourceOwner: CachedWeatherSourceOwner;
  startDateKey?: string;
  endDateKey?: string;
}): CachedWeatherWindowCoverage {
  const requiredDateKeys = args.requiredDateKeys.filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  const requiredStartDate =
    args.startDateKey?.slice(0, 10) ??
    (requiredDateKeys.length > 0 ? requiredDateKeys[0]! : "");
  const requiredEndDate =
    args.endDateKey?.slice(0, 10) ??
    (requiredDateKeys.length > 0 ? requiredDateKeys[requiredDateKeys.length - 1]! : "");
  return assessCoverageFromRecord({
    requiredDateKeys,
    dailyWeatherByDateKey: args.dailyWeatherByDateKey,
    sourceOwner: args.sourceOwner,
    requiredStartDate,
    requiredEndDate,
  });
}

export async function getCachedWeatherWindowCoverage(args: {
  houseId: string;
  startDateKey: string;
  endDateKey: string;
  timezone?: string;
  requiredDateKeys?: string[];
  artifactDailyWeather?: Record<string, CanonicalDailyWeatherRow> | null;
  weatherLogicMode?: WeatherLogicMode;
  skipDbLookup?: boolean;
}): Promise<CachedWeatherWindowCoverage> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  void timezone;
  const startDateKey = String(args.startDateKey ?? "").slice(0, 10);
  const endDateKey = String(args.endDateKey ?? "").slice(0, 10);
  const requiredDateKeys =
    Array.isArray(args.requiredDateKeys) && args.requiredDateKeys.length > 0
      ? args.requiredDateKeys.filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : enumerateDateKeysInclusive(startDateKey, endDateKey);

  const seededDailyWeather: Record<string, CanonicalDailyWeatherRow> = {
    ...(args.artifactDailyWeather ?? {}),
  };

  if (Object.keys(seededDailyWeather).length > 0) {
    const artifactCoverage = assessCoverageFromRecord({
      requiredDateKeys,
      dailyWeatherByDateKey: seededDailyWeather,
      sourceOwner: "artifact_daily_weather",
      requiredStartDate: startDateKey,
      requiredEndDate: endDateKey,
    });
    if (artifactCoverage.complete || args.skipDbLookup === true) return artifactCoverage;
  } else if (args.skipDbLookup === true) {
    return assessCoverageFromRecord({
      requiredDateKeys,
      dailyWeatherByDateKey: {},
      sourceOwner: "artifact_daily_weather",
      requiredStartDate: startDateKey,
      requiredEndDate: endDateKey,
    });
  }

  const weatherLogicMode = args.weatherLogicMode ?? "LAST_YEAR_ACTUAL_WEATHER";
  const weatherKind = resolveWeatherKindForLogicMode(weatherLogicMode);
  const keysStillMissing = requiredDateKeys.filter((dateKey) => !isUsableDailyWeatherRow(seededDailyWeather[dateKey]));
  const wxMap = await getHouseWeatherDays({
    houseId: args.houseId,
    dateKeys: keysStillMissing.length > 0 ? keysStillMissing : requiredDateKeys,
    kind: weatherKind,
  });
  const dailyWeatherByDateKey: Record<string, CanonicalDailyWeatherRow> = { ...seededDailyWeather };
  for (const dateKey of requiredDateKeys) {
    const normalized =
      normalizeDailyWeatherRow(dailyWeatherByDateKey[dateKey]) ?? normalizeDailyWeatherRow(wxMap.get(dateKey));
    if (normalized) dailyWeatherByDateKey[dateKey] = normalized;
  }
  const mergedSourceOwner =
    Object.keys(seededDailyWeather).length > 0
      ? assessCoverageFromRecord({
          requiredDateKeys,
          dailyWeatherByDateKey,
          sourceOwner: "artifact_daily_weather",
          requiredStartDate: startDateKey,
          requiredEndDate: endDateKey,
        }).complete
        ? "artifact_daily_weather"
        : "cached_weather"
      : "cached_weather";
  return assessCoverageFromRecord({
    requiredDateKeys,
    dailyWeatherByDateKey,
    sourceOwner: mergedSourceOwner,
    requiredStartDate: startDateKey,
    requiredEndDate: endDateKey,
  });
}

export function persistPastSimArtifactWeatherFields(args: {
  dataset: Record<string, unknown>;
  dailyWeatherByDateKey: Record<string, CanonicalDailyWeatherRow>;
  sourceOwner?: CachedWeatherSourceOwner;
}): void {
  const meta = asRecord(args.dataset.meta);
  meta.dailyWeatherByDateKey = args.dailyWeatherByDateKey;
  if (args.sourceOwner) meta.dailyWeatherSourceOwner = args.sourceOwner;
  args.dataset.dailyWeather = args.dailyWeatherByDateKey;
  args.dataset.meta = meta;
}

export function buildWeatherWindowCoverageAudit(coverage: CachedWeatherWindowCoverage) {
  return {
    requiredStartDate: coverage.requiredStartDate,
    requiredEndDate: coverage.requiredEndDate,
    requiredDateCount: coverage.requiredDateCount,
    foundDateCount: coverage.foundDateCount,
    complete: coverage.complete,
    missingDateKeysCount: coverage.missingDateKeys.length,
    sourceOwner: coverage.sourceOwner,
  };
}

export function mapSelectedWeatherToDailyWeatherRecord(
  selectedWeatherByDateKey: Map<string, { tAvgF?: number; tMinF?: number; tMaxF?: number; hdd65?: number; cdd65?: number; source?: string }>
): Record<string, CanonicalDailyWeatherRow> {
  const out: Record<string, CanonicalDailyWeatherRow> = {};
  for (const [dateKey, w] of Array.from(selectedWeatherByDateKey.entries())) {
    const normalized = normalizeDailyWeatherRow(w);
    if (normalized) out[dateKey] = normalized;
  }
  return out;
}
