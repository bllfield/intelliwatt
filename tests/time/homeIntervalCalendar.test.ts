import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  convertRawIntervalsToHome,
  createHomeIntervalCalendar,
  deliveryFromEspiFeedMetadata,
  expectedSlotsForLocalDate,
  inferSourceTimezoneFromFeed,
  localDateKey,
  localSlotIndex,
  resolveIntervalInstant,
} from "@/lib/time/homeIntervalCalendar";
import { extractEspiReadingsFromXmlForTest } from "@/tests/time/helpers/espiXmlTestExtract";

const GREEN_BUTTON_FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasGreenButtonFixture = fs.existsSync(GREEN_BUTTON_FIXTURE);

describe("homeIntervalCalendar", () => {
  const home = createHomeIntervalCalendar("America/Chicago");

  it("parses naive Central wall clock without assuming UTC", () => {
    const resolved = resolveIntervalInstant(
      { timestamp: "2026-05-18T23:30:00", kwh: 0.5 },
      { encoding: "naive_wall_clock", sourceTimezone: "America/Chicago", intervalEdge: "start" },
    );
    expect(resolved?.tsUtcIso).toBe("2026-05-19T04:30:00.000Z");
  });

  it("parses unix epoch UTC for ESPI without re-labeling as Central", () => {
    const delivery = deliveryFromEspiFeedMetadata({
      tzOffsetSeconds: 18_000,
      titleHints: ["Central Time"],
    });
    const resolved = resolveIntervalInstant(
      { timestamp: 1_745_798_400, kwh: 89, unit: "Wh" },
      delivery,
    );
    expect(resolved?.tsUtcIso).toBe("2025-04-28T00:00:00.000Z");
  });

  it("infers America/Chicago from Central Time title", () => {
    expect(
      inferSourceTimezoneFromFeed({ tzOffsetSeconds: 18_000, titleHints: ["Central Time"] }),
    ).toBe("America/Chicago");
  });

  it("expects 92 slots on Chicago spring-forward day", () => {
    expect(expectedSlotsForLocalDate("2026-03-08", home)).toBe(92);
  });

  it("expects 100 slots on Chicago fall-back day", () => {
    expect(expectedSlotsForLocalDate("2026-11-01", home)).toBe(100);
  });

  it("assigns late-evening UTC instant to previous Chicago calendar day", () => {
    const ts = "2026-05-19T04:30:00.000Z";
    expect(localDateKey(ts, home)).toBe("2026-05-18");
    expect(localSlotIndex(ts, home)).toBe(94);
  });

  it("aggregates daily kWh in home timezone", () => {
    const delivery = deliveryFromEspiFeedMetadata({ titleHints: ["Central Time"] });
    const result = convertRawIntervalsToHome(
      [
        { timestamp: 1_745_798_400, kwh: 1000, unit: "Wh" },
        { timestamp: 1_745_798_400 + 900, kwh: 2000, unit: "Wh" },
      ],
      delivery,
      home,
    );
    expect(result.intervals).toHaveLength(2);
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]?.kwh).toBeCloseTo(3, 5);
    expect(result.daily[0]?.homeDateKey).toBe("2025-04-27");
  });

  it.skipIf(!hasGreenButtonFixture)(
    "converts docs/GreenButtonDatanew.xml through the module",
    () => {
      const xml = fs.readFileSync(GREEN_BUTTON_FIXTURE, "utf8");
      const extracted = extractEspiReadingsFromXmlForTest(xml);

      const delivery = deliveryFromEspiFeedMetadata({
        tzOffsetSeconds: extracted.tzOffsetSeconds,
        titleHints: extracted.titleHints,
      });
      const result = convertRawIntervalsToHome(
        extracted.readings.map((row) => ({
          timestamp: row.startSeconds,
          durationSeconds: row.durationSeconds,
          kwh: Number(row.value),
          unit: "Wh",
        })),
        delivery,
        home,
      );

      expect(extracted.readings.length).toBeGreaterThan(36_000);
      expect(extracted.tzOffsetSeconds).toBe(18_000);
      expect(delivery.encoding).toBe("unix_seconds_utc");
      expect(delivery.sourceTimezone).toBe("America/Chicago");

      expect(result.intervals.length).toBeGreaterThan(36_000);
      expect(result.firstTsUtc).toBe("2025-04-28T00:00:00.000Z");
      expect(result.lastTsUtc).toBe("2026-05-14T00:00:00.000Z");
      expect(result.totalKwh).toBeGreaterThan(0);
      expect(result.homeCoverageStart).toBe("2025-04-27");
      expect(result.homeCoverageEnd).toBe("2026-05-13");

      const first = result.intervals[0];
      expect(first?.homeDateKey).toBe("2025-04-27");
      expect(first?.homeSlot).toBe(76);

      const dstDay = result.daily.find((d) => d.homeDateKey === "2026-03-08");
      expect(dstDay?.slotsExpected).toBe(92);

      const dailyKwhSum = result.daily.reduce((s, d) => s + d.kwh, 0);
      expect(dailyKwhSum).toBeCloseTo(result.totalKwh, 3);
    },
    120_000,
  );
});
