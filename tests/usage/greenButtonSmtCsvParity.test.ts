import fs from "fs";
import path from "path";

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { localDateKey, createHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";
import { buildGreenButtonLoadCurveInsightsFromSeriesRows } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

const XML_FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const CSV_FIXTURE = path.join(process.cwd(), "docs", "GREEN BUTTON CSV NOT GB.csv");
const hasFixtures = fs.existsSync(XML_FIXTURE) && fs.existsSync(CSV_FIXTURE);

const WINDOW_START = "2025-05-13";
const WINDOW_END = "2026-05-12";
const HOME = createHomeIntervalCalendar("America/Chicago");

type CsvSlotRow = {
  dateKey: string;
  hhmm: string;
  kwh: number;
};

function parseSmtCsvFixture(content: string): CsvSlotRow[] {
  const rows: CsvSlotRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("ESIID")) continue;
    const parts = trimmed.split(",");
    if (parts.length < 6) continue;
    const usageDate = parts[1]?.trim();
    const startTime = parts[3]?.trim();
    const kwh = Number(parts[5]?.trim());
    if (!usageDate || !startTime || !Number.isFinite(kwh)) continue;
    const [month, day, year] = usageDate.split("/").map(Number);
    if (!year || !month || !day) continue;
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const [hourText, minuteText] = startTime.split(":");
    const hhmm = `${String(Number(hourText)).padStart(2, "0")}:${String(Number(minuteText)).padStart(2, "0")}`;
    rows.push({ dateKey, hhmm, kwh });
  }
  return rows;
}

function csvDailyKwhTotals(rows: CsvSlotRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.dateKey, (out.get(row.dateKey) ?? 0) + row.kwh);
  }
  return out;
}

function xmlDailyKwhTotals(
  intervals: Array<{ timestamp: Date; consumptionKwh: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of intervals) {
    const dateKey = localDateKey(row.timestamp.toISOString(), HOME);
    if (!dateKey) continue;
    out.set(dateKey, (out.get(dateKey) ?? 0) + row.consumptionKwh);
  }
  return out;
}

function chicagoHhmmFromUtc(ts: Date): string {
  return DateTime.fromJSDate(ts, { zone: "utc" }).setZone("America/Chicago").toFormat("HH:mm");
}

describe("SMT Green Button XML sequential ingest vs SMT CSV truth", () => {
  it.skipIf(!hasFixtures)(
    "matches CSV window totals, spot checks, and year slot averages",
    () => {
      const csvRows = parseSmtCsvFixture(fs.readFileSync(CSV_FIXTURE, "utf8"));
      const csvInWindow = csvRows.filter((r) => r.dateKey >= WINDOW_START && r.dateKey <= WINDOW_END);
      const csvDailyTotals = csvDailyKwhTotals(csvInWindow);

      const result = runGreenButtonUsagePipeline({
        buffer: fs.readFileSync(XML_FIXTURE),
        filename: "GreenButtonDatanew.xml",
        windowDays: 365,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const inWindow = result.normalized.filter((row) => {
        const dateKey = localDateKey(row.timestamp.toISOString(), HOME);
        return dateKey != null && dateKey >= WINDOW_START && dateKey <= WINDOW_END;
      });

      expect(inWindow).toHaveLength(35_040);
      const windowKwh = inWindow.reduce((sum, row) => sum + row.consumptionKwh, 0);
      expect(windowKwh).toBeCloseTo(14_141.07, 2);

      const days = new Set(
        inWindow.map((row) => localDateKey(row.timestamp.toISOString(), HOME)).filter(Boolean),
      );
      expect(days.size).toBe(365);

      const day513 = inWindow.filter(
        (row) => localDateKey(row.timestamp.toISOString(), HOME) === "2025-05-13",
      );
      expect(day513).toHaveLength(96);
      const day513Kwh = day513.reduce((sum, row) => sum + row.consumptionKwh, 0);
      expect(day513Kwh).toBeCloseTo(76.883, 2);

      for (const [hhmm, expected] of [
        ["00:00", 0.857],
        ["00:15", 0.466],
        ["00:30", 0.362],
        ["07:30", 2.254],
        ["21:15", 2.791],
        ["23:45", 0.679],
      ] as const) {
        const row = day513.find((r) => chicagoHhmmFromUtc(r.timestamp) === hhmm);
        expect(row?.consumptionKwh).toBeCloseTo(expected, 3);
      }

      const xmlDailyTotals = xmlDailyKwhTotals(inWindow);
      for (const [dateKey, csvDayKwh] of csvDailyTotals) {
        expect(xmlDailyTotals.get(dateKey)).toBeCloseTo(csvDayKwh, 2);
      }

      const dstCounts = {
        "2025-11-02": result.trimmed.filter(
          (r) => localDateKey(r.timestamp.toISOString(), HOME) === "2025-11-02",
        ).length,
        "2026-03-08": result.trimmed.filter(
          (r) => localDateKey(r.timestamp.toISOString(), HOME) === "2026-03-08",
        ).length,
      };
      expect(dstCounts["2025-11-02"]).toBe(100);
      expect(dstCounts["2026-03-08"]).toBe(92);

      const curveRows = result.trimmed.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        kwh: row.consumptionKwh,
      }));
      const curve = buildGreenButtonLoadCurveInsightsFromSeriesRows(curveRows, {
        homeTimezone: "America/Chicago",
        meta: { greenButtonIntervalTimestampMode: "home_local", actualSource: "GREEN_BUTTON" },
      }).fifteenMinuteAverages;

      const slot00 = curve.find((row) => row.hhmm === "00:00");
      const slot14 = curve.find((row) => row.hhmm === "14:00");
      expect(slot00?.avgKw).toBeCloseTo(1.861, 1);
      expect(slot14?.avgKw).toBeCloseTo(1.616, 1);
    },
    180_000,
  );
});
