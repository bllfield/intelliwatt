import { prisma } from "@/lib/db";
import type { DayWeather, DayWeatherByDateKey, WeatherKind } from "@/modules/weather/types";
import { WEATHER_STUB_VERSION } from "@/modules/weather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function uniqDateKeys(dateKeys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dateKeys ?? []) {
    const v = String(raw ?? "").slice(0, 10);
    if (!YYYY_MM_DD.test(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function getHouseWeatherDays(args: {
  houseId: string;
  dateKeys: string[];
  kind: WeatherKind;
  version?: number;
}): Promise<DayWeatherByDateKey> {
  const version = Number.isFinite(Number(args.version)) ? Number(args.version) : WEATHER_STUB_VERSION;
  const dateKeys = uniqDateKeys(args.dateKeys ?? []);
  const out: DayWeatherByDateKey = new Map<string, DayWeather>();
  if (!args.houseId || dateKeys.length <= 0) return out;

  const rows = await (prisma as any).houseDailyWeather
    .findMany({
      where: {
        houseId: args.houseId,
        kind: args.kind,
        version,
        dateKey: { in: dateKeys },
      },
      select: {
        houseId: true,
        dateKey: true,
        kind: true,
        version: true,
        tAvgF: true,
        tMinF: true,
        tMaxF: true,
        hdd65: true,
        cdd65: true,
        source: true,
      },
    })
    .catch(() => []);

  for (const r of rows ?? []) {
    const dateKey = String(r?.dateKey ?? "").slice(0, 10);
    if (!YYYY_MM_DD.test(dateKey)) continue;
    out.set(dateKey, {
      houseId: String(r?.houseId ?? ""),
      dateKey,
      kind: String(r?.kind ?? "") as WeatherKind,
      version: Number(r?.version) || version,
      tAvgF: Number(r?.tAvgF) || 0,
      tMinF: Number(r?.tMinF) || 0,
      tMaxF: Number(r?.tMaxF) || 0,
      hdd65: Number(r?.hdd65) || 0,
      cdd65: Number(r?.cdd65) || 0,
      source: String(r?.source ?? ""),
    });
  }

  return out;
}

export async function findMissingHouseWeatherDateKeys(args: {
  houseId: string;
  dateKeys: string[];
  kind: WeatherKind;
  version?: number;
}): Promise<string[]> {
  const version = Number.isFinite(Number(args.version)) ? Number(args.version) : WEATHER_STUB_VERSION;
  const dateKeys = uniqDateKeys(args.dateKeys ?? []);
  if (!args.houseId || dateKeys.length <= 0) return [];

  const existingRows = await (prisma as any).houseDailyWeather
    .findMany({
      where: {
        houseId: args.houseId,
        kind: args.kind,
        version,
        dateKey: { in: dateKeys },
      },
      select: { dateKey: true },
    })
    .catch(() => []);
  const existing = new Set<string>((existingRows ?? []).map((r: any) => String(r?.dateKey ?? "").slice(0, 10)));
  return dateKeys.filter((k) => !existing.has(k));
}

export async function upsertHouseWeatherDays(args: {
  rows: DayWeather[];
}): Promise<number> {
  const rows = args.rows ?? [];
  if (rows.length <= 0) return 0;
  const data = rows
    .map((r) => ({
      houseId: String(r.houseId ?? ""),
      dateKey: String(r.dateKey ?? "").slice(0, 10),
      kind: String(r.kind ?? ""),
      version: Number(r.version) || WEATHER_STUB_VERSION,
      tAvgF: Number(r.tAvgF) || 0,
      tMinF: Number(r.tMinF) || 0,
      tMaxF: Number(r.tMaxF) || 0,
      hdd65: Number(r.hdd65) || 0,
      cdd65: Number(r.cdd65) || 0,
      source: String(r.source ?? ""),
    }))
    .filter((r) => r.houseId.length > 0 && YYYY_MM_DD.test(r.dateKey) && (r.kind === "ACTUAL_LAST_YEAR" || r.kind === "NORMAL_AVG"));
  if (data.length <= 0) return 0;

  const res = await (prisma as any).houseDailyWeather
    .createMany({
      data,
      skipDuplicates: true,
    })
    .catch(() => ({ count: 0 }));
  return Number(res?.count) || 0;
}
