import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { parseGreenButtonBuffer } from "@/lib/usage/greenButtonParser";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasFixture = fs.existsSync(FIXTURE);

function smtXmlWithUomAfterIntervals(intervalCount: number, valueWh: number): string {
  const startEpochSeconds = Date.UTC(2026, 0, 10, 6, 0, 0, 0) / 1000;
  const readings = Array.from({ length: intervalCount }, (_, i) => {
    const start = startEpochSeconds + i * 15 * 60;
    return `<IntervalReading><timePeriod><duration>900</duration><start>${start}</start></timePeriod><value>${valueWh}</value></IntervalReading>`;
  }).join("");
  const pad = "<!-- x -->".repeat(60_000);
  return `<?xml version="1.0"?><feed><title>SMT Green Button Report: Interval</title>${pad}${readings}<entry><content><ReadingType><uom>72</uom><powerOfTenMultiplier>0</powerOfTenMultiplier></ReadingType></content></entry></feed>`;
}

describe("parseGreenButtonBuffer SMT Wh unit", () => {
  it("applies Wh from ReadingType uom=72 when metadata is after interval blocks", () => {
    const xml = smtXmlWithUomAfterIntervals(96, 89);
    expect(xml.length).toBeGreaterThan(512 * 1024);

    const parsed = parseGreenButtonBuffer(Buffer.from(xml), "large-smt.xml");
    expect(parsed.metadata.parseMode).toBe("xml_interval_blocks");
    expect(parsed.readings).toHaveLength(96);
    expect(parsed.readings.every((r) => r.unit === "Wh")).toBe(true);

    const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
    expect(normalized).toHaveLength(96);
    expect(normalized.every((r) => r.consumptionKwh <= 10)).toBe(true);
    expect(normalized.reduce((s, r) => s + r.consumptionKwh, 0)).toBeCloseTo(8.544, 3);
  });

  it.skipIf(!hasFixture)(
    "GreenButtonDatanew.xml block parse assigns Wh so sub-100 Wh values are not treated as kWh",
    () => {
      const parsed = parseGreenButtonBuffer(fs.readFileSync(FIXTURE), "GreenButtonDatanew.xml");
      expect(parsed.readings.length).toBe(36_576);
      expect(parsed.metadata.parseMode).toBe("xml_interval_blocks");
      expect(parsed.readings.every((r) => r.unit === "Wh")).toBe(true);

      const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
      expect(normalized.length).toBeGreaterThan(36_000);
      expect(normalized.filter((r) => r.consumptionKwh > 10).length).toBe(0);
      expect(Math.max(...normalized.map((r) => r.consumptionKwh))).toBeLessThan(5);
    },
    120_000
  );
});
