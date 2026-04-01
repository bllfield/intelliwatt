import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { resolveAdminHouseSelection } from "@/lib/admin/adminHouseLookup";
import { getWeatherSourceMode } from "@/modules/adminSettings/repo";
import {
  findMissingStationWeatherDateKeys,
  getStationWeatherDays,
  resolveHouseWeatherStationId,
} from "@/modules/stationWeather/repo";
import { ensureStationWeatherStubbed } from "@/modules/stationWeather/stubs";
import { STATION_WEATHER_DEFAULT_VERSION } from "@/modules/stationWeather/types";
import {
  findMissingHouseWeatherDateKeys,
} from "@/modules/weather/repo";
import type { DayWeather } from "@/modules/weather/types";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { loadWeatherForPastWindow } from "@/modules/simulatedUsage/simulatePastUsageDataset";

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

function isDayWeather(value: DayWeather | undefined): value is DayWeather {
  return Boolean(value);
}

function summarizeSourceLabels(rows: DayWeather[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row.source ?? "").trim())
        .filter(Boolean)
    )
  ).sort();
}

function countStubRows(rows: DayWeather[]): number {
  return rows.filter((row) => String(row.source ?? "").trim() === WEATHER_STUB_SOURCE).length;
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

    const selectedHouse = await resolveAdminHouseSelection({ email });
    if (!selectedHouse?.id) {
      return NextResponse.json(
        { ok: false, error: "No active house found for that email." },
        { status: 404 }
      );
    }
    const houseId = selectedHouse.id;

    const station = await resolveHouseWeatherStationId({ houseId });
    const mode = await getWeatherSourceMode();
    if (mode === "STUB") {
      await ensureStationWeatherStubbed({
        stationId: station.stationId,
        dateKeys,
        version,
      });
    }
    const [sharedActualSelection, sharedNormalSelection] = await Promise.all([
      loadWeatherForPastWindow({
        houseId,
        startDate: dateKeys[0]!,
        endDate: dateKeys[dateKeys.length - 1]!,
        canonicalDateKeys: dateKeys,
        weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
      }),
      loadWeatherForPastWindow({
        houseId,
        startDate: dateKeys[0]!,
        endDate: dateKeys[dateKeys.length - 1]!,
        canonicalDateKeys: dateKeys,
        weatherLogicMode: "LONG_TERM_AVERAGE_WEATHER",
      }),
    ]);

    const [
      actualLastYearRows,
      normalAvgRows,
      missingActual,
      missingNormal,
      houseMissingActual,
      houseMissingNormal,
    ] =
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
        findMissingHouseWeatherDateKeys({
          houseId,
          dateKeys,
          kind: "ACTUAL_LAST_YEAR",
        }),
        findMissingHouseWeatherDateKeys({
          houseId,
          dateKeys,
          kind: "NORMAL_AVG",
        }),
      ]);
    const houseActualRowsMap = sharedActualSelection.actualWxByDateKey;
    const houseNormalRowsMap = sharedNormalSelection.normalWxByDateKey;
    const houseActualRows = dateKeys
      .map((dateKey) => houseActualRowsMap.get(dateKey))
      .filter(isDayWeather);
    const houseNormalRows = dateKeys
      .map((dateKey) => houseNormalRowsMap.get(dateKey))
      .filter(isDayWeather);

    return NextResponse.json({
      ok: true,
      mode,
      house: {
        id: houseId,
        label: selectedHouse.label,
      },
      station: { id: station.stationId, code: station.stationCode },
      range: { start: dateKeys[0], end: dateKeys[dateKeys.length - 1], version },
      counts: {
        dateKeys: dateKeys.length,
        actual: actualLastYearRows.length,
        normal: normalAvgRows.length,
        houseActual: houseActualRows.length,
        houseNormal: houseNormalRows.length,
      },
      missing: {
        ACTUAL_LAST_YEAR: missingActual,
        NORMAL_AVG: missingNormal,
        HOUSE_ACTUAL_LAST_YEAR: houseMissingActual,
        HOUSE_NORMAL_AVG: houseMissingNormal,
      },
      actualLastYear: actualLastYearRows,
      normalAvg: normalAvgRows,
      houseActualLastYear: houseActualRows,
      houseNormalAvg: houseNormalRows,
      sharedHouseWeatherPath: {
        module: "loadWeatherForPastWindow",
        consumers: ["Past Sim", "GapFill"],
        actualSelection: {
          weatherLogicMode: sharedActualSelection.provenance.weatherLogicMode ?? "LAST_YEAR_ACTUAL_WEATHER",
          weatherSourceSummary: sharedActualSelection.provenance.weatherSourceSummary,
          weatherFallbackReason: sharedActualSelection.provenance.weatherFallbackReason,
          sourceLabels: summarizeSourceLabels(houseActualRows),
          selectedRowCount: houseActualRows.length,
          stubRowCount: countStubRows(houseActualRows),
          nonStubRowCount: houseActualRows.length - countStubRows(houseActualRows),
        },
        normalSelection: {
          weatherLogicMode: sharedNormalSelection.provenance.weatherLogicMode ?? "LONG_TERM_AVERAGE_WEATHER",
          weatherSourceSummary: sharedNormalSelection.provenance.weatherSourceSummary,
          weatherFallbackReason: sharedNormalSelection.provenance.weatherFallbackReason,
          sourceLabels: summarizeSourceLabels(houseNormalRows),
          selectedRowCount: houseNormalRows.length,
          stubRowCount: countStubRows(houseNormalRows),
          nonStubRowCount: houseNormalRows.length - countStubRows(houseNormalRows),
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
