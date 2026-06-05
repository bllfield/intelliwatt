import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { createHomeIntervalCalendar, localDateKey } from "@/lib/time/homeIntervalCalendar";
import { buildGreenButtonLoadCurveInsightsFromSeriesRows } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { derivePeakHourFromFifteenMinuteCurve } from "@/lib/usage/fifteenMinuteLoadCurve";
import {
  countDistinctLocalSlotsByDateKey,
  resolveLatestCompleteGreenButtonDateKeyFromSlotCounts,
} from "@/lib/usage/greenButtonLocalSlot";
import { coverageWindowEndingOnDateKey } from "@/lib/usage/canonicalMetadataWindow";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasFixture = fs.existsSync(FIXTURE);

describe("GreenButtonDatanew.xml fixture integrity", () => {
  const home = createHomeIntervalCalendar("America/Chicago");

  it.skipIf(!hasFixture)("supports 365-day baseline window and a 15-minute load curve", () => {
    const result = runGreenButtonUsagePipeline({
      buffer: fs.readFileSync(FIXTURE),
      filename: "GreenButtonDatanew.xml",
      windowDays: 365,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const normalized = result.trimmed;

    expect(normalized.length).toBe(35_040);

    const byHhmm = new Map<string, number>();
    for (const row of normalized) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date(row.timestamp));
      const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
      const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
      const key = `${hour}:${minute}`;
      byHhmm.set(key, (byHhmm.get(key) ?? 0) + 1);
    }
    expect(byHhmm.size).toBeGreaterThanOrEqual(90);

    const anchor = resolveLatestCompleteGreenButtonDateKeyFromSlotCounts(
      countDistinctLocalSlotsByDateKey(normalized.map((row) => ({ timestamp: new Date(row.timestamp) })))
    );
    expect(anchor).not.toBe("2026-03-08");
    const window = anchor ? coverageWindowEndingOnDateKey(anchor, 365) : null;
    expect(window).not.toBeNull();
    if (!window) return;

    const daysInWindow = new Set<string>();
    for (const row of normalized) {
      const iso = new Date(row.timestamp).toISOString();
      const dateKey = localDateKey(iso, home);
      if (!dateKey || dateKey < window.startDate || dateKey > window.endDate) continue;
      daysInWindow.add(dateKey);
    }
    expect(daysInWindow.size).toBe(365);

    const inWindowRows = normalized
      .filter((row) => {
        const dk = localDateKey(new Date(row.timestamp).toISOString(), home);
        return dk && dk >= window.startDate && dk <= window.endDate;
      })
      .map((row) => ({
        timestamp: new Date(row.timestamp).toISOString(),
        kwh: row.consumptionKwh,
      }));
    const sharedDisplayCurve = buildGreenButtonLoadCurveInsightsFromSeriesRows(inWindowRows, {
      homeTimezone: "America/Chicago",
      meta: { greenButtonIntervalTimestampMode: "home_local", actualSource: "GREEN_BUTTON" },
    }).fifteenMinuteAverages;
    const slot00 = sharedDisplayCurve.find((row) => row.hhmm === "00:00")?.avgKw;
    const slot14 = sharedDisplayCurve.find((row) => row.hhmm === "14:00")?.avgKw;
    expect(slot00).toBeCloseTo(1.861, 1);
    expect(slot14).toBeCloseTo(1.616, 1);
    expect(sharedDisplayCurve.length).toBeGreaterThanOrEqual(90);
    const peakHour = derivePeakHourFromFifteenMinuteCurve(sharedDisplayCurve);
    expect(peakHour).not.toBeNull();
    const peakSlot = sharedDisplayCurve.reduce((top, row) => (row.avgKw > top.avgKw ? row : top));
    expect(peakHour?.kw).toBe(peakSlot.avgKw);
    expect(peakHour?.hour).toBe(Number(peakSlot.hhmm.slice(0, 2)));
  }, 120_000);
});
