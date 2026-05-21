import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { createHomeIntervalCalendar, localDateKey } from "@/lib/time/homeIntervalCalendar";
import { resolveLatestCompleteOrAvailableGreenButtonDateKey } from "@/lib/usage/greenButtonCoverage";
import { coverageWindowEndingOnDateKey } from "@/lib/usage/canonicalMetadataWindow";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { extractEspiReadingsFromXmlForTest } from "@/tests/time/helpers/espiXmlTestExtract";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasFixture = fs.existsSync(FIXTURE);

describe("GreenButtonDatanew.xml fixture integrity", () => {
  const home = createHomeIntervalCalendar("America/Chicago");

  it.skipIf(!hasFixture)("supports 365-day baseline window and a 15-minute load curve", () => {
    const xml = fs.readFileSync(FIXTURE, "utf8");
    const extracted = extractEspiReadingsFromXmlForTest(xml);
    const normalized = normalizeGreenButtonReadingsTo15Min(
      extracted.readings.map((row) => ({
        timestamp: row.startSeconds,
        durationSeconds: row.durationSeconds,
        value: Number(row.value),
        unit: "Wh",
      })),
      { maxKwhPerInterval: 10 },
    );

    expect(normalized.length).toBeGreaterThan(30_000);

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

    const anchor = resolveLatestCompleteOrAvailableGreenButtonDateKey(
      normalized.map((row) => ({ timestamp: new Date(row.timestamp) })),
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
  }, 120_000);
});
