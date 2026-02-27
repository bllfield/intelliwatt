import { prisma } from "@/lib/db";
import type { WeatherKind } from "@/modules/stationWeather/types";
import {
  STATION_WEATHER_DEFAULT_VERSION,
  STATION_WEATHER_STUB_SOURCE,
} from "@/modules/stationWeather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const INSERT_BATCH_SIZE = 500;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayOfYearUtc(dateKey: string): number {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return 1;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1, 12, 0, 0, 0);
  return Math.max(1, Math.floor((d.getTime() - start) / (24 * 60 * 60 * 1000)) + 1);
}

function hashStringToUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function uniqDateKeys(dateKeys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dateKeys ?? []) {
    const k = String(raw ?? "").slice(0, 10);
    if (!YYYY_MM_DD.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function normalMonthlyAvgF(month1: number): number {
  const m = clamp(month1, 1, 12);
  const normals = [48, 52, 60, 68, 75, 83, 87, 88, 81, 70, 58, 50];
  return normals[m - 1];
}

function normalMonthSwingF(month1: number): number {
  const m = clamp(month1, 1, 12);
  const swings = [12, 12, 13, 14, 14, 13, 12, 12, 13, 13, 12, 12];
  return swings[m - 1];
}

function buildNormalAvgDay(dateKey: string): {
  tAvgF: number;
  tMinF: number;
  tMaxF: number;
  hdd65: number;
  cdd65: number;
} {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  const month1 = Number.isFinite(d.getTime()) ? d.getUTCMonth() + 1 : 1;
  const doy = dayOfYearUtc(dateKey);
  const seasonal = Math.sin((2 * Math.PI * (doy - 1)) / 365);
  const avg = normalMonthlyAvgF(month1) + seasonal * 1.2;
  const swing = normalMonthSwingF(month1);
  const tMinF = round2(avg - swing / 2);
  const tMaxF = round2(avg + swing / 2);
  const tAvgF = round2((tMinF + tMaxF) / 2);
  const hdd65 = round2(Math.max(0, 65 - tAvgF));
  const cdd65 = round2(Math.max(0, tAvgF - 65));
  return { tAvgF, tMinF, tMaxF, hdd65, cdd65 };
}

function buildActualLastYearDay(
  stationId: string,
  dateKey: string
): { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number } {
  const normal = buildNormalAvgDay(dateKey);
  const doy = dayOfYearUtc(dateKey);
  const u = hashStringToUnit(`ACTUAL_LAST_YEAR:${stationId}:${dateKey}`);
  const perturb = Math.sin((2 * Math.PI * (doy - 1)) / 29) * 2.2 + (u - 0.5) * 2.6;
  const tAvgF = round2(normal.tAvgF + perturb);
  const baseSwing = Math.max(8, normal.tMaxF - normal.tMinF);
  const swingAdjust =
    (hashStringToUnit(`SWING:${stationId}:${dateKey}`) - 0.5) * 2.0;
  const swing = clamp(baseSwing + swingAdjust, 7, 20);
  const tMinF = round2(tAvgF - swing / 2);
  const tMaxF = round2(tAvgF + swing / 2);
  const hdd65 = round2(Math.max(0, 65 - tAvgF));
  const cdd65 = round2(Math.max(0, tAvgF - 65));
  return { tAvgF, tMinF, tMaxF, hdd65, cdd65 };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ensureStationWeatherStubbed(args: {
  stationId: string;
  dateKeys: string[];
  version?: number;
}): Promise<void> {
  const stationId = String(args.stationId ?? "").trim();
  const dateKeys = uniqDateKeys(args.dateKeys ?? []);
  const version = Number.isFinite(Number(args.version))
    ? Number(args.version)
    : STATION_WEATHER_DEFAULT_VERSION;
  if (!stationId || dateKeys.length <= 0) return;

  const kinds: WeatherKind[] = ["ACTUAL_LAST_YEAR", "NORMAL_AVG"];

  const existingRows = await (prisma as any).weatherDaily.findMany({
    where: {
      stationId,
      version,
      dateKey: { in: dateKeys },
      kind: { in: kinds },
    },
    select: { dateKey: true, kind: true },
  });
  const existingKeys = new Set<string>(
    (existingRows ?? []).map((r: any) => `${String(r.kind)}|${String(r.dateKey).slice(0, 10)}`)
  );

  const data: Array<{
    stationId: string;
    dateKey: string;
    kind: WeatherKind;
    version: number;
    tAvgF: number;
    tMinF: number;
    tMaxF: number;
    hdd65: number;
    cdd65: number;
    source: string;
  }> = [];

  for (const kind of kinds) {
    for (const dateKey of dateKeys) {
      const key = `${kind}|${dateKey}`;
      if (existingKeys.has(key)) continue;
      const payload =
        kind === "ACTUAL_LAST_YEAR"
          ? buildActualLastYearDay(stationId, dateKey)
          : buildNormalAvgDay(dateKey);
      data.push({
        stationId,
        dateKey,
        kind,
        version,
        tAvgF: payload.tAvgF,
        tMinF: payload.tMinF,
        tMaxF: payload.tMaxF,
        hdd65: payload.hdd65,
        cdd65: payload.cdd65,
        source: STATION_WEATHER_STUB_SOURCE,
      });
    }
  }

  if (data.length <= 0) return;
  for (const batch of chunk(data, INSERT_BATCH_SIZE)) {
    await (prisma as any).weatherDaily.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }
}
