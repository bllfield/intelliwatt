/**
 * Weather cache repository. Reads/writes WeatherHourly by bucketed coordinates.
 * Used only via weatherService — simulator must never call Open-Meteo directly.
 */

import { prisma } from "@/lib/db";

export type WeatherHourlyRow = {
  timestampUtc: Date;
  temperatureC: number | null;
  cloudcoverPct: number | null;
  solarRadiation: number | null;
};

/**
 * Get cached hourly weather for a bucket and date range.
 * Returns rows in ascending timestamp order.
 */
export async function getWeatherRange(
  latBucket: number,
  lonBucket: number,
  startDate: Date,
  endDate: Date
): Promise<WeatherHourlyRow[]> {
  const rows = await prisma.weatherHourly.findMany({
    where: {
      latBucket,
      lonBucket,
      timestampUtc: { gte: startDate, lte: endDate },
    },
    orderBy: { timestampUtc: "asc" },
    select: {
      timestampUtc: true,
      temperatureC: true,
      cloudcoverPct: true,
      solarRadiation: true,
    },
  });
  return rows.map((r) => ({
    timestampUtc: r.timestampUtc,
    temperatureC: r.temperatureC ?? null,
    cloudcoverPct: r.cloudcoverPct ?? null,
    solarRadiation: r.solarRadiation ?? null,
  }));
}

/**
 * Insert a batch of hourly weather rows for a bucket.
 * Caller must ensure (latBucket, lonBucket, timestampUtc) are set and no duplicates.
 */
export async function insertWeatherBatch(
  latBucket: number,
  lonBucket: number,
  rows: WeatherHourlyRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const data = rows.map((r) => ({
    latBucket,
    lonBucket,
    timestampUtc: r.timestampUtc,
    temperatureC: r.temperatureC,
    cloudcoverPct: r.cloudcoverPct,
    solarRadiation: r.solarRadiation,
  }));
  await prisma.weatherHourly.createMany({ data, skipDuplicates: true });
  return data.length;
}

/**
 * Check whether the cache fully covers the requested UTC hour range for a bucket.
 * Returns true only if every hour in [startDate, endDate] has at least one row.
 */
export async function hasFullCoverage(
  latBucket: number,
  lonBucket: number,
  startDate: Date,
  endDate: Date
): Promise<boolean> {
  const count = await prisma.weatherHourly.count({
    where: {
      latBucket,
      lonBucket,
      timestampUtc: { gte: startDate, lte: endDate },
    },
  });
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const hoursExpected = Math.round((endMs - startMs) / (60 * 60 * 1000)) + 1;
  return count >= hoursExpected;
}
