import { prisma } from "@/lib/db";
import {
  DEFAULT_WEATHER_SOURCE_MODE,
  WEATHER_SOURCE_MODE_FLAG_KEY,
  type WeatherSourceMode,
} from "@/modules/adminSettings/types";

function normalizeWeatherSourceMode(raw: string): WeatherSourceMode {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "REAL_API") return "REAL_API";
  if (v === "STUB") return "STUB";
  return DEFAULT_WEATHER_SOURCE_MODE;
}

export async function getWeatherSourceMode(): Promise<WeatherSourceMode> {
  const row = await prisma.featureFlag.findUnique({
    where: { key: WEATHER_SOURCE_MODE_FLAG_KEY },
    select: { value: true },
  });
  if (!row?.value) return DEFAULT_WEATHER_SOURCE_MODE;
  return normalizeWeatherSourceMode(row.value);
}

export async function setWeatherSourceMode(mode: WeatherSourceMode): Promise<void> {
  const value = normalizeWeatherSourceMode(mode);
  await prisma.featureFlag.upsert({
    where: { key: WEATHER_SOURCE_MODE_FLAG_KEY },
    create: { key: WEATHER_SOURCE_MODE_FLAG_KEY, value },
    update: { value },
  });
}
