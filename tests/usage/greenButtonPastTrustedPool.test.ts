import { describe, expect, it } from "vitest";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { homeProjectedIntervalFromRecord } from "@/lib/time/actualIntervalCalendar";
import {
  materializeGreenButtonPastProducerIntervals,
  pruneGreenButtonTrustedDaysFromPastDatasetMeta,
  resolveGreenButtonPastSimTrustedHomeDateKeys,
  resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals,
} from "@/lib/usage/greenButtonPastTrustedPool";
import {
  resolveGreenButtonPastValidationCandidateDateKeys,
  resolveGreenButtonPastValidationSelectionAfterSim,
} from "@/lib/usage/greenButtonPastValidationCandidates";

describe("greenButtonPastTrustedPool", () => {
  it("maps UTC trusted keys to home-local keys for Past Sim", () => {
    const utcGridIntervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      consumptionKwh: 0.25,
    }));
    const projected = convertGreenButtonPersistedRowsToHome(utcGridIntervals).intervals.map(
      homeProjectedIntervalFromRecord
    );
    const trustedHome = resolveGreenButtonPastSimTrustedHomeDateKeys({
      trustedUtcDateKeys: ["2026-05-14"],
      intervals: projected,
      timezone: "America/Chicago",
    });
    expect(trustedHome.size).toBeGreaterThan(0);
    for (const homeKey of trustedHome) {
      expect(projected.some((row) => row.homeDateKey === homeKey)).toBe(true);
    }
  });

  it("uses producer trustedHomeDateKeys when provided (home-local Past producer pool)", () => {
    const candidates = resolveGreenButtonPastValidationCandidateDateKeys({
      trustedUtcDateKeys: [],
      trustedHomeDateKeys: new Set(["2026-05-14", "2026-05-15", "2026-05-16"]),
      intervals: [],
      timezone: "America/Chicago",
      windowStart: "2026-05-14",
      windowEnd: "2026-05-16",
    });
    expect(candidates).toEqual(["2026-05-14", "2026-05-15", "2026-05-16"]);
  });

  it("includes year-shifted target days in post-sim validation selection", () => {
    const utcGridIntervals = Array.from({ length: 96 * 3 }, (_, index) => {
      const dayOffset = Math.floor(index / 96);
      const slot = index % 96;
      const day = String(10 + dayOffset).padStart(2, "0");
      return {
        timestamp: new Date(`2026-04-${day}T${String(Math.floor((slot * 15) / 60)).padStart(2, "0")}:${String((slot * 15) % 60).padStart(2, "0")}:00.000Z`).toISOString(),
        kwh: 0.25,
      };
    });
    const selection = resolveGreenButtonPastValidationSelectionAfterSim({
      existingSelectedKeys: [],
      datasetMeta: {
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
        greenButtonSourceDateByTargetDate: {
          "2026-04-12": "2025-04-12",
          "2026-04-13": "2025-04-13",
        },
      },
      decodedIntervals15: utcGridIntervals,
      timezone: "America/Chicago",
      houseId: "house-1",
      validationDayCount: 14,
    });
    expect(selection).not.toBeNull();
    expect(selection?.validationOnlyDateKeysLocal.length).toBeGreaterThan(0);
  });

  it("builds a validation candidate pool larger than Chicago 96/96 on raw UTC timestamps", () => {
    const utcGridIntervals = Array.from({ length: 96 * 3 }, (_, index) => {
      const dayOffset = Math.floor(index / 96);
      const slot = index % 96;
      const day = String(14 + dayOffset).padStart(2, "0");
      return {
        timestamp: new Date(`2026-05-${day}T${String(Math.floor((slot * 15) / 60)).padStart(2, "0")}:${String((slot * 15) % 60).padStart(2, "0")}:00.000Z`),
        consumptionKwh: 0.25,
      };
    });
    const candidates = resolveGreenButtonPastValidationCandidateDateKeys({
      trustedUtcDateKeys: ["2026-05-14", "2026-05-15", "2026-05-16"],
      intervals: utcGridIntervals.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        kwh: row.consumptionKwh,
      })),
      timezone: "America/Chicago",
      windowStart: "2026-05-14",
      windowEnd: "2026-05-16",
    });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("materializes preloaded raw UTC-grid intervals with home slots for trusted-day detection", () => {
    const raw = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
    }));
    const materialized = materializeGreenButtonPastProducerIntervals({
      sourceIntervals: raw,
      timezone: "America/Chicago",
    });
    expect(materialized.length).toBe(96);
    expect(materialized.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.homeDateKey))).toBe(true);
    expect(materialized.every((row) => Number.isFinite(row.homeSlot))).toBe(true);
    const trustedHome = resolveGreenButtonPastSimTrustedHomeDateKeys({
      trustedUtcDateKeys: ["2026-05-14"],
      intervals: materialized,
      timezone: "America/Chicago",
    });
    expect(trustedHome.size).toBeGreaterThan(0);
  });

  it("resolves trusted home keys from decoded intervals without adapter fetch metadata", () => {
    const utcGridIntervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
    }));
    const trustedHome = resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals({
      decodedIntervals: utcGridIntervals,
      trustedUtcDateKeys: ["2026-05-14"],
      timezone: "America/Chicago",
    });
    expect(trustedHome.size).toBeGreaterThan(0);
  });

  it("resolveGreenButtonPastValidationSelectionAfterSim picks keys from decoded artifact intervals", () => {
    const utcGridIntervals = Array.from({ length: 96 * 14 }, (_, index) => {
      const dayOffset = Math.floor(index / 96);
      const slot = index % 96;
      const day = String(10 + dayOffset).padStart(2, "0");
      return {
        timestamp: new Date(`2026-04-${day}T${String(Math.floor((slot * 15) / 60)).padStart(2, "0")}:${String((slot * 15) % 60).padStart(2, "0")}:00.000Z`).toISOString(),
        kwh: 0.25,
      };
    });
    const selection = resolveGreenButtonPastValidationSelectionAfterSim({
      existingSelectedKeys: [],
      datasetMeta: { actualSource: "GREEN_BUTTON", timezone: "America/Chicago" },
      decodedIntervals15: utcGridIntervals,
      timezone: "America/Chicago",
      houseId: "house-1",
      validationDayCount: 14,
    });
    expect(selection).not.toBeNull();
    expect(selection?.validationOnlyDateKeysLocal.length).toBeGreaterThan(0);
    expect(selection?.validationOnlyDateKeysLocal.length).toBeLessThanOrEqual(14);
    expect(Object.keys(selection?.validationActualDailyKwhByDateLocal ?? {}).length).toBe(
      selection?.validationOnlyDateKeysLocal.length
    );
  });

  it("pruneGreenButtonTrustedDaysFromPastDatasetMeta drops incomplete-meter canonical only, not test-day compare truth", () => {
    const meta: Record<string, unknown> = {
      simulatedSourceDetailByDate: {
        "2025-11-02": "SIMULATED_TEST_DAY",
        "2026-05-14": "SIMULATED_INCOMPLETE_METER",
      },
      canonicalArtifactSimulatedDayTotalsByDate: {
        "2025-11-02": 17.47,
        "2026-05-14": 12.1,
      },
    };
    pruneGreenButtonTrustedDaysFromPastDatasetMeta(meta, new Set(["2025-11-02", "2026-05-14"]));
    expect((meta.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number>)["2025-11-02"]).toBe(17.47);
    expect((meta.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number>)["2026-05-14"]).toBeUndefined();
  });
});
