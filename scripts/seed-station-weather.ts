import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../lib/db";
import { resolveHouseWeatherStationId } from "../modules/stationWeather/repo";
import { ensureStationWeatherStubbed } from "../modules/stationWeather/stubs";
import { STATION_WEATHER_DEFAULT_VERSION } from "../modules/stationWeather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

type Args = {
  houseId: string | null;
  start: string | null;
  end: string | null;
  version: number;
};

function loadEnvLocalIfPresent() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex <= 0) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      const rawValue = trimmed.slice(equalIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function parseArgs(argv: string[]): Args {
  let houseId: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let version = STATION_WEATHER_DEFAULT_VERSION;

  for (const arg of argv) {
    if (arg.startsWith("--houseId=")) houseId = arg.slice("--houseId=".length).trim() || null;
    if (arg.startsWith("--start=")) start = arg.slice("--start=".length).trim() || null;
    if (arg.startsWith("--end=")) end = arg.slice("--end=".length).trim() || null;
    if (arg.startsWith("--version=")) {
      const n = Number(arg.slice("--version=".length).trim());
      if (Number.isFinite(n) && n > 0) version = Math.trunc(n);
    }
  }

  return { houseId, start, end, version };
}

function parseYyyyMmDdUtc(raw: string): Date | null {
  const s = String(raw ?? "").slice(0, 10);
  if (!YYYY_MM_DD.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toYyyyMmDdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function enumerateDateKeysUtc(start: string, end: string): string[] {
  const s = parseYyyyMmDdUtc(start);
  const e = parseYyyyMmDdUtc(end);
  if (!s || !e) return [];
  const from = s.getTime() <= e.getTime() ? s : e;
  const to = s.getTime() <= e.getTime() ? e : s;
  const out: string[] = [];
  for (let ms = from.getTime(); ms <= to.getTime(); ms += DAY_MS) {
    out.push(toYyyyMmDdUtc(new Date(ms)));
  }
  return out;
}

async function main() {
  loadEnvLocalIfPresent();
  const args = parseArgs(process.argv.slice(2));
  if (!args.houseId) {
    throw new Error("Missing --houseId=<id>");
  }
  if (!args.start || !args.end) {
    throw new Error("Missing --start=<YYYY-MM-DD> and/or --end=<YYYY-MM-DD>");
  }

  const dateKeys = enumerateDateKeysUtc(args.start, args.end);
  if (dateKeys.length <= 0) {
    throw new Error("Invalid date range. Expected UTC-compatible YYYY-MM-DD values.");
  }

  const station = await resolveHouseWeatherStationId({ houseId: args.houseId });
  await ensureStationWeatherStubbed({
    stationId: station.stationId,
    dateKeys,
    version: args.version,
  });

  console.log(
    `Seeded station weather STUB_V1 for station ${station.stationCode} (${station.stationId}) for ${dateKeys.length} days`
  );
}

main()
  .catch((e) => {
    console.error("[seed-station-weather] error:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
