import { describe, expect, it } from "vitest";

import { GREEN_BUTTON_INTERVAL_INGEST_VERSION } from "@/lib/usage/greenButtonIngestContract";
import {
  normalizeGreenButtonReadingsTo15Min,
  normalizeGreenButtonReadingsTo15MinChunked,
} from "@/lib/usage/greenButtonNormalize";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";
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
  const blockStartEpochSeconds = Date.UTC(year, month - 1, day, 0, 0, 0, 0) / 1000;
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
      <IntervalBlock xmlns="http://naesb.org/espi"><interval><duration>86400</duration><start>${blockStartEpochSeconds}</start></interval>${readings}</IntervalBlock>
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

const pipelineNow = new Date("2026-01-12T12:00:00.000Z");

describe("runGreenButtonUsagePipeline", () => {
  it("runs parse, normalize, and newest-full-day file-anchor trim as one shared pipeline", () => {
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
      now: pipelineNow,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.coverageStartDateKey).toBe("2026-01-09");
    expect(result.summary.coverageEndDateKey).toBe("2026-01-10");
    expect(result.summary.displayWindowStartDateKey).toBe("2026-01-09");
    expect(result.summary.displayWindowEndDateKey).toBe("2026-01-10");
    expect(result.summary.dataAvailableStartDateKey).toBe("2026-01-08");
    expect(result.summary.dataAvailableEndDateKey).toBe("2026-01-11");
    expect(result.summary.normalizedBeforeTrim).toBe(300);
    expect(result.normalized).toHaveLength(300);
    expect(result.trimmed).toHaveLength(192);
    expect(result.summary.totalKwh).toBe(48);
    expect(result.summary.intervalIngestVersion).toBe(GREEN_BUTTON_INTERVAL_INGEST_VERSION);
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

  it("chunked normalize matches single-pass normalize for the same readings", () => {
    const readings = chicagoCstReadings("2026-01-08", 96);
    const buffer = Buffer.from(readingsToCsv(readings));
    const parsed = parseGreenButtonBuffer(buffer, "usage.csv");
    const single = normalizeGreenButtonReadingsTo15Min(parsed.readings, { maxKwhPerInterval: 10 });
    const chunkedStages: Array<{ chunkIndex: number; chunkCount: number }> = [];
    const result = runGreenButtonUsagePipeline({
      buffer,
      filename: "usage.csv",
      windowDays: 365,
      now: pipelineNow,
      readingsPerChunk: 32,
      onNormalizeChunkComplete: (p) => chunkedStages.push(p),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(chunkedStages.length).toBe(3);
    expect(result.normalized.map((r) => [r.timestamp.getTime(), r.consumptionKwh])).toEqual(
      single.map((r) => [r.timestamp.getTime(), r.consumptionKwh])
    );
  });

  it("uses interval block scan for large XML and matches full-tree parse", () => {
    const xml = smtGreenButtonXmlReadings("2025-12-01", 192, 120);
    const padded = `${"<!-- pad -->\n".repeat(60_000)}${xml}`;
    expect(padded.length).toBeGreaterThan(512 * 1024);

    const blockParsed = parseGreenButtonBuffer(Buffer.from(padded), "large.xml");
    const treeParsed = parseGreenButtonBuffer(Buffer.from(xml), "small.xml");

    expect(blockParsed.metadata.parseMode).toBe("xml_sequential_interval_blocks");
    expect(blockParsed.readings.length).toBe(treeParsed.readings.length);
    expect(blockParsed.readings.map((r) => [r.timestamp, r.value, r.durationSeconds])).toEqual(
      treeParsed.readings.map((r) => [r.timestamp, r.value, r.durationSeconds])
    );
  });

  it("normalizes a full-year ESPI-sized reading count within ingest SLA", { timeout: 30_000 }, () => {
    const count = 36576;
    const startMs = Date.UTC(2024, 5, 1, 5, 0, 0, 0);
    const readings = Array.from({ length: count }, (_, i) => ({
      timestamp: new Date(startMs + i * 15 * 60 * 1000).toISOString(),
      value: 89,
      unit: "Wh",
      durationSeconds: 900,
    }));

    const started = Date.now();
    const normalized = normalizeGreenButtonReadingsTo15MinChunked(readings, { maxKwhPerInterval: 10 });
    const ms = Date.now() - started;

    expect(normalized.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(25_000);
  });

  it("inherits ESPI uom=72 as Wh so SMT Green Button values under 100 are not dropped as kWh outliers", () => {
    const result = runGreenButtonUsagePipeline({
      buffer: Buffer.from(smtGreenButtonXmlReadings("2026-01-10", 96, 89)),
      filename: "IntervalMeterUsage.xml",
      windowDays: 1,
      now: pipelineNow,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized).toHaveLength(96);
    expect(result.trimmed).toHaveLength(96);
    expect(result.summary.totalKwh).toBe(8.544);
  });
});
