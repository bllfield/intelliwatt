import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { getWeatherSourceMode } from "@/modules/adminSettings/repo";
import {
  findMissingStationWeatherDateKeys,
  getStationWeatherDays,
  resolveHouseWeatherStationId,
} from "@/modules/stationWeather/repo";
import { ensureStationWeatherStubbed } from "@/modules/stationWeather/stubs";
import { STATION_WEATHER_DEFAULT_VERSION } from "@/modules/stationWeather/types";

export const dynamic = "force-dynamic";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toYyyyMmDdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYyyyMmDdUtc(raw: string): Date | null {
  const s = String(raw ?? "").slice(0, 10);
  if (!YYYY_MM_DD.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function defaultRangeUtc(): { start: string; end: string } {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(todayUtc.getTime() - DAY_MS);
  const start = new Date(end.getTime() - 364 * DAY_MS);
  return { start: toYyyyMmDdUtc(start), end: toYyyyMmDdUtc(end) };
}

async function resolveHouseIdByEmail(emailRaw: string): Promise<string | null> {
  const email = String(emailRaw ?? "").trim();
  if (!email) return null;

  const primary = await (prisma as any).houseAddress.findFirst({
    where: {
      userEmail: { equals: email, mode: "insensitive" },
      archivedAt: null,
      isPrimary: true,
    },
    select: { id: true },
  });
  if (primary?.id) return String(primary.id);

  const fallback = await (prisma as any).houseAddress.findFirst({
    where: {
      userEmail: { equals: email, mode: "insensitive" },
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return fallback?.id ? String(fallback.id) : null;
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

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const url = new URL(req.url);
    const email = String(url.searchParams.get("email") ?? "").trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "email is required" },
        { status: 400 }
      );
    }

    const defaults = defaultRangeUtc();
    const end = String(url.searchParams.get("end") ?? defaults.end).slice(0, 10);
    const endDate = parseYyyyMmDdUtc(end);
    if (!endDate) {
      return NextResponse.json(
        { ok: false, error: "Invalid end date. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    const start = toYyyyMmDdUtc(new Date(endDate.getTime() - 364 * DAY_MS));
    const versionParam = Number(url.searchParams.get("version"));
    const version = Number.isFinite(versionParam)
      ? Math.max(1, Math.trunc(versionParam))
      : STATION_WEATHER_DEFAULT_VERSION;

    const dateKeys = enumerateDateKeysUtc(start, end);
    if (dateKeys.length <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid date range. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const houseId = await resolveHouseIdByEmail(email);
    if (!houseId) {
      return NextResponse.json(
        { ok: false, error: "No active house found for that email." },
        { status: 404 }
      );
    }

    const station = await resolveHouseWeatherStationId({ houseId });
    const mode = await getWeatherSourceMode();
    if (mode === "STUB") {
      await ensureStationWeatherStubbed({
        stationId: station.stationId,
        dateKeys,
        version,
      });
    }

    const [actualLastYearRows, normalAvgRows, missingActual, missingNormal] =
      await Promise.all([
        getStationWeatherDays({
          stationId: station.stationId,
          dateKeys,
          kind: "ACTUAL_LAST_YEAR",
          version,
        }),
        getStationWeatherDays({
          stationId: station.stationId,
          dateKeys,
          kind: "NORMAL_AVG",
          version,
        }),
        findMissingStationWeatherDateKeys({
          stationId: station.stationId,
          dateKeys,
          kind: "ACTUAL_LAST_YEAR",
          version,
        }),
        findMissingStationWeatherDateKeys({
          stationId: station.stationId,
          dateKeys,
          kind: "NORMAL_AVG",
          version,
        }),
      ]);

    return NextResponse.json({
      ok: true,
      mode,
      station: { id: station.stationId, code: station.stationCode },
      range: { start: dateKeys[0], end: dateKeys[dateKeys.length - 1], version },
      counts: {
        dateKeys: dateKeys.length,
        actual: actualLastYearRows.length,
        normal: normalAvgRows.length,
      },
      missing: {
        ACTUAL_LAST_YEAR: missingActual,
        NORMAL_AVG: missingNormal,
      },
      actualLastYear: actualLastYearRows,
      normalAvg: normalAvgRows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
