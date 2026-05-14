import { describe, expect, it } from "vitest";

import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

function chicagoCstReadings(dateKey: string, count: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, day, 6, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(startMs + i * 15 * 60 * 1000).toISOString(),
    value: 0.25,
    unit: "kWh",
    durationSeconds: 900,
  }));
}

function readingsToCsv(readings: ReturnType<typeof chicagoCstReadings>) {
  return [
    "timestamp,value,unit,durationSeconds",
    ...readings.map((row) => `${row.timestamp},${row.value},${row.unit},${row.durationSeconds}`),
  ].join("\n");
}

function smtGreenButtonXmlReadings(dateKey: string, count: number, valueWh: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const startEpochSeconds = Date.UTC(year, month - 1, day, 6, 0, 0, 0) / 1000;
  const readings = Array.from({ length: count }, (_, i) => {
    const start = startEpochSeconds + i * 15 * 60;
    return `<IntervalReading><timePeriod><duration>900</duration><start>${start}</start></timePeriod><value>${valueWh}</value></IntervalReading>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:espi="http://naesb.org/espi">
  <entry>
    <title>Central Time</title>
    <content>
      <IntervalBlock xmlns="http://naesb.org/espi">${readings}</IntervalBlock>
    </content>
  </entry>
  <entry>
    <title>Energy Delivered (WH)</title>
    <content>
      <ReadingType xmlns="http://naesb.org/espi">
        <powerOfTenMultiplier>0</powerOfTenMultiplier>
        <uom>72</uom>
      </ReadingType>
    </content>
  </entry>
</feed>`;
}

describe("runGreenButtonUsagePipeline", () => {
  it("runs parse, normalize, and latest full Chicago-day trim as one shared pipeline", () => {
    const readings = [
      ...chicagoCstReadings("2026-01-08", 96),
      ...chicagoCstReadings("2026-01-09", 96),
      ...chicagoCstReadings("2026-01-10", 96),
      ...chicagoCstReadings("2026-01-11", 12),
    ];

    const result = runGreenButtonUsagePipeline({
      buffer: Buffer.from(readingsToCsv(readings)),
      filename: "usage.csv",
      windowDays: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.coverageStartDateKey).toBe("2026-01-09");
    expect(result.summary.coverageEndDateKey).toBe("2026-01-10");
    expect(result.normalized).toHaveLength(300);
    expect(result.trimmed).toHaveLength(192);
    expect(result.summary.totalKwh).toBe(48);
  });

  it("reports no database write requirement for malformed files through structured failure", () => {
    const result = runGreenButtonUsagePipeline({
      buffer: Buffer.from("not xml or csv or json"),
      filename: "bad.txt",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_readings");
    expect(result.parseStatus).toBe("empty");
  });

  it("inherits ESPI uom=72 as Wh so SMT Green Button values under 100 are not dropped as kWh outliers", () => {
    const result = runGreenButtonUsagePipeline({
      buffer: Buffer.from(smtGreenButtonXmlReadings("2025-11-30", 96, 89)),
      filename: "IntervalMeterUsage.xml",
      windowDays: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized).toHaveLength(96);
    expect(result.trimmed).toHaveLength(96);
    expect(result.summary.totalKwh).toBe(8.544);
  });
});
