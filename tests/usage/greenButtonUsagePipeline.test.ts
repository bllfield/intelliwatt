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
});
