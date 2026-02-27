import { prisma } from "@/lib/db";
import { STATION_SEEDS, pickNearestStationCode } from "@/modules/stationWeather/stations";
import type { DayWeather, WeatherKind } from "@/modules/stationWeather/types";
import { STATION_WEATHER_DEFAULT_VERSION } from "@/modules/stationWeather/types";

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

function normalizeStationCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

export async function getOrCreateWeatherStationByCode(
  code: string
): Promise<{ id: string; code: string }> {
  const stationCode = normalizeStationCode(code);
  if (!stationCode) throw new Error("station_code_required");

  const existing = await (prisma as any).weatherStation.findUnique({
    where: { code: stationCode },
    select: { id: true, code: true },
  });
  if (existing?.id) return { id: String(existing.id), code: String(existing.code) };

  const seed = STATION_SEEDS.find((s) => s.code === stationCode);
  const created = await (prisma as any).weatherStation.create({
    data: {
      code: stationCode,
      name: seed?.name ?? null,
      lat: Number(seed?.lat),
      lon: Number(seed?.lon),
    },
    select: { id: true, code: true },
  });
  return { id: String(created.id), code: String(created.code) };
}

export async function resolveHouseWeatherStationId(args: {
  houseId: string;
}): Promise<{ stationId: string; stationCode: string }> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) throw new Error("house_id_required");

  const house = await (prisma as any).houseAddress.findUnique({
    where: { id: houseId },
    select: {
      id: true,
      addressZip5: true,
      lat: true,
      lng: true,
      weatherStationId: true,
    },
  });
  if (!house?.id) throw new Error("house_not_found");

  const currentStationId = String(house.weatherStationId ?? "").trim();
  if (currentStationId) {
    const station = await (prisma as any).weatherStation.findUnique({
      where: { id: currentStationId },
      select: { id: true, code: true },
    });
    if (station?.id && station?.code) {
      return { stationId: String(station.id), stationCode: String(station.code) };
    }
  }

  const stationCode = pickNearestStationCode({
    lat: Number(house.lat),
    lon: Number(house.lng),
    zip: String(house.addressZip5 ?? ""),
  });
  const station = await getOrCreateWeatherStationByCode(stationCode);

  await (prisma as any).houseAddress.update({
    where: { id: houseId },
    data: { weatherStationId: station.id },
    select: { id: true },
  });

  return { stationId: station.id, stationCode: station.code };
}

export async function getStationWeatherDays(args: {
  stationId: string;
  dateKeys: string[];
  kind: WeatherKind;
  version: number;
}): Promise<DayWeather[]> {
  const stationId = String(args.stationId ?? "").trim();
  const dateKeys = uniqDateKeys(args.dateKeys ?? []);
  const version = Number.isFinite(Number(args.version))
    ? Number(args.version)
    : STATION_WEATHER_DEFAULT_VERSION;
  if (!stationId || dateKeys.length <= 0) return [];

  const rows = await (prisma as any).weatherDaily.findMany({
    where: {
      stationId,
      kind: args.kind,
      version,
      dateKey: { in: dateKeys },
    },
    select: {
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
    orderBy: [{ dateKey: "asc" }],
  });

  return (rows ?? [])
    .map((r: any) => ({
      dateKey: String(r?.dateKey ?? "").slice(0, 10),
      kind: String(r?.kind ?? "") as WeatherKind,
      version: Number(r?.version) || version,
      tAvgF: Number(r?.tAvgF) || 0,
      tMinF: Number(r?.tMinF) || 0,
      tMaxF: Number(r?.tMaxF) || 0,
      hdd65: Number(r?.hdd65) || 0,
      cdd65: Number(r?.cdd65) || 0,
      source: String(r?.source ?? ""),
    }))
    .filter((r: DayWeather) => YYYY_MM_DD.test(r.dateKey));
}

export async function findMissingStationWeatherDateKeys(args: {
  stationId: string;
  dateKeys: string[];
  kind: WeatherKind;
  version: number;
}): Promise<string[]> {
  const stationId = String(args.stationId ?? "").trim();
  const dateKeys = uniqDateKeys(args.dateKeys ?? []);
  const version = Number.isFinite(Number(args.version))
    ? Number(args.version)
    : STATION_WEATHER_DEFAULT_VERSION;
  if (!stationId || dateKeys.length <= 0) return [];

  const existingRows = await (prisma as any).weatherDaily.findMany({
    where: {
      stationId,
      kind: args.kind,
      version,
      dateKey: { in: dateKeys },
    },
    select: { dateKey: true },
  });
  const existing = new Set<string>(
    (existingRows ?? []).map((r: any) => String(r?.dateKey ?? "").slice(0, 10))
  );
  return dateKeys.filter((k) => !existing.has(k));
}
