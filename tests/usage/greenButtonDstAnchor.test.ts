import fs from "fs";
import path from "path";

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { expectedIntervalsForDateISO } from "@/lib/analysis/dst";
import { greenButtonAnchorDayCompleteThreshold } from "@/lib/usage/greenButtonLocalSlot";
import { dateTimePartsInTimezone } from "@/lib/time/chicago";
import {
  convertRawIntervalsToHome,
  createHomeIntervalCalendar,
  deliveryFromEspiFeedMetadata,
  localSlotIndex,
} from "@/lib/time/homeIntervalCalendar";
import {
  getChicagoDateKeyForTimestamp,
  resolveLatestCompleteOrAvailableGreenButtonDateKey,
} from "@/lib/usage/greenButtonCoverage";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import { extractEspiReadingsFromXmlForTest } from "@/tests/time/helpers/espiXmlTestExtract";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasFixture = fs.existsSync(FIXTURE);

/** Mirrors getLatestGreenButtonFullDayDateKey SQL slot formula (hour * 4 + minute / 15). */
function legacySqlDistinctSlotCount(timestamp: Date): number | null {
  const parts = dateTimePartsInTimezone(timestamp, "America/Chicago");
  if (!parts) return null;
  return parts.hour * 4 + Math.floor(parts.minute / 15);
}

function countDistinctSlotsByDate(
  intervals: Array<{ timestamp: Date }>,
  slotFn: (ts: Date) => number | null,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const row of intervals) {
    const dateKey = getChicagoDateKeyForTimestamp(row.timestamp);
    const slot = slotFn(row.timestamp);
    if (!dateKey || slot == null || slot < 0) continue;
    if (!out.has(dateKey)) out.set(dateKey, new Set());
    out.get(dateKey)!.add(slot);
  }
  return out;
}

describe("Green Button DST anchor regression", () => {
  const home = createHomeIntervalCalendar("America/Chicago");

  it("expects 92 slots on 2026-03-08 spring-forward day", () => {
    expect(expectedIntervalsForDateISO("2026-03-08")).toBe(92);
  });

  it.skipIf(!hasFixture)(
    "fixture: legacy SQL slot counting under-counts days after 2026-03-08 vs home calendar",
    () => {
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

      const legacyByDate = countDistinctSlotsByDate(normalized, legacySqlDistinctSlotCount);
      const homeByDate = countDistinctSlotsByDate(normalized, (ts) =>
        localSlotIndex(ts.toISOString(), home),
      );

      const findAnchor = (byDate: Map<string, Set<number>>) =>
        [...byDate.keys()]
          .sort()
          .reverse()
          .find(
            (dateKey) =>
              (byDate.get(dateKey)?.size ?? 0) >= greenButtonAnchorDayCompleteThreshold(dateKey),
          ) ?? null;

      const pipelineAnchor = resolveLatestCompleteOrAvailableGreenButtonDateKey(normalized);

      const delivery = deliveryFromEspiFeedMetadata({
        tzOffsetSeconds: extracted.tzOffsetSeconds,
        titleHints: extracted.titleHints,
      });
      const converted = convertRawIntervalsToHome(
        extracted.readings.map((row) => ({
          timestamp: row.startSeconds,
          durationSeconds: row.durationSeconds,
          kwh: Number(row.value),
          unit: "Wh",
        })),
        delivery,
        home,
      );
      const convertedByDate = new Map<string, Set<number>>();
      for (const row of converted.intervals) {
        if (!convertedByDate.has(row.homeDateKey)) convertedByDate.set(row.homeDateKey, new Set());
        convertedByDate.get(row.homeDateKey)!.add(row.homeSlot);
      }

      expect(homeByDate.get("2026-03-08")?.size ?? 0).toBeGreaterThanOrEqual(91);

      const normalizedAnchor = findAnchor(homeByDate);
      const convertedAnchor = findAnchor(convertedByDate);

      // Before fix, anchor stuck on spring-forward day while months of data existed in the file.
      expect(normalizedAnchor).not.toBe("2026-03-08");
      expect(convertedAnchor).not.toBe("2026-03-08");
      expect(pipelineAnchor).not.toBe("2026-03-08");
      expect((normalizedAnchor ?? "") >= "2026-05-01").toBe(true);
      expect(convertedAnchor).toBe("2026-05-12");
      expect(pipelineAnchor).toBe("2026-05-12");
    },
    120_000,
  );

  it("home slot index spans 100 distinct values on fall-back day", () => {
    const dateKey = "2026-11-01";
    const start = DateTime.fromISO(dateKey, { zone: "America/Chicago" }).startOf("day");
    const slots = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      const ts = start.plus({ minutes: i * 15 }).toUTC().toISO();
      if (!ts) continue;
      slots.add(localSlotIndex(ts, home));
    }
    expect(slots.size).toBe(100);
    expect(legacySqlDistinctSlotCount(new Date(start.plus({ hours: 1, minutes: 30 }).toUTC().toMillis()))).toBe(6);
  });
});
