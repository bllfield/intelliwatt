import { describe, expect, it } from "vitest";

import {
  assertValidationHoldoutProofGates,
  buildValidationHoldoutAuditRow,
  resolveDonorExclusionDatesForValidationTarget,
  resolveValidationCompareMetricLabel,
} from "@/lib/usage/pastValidationHoldout";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { buildHomeDayGridContext, resolveHomeCalendarForActualSource } from "@/lib/time/actualIntervalCalendar";

function buildWeekWindowFixture(args: {
  startDateKey: string;
  endDateKey: string;
  validationDate: string;
  intervalTrustedSource: "GREEN_BUTTON" | "SMT";
  kwhPerSlot?: number;
  trustedActualDateKeys?: string[];
}) {
  const home = resolveHomeCalendarForActualSource(args.intervalTrustedSource, "America/Chicago");
  const gridCtx = buildHomeDayGridContext({
    startDateKey: args.startDateKey,
    endDateKey: args.endDateKey,
    home,
  });
  const canonicalDateKeyByDayStartMs = new Map<number, string>();
  for (const dayStartMs of gridCtx.canonicalDayStartsMs) {
    const gridTs = gridCtx.getDayGridTimestamps(dayStartMs);
    if (!gridTs.length) continue;
    canonicalDateKeyByDayStartMs.set(dayStartMs, gridCtx.dateKeyFromTimestamp(gridTs[0]!));
  }
  const kwhPerSlot = args.kwhPerSlot ?? 1.25;
  const actualIntervals: Array<{ timestamp: string; kwh: number }> = [];
  for (const dayStartMs of gridCtx.canonicalDayStartsMs) {
    for (const ts of gridCtx.getDayGridTimestamps(dayStartMs)) {
      actualIntervals.push({ timestamp: ts, kwh: kwhPerSlot });
    }
  }
  const wx = { tAvgF: 82, tMinF: 72, tMaxF: 92, hdd65: 0, cdd65: 10 };
  const actualWxByDateKey = new Map(
    Array.from(canonicalDateKeyByDayStartMs.values()).map((dk) => [dk, wx] as const)
  );
  const trustedActualDateKeys = new Set(
    args.trustedActualDateKeys ??
      Array.from(canonicalDateKeyByDayStartMs.values()).filter((dk) => dk !== args.validationDate)
  );
  return {
    home,
    gridCtx,
    canonicalDateKeyByDayStartMs,
    actualIntervals,
    actualWxByDateKey,
    validationDate: args.validationDate,
    intervalTrustedSource: args.intervalTrustedSource,
    trustedActualDateKeys,
  };
}

describe("pastValidationHoldout", () => {
  it("strict mode excludes all validation keys from donor pools", () => {
    const excluded = resolveDonorExclusionDatesForValidationTarget({
      validationDate: "2026-05-15",
      validationHoldoutDateKeys: new Set(["2026-05-14", "2026-05-15", "2026-05-16"]),
      mode: "strict_holdout",
    });
    expect(Array.from(excluded).sort()).toEqual(["2026-05-14", "2026-05-15", "2026-05-16"]);
  });

  it("proof gates fail on keep-ref style leakage rows", () => {
    const leaky = buildValidationHoldoutAuditRow({
      sourceType: "SMT",
      validationDate: "2026-05-15",
      validationHoldoutMode: "strict_holdout",
      selectedDonorLocalDates: ["2026-05-15", "2026-05-14"],
      simulatedReasonCode: "TEST_MODELED_KEEP_REF",
      templateSelectionKind: "validation_keep_ref_shared_day_template",
      targetDateExcludedFromDonors: false,
      targetDateExcludedFromShapePool: false,
    });
    const proof = assertValidationHoldoutProofGates([leaky]);
    expect(proof.ok).toBe(false);
    expect(proof.violations.length).toBeGreaterThan(0);
  });

  it("labels pre-fix metrics as Reconstruction check until holdout proof passes", () => {
    expect(resolveValidationCompareMetricLabel(false)).toBe("Reconstruction check");
    expect(resolveValidationCompareMetricLabel(true)).toBe("Holdout WAPE");
  });

  it("Green Button keep-ref path leaks validation day into donor pool (pre-fix reconstruction)", () => {
    const fixture = buildWeekWindowFixture({
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-16",
      validationDate: "2026-05-15",
      intervalTrustedSource: "GREEN_BUTTON",
    });
    const keepRefRun = buildPastSimulatedBaselineV1({
      actualIntervals: fixture.actualIntervals,
      canonicalDayStartsMs: fixture.gridCtx.canonicalDayStartsMs,
      canonicalDateKeyByDayStartMs: fixture.canonicalDateKeyByDayStartMs,
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp: fixture.gridCtx.dateKeyFromTimestamp,
      getDayGridTimestamps: fixture.gridCtx.getDayGridTimestamps,
      intervalTrustedSource: "GREEN_BUTTON",
      trustedActualDateKeys: fixture.trustedActualDateKeys,
      timezoneForProfile: "America/Chicago",
      homeProfile: { squareFeet: 2400 },
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-05": 45 },
        weekendAvgByMonthKey: { "2026-05": 36 },
      },
      actualWxByDateKey: fixture.actualWxByDateKey,
      collectSimulatedDayResults: true,
      forceModeledOutputKeepReferencePoolDateKeys: new Set([fixture.validationDate]),
      modeledDaySelectionStrategy: "weather_donor_first",
    });
    const validationDay = keepRefRun.dayResults.find(
      (r) => String(r.localDate).slice(0, 10) === fixture.validationDate
    );
    expect(validationDay?.simulatedReasonCode).toBe("TEST_MODELED_KEEP_REF");
    const leakyProof = assertValidationHoldoutProofGates([
      buildValidationHoldoutAuditRow({
        sourceType: "GREEN_BUTTON",
        validationDate: fixture.validationDate,
        validationHoldoutMode: "strict_holdout",
        selectedDonorLocalDates: validationDay?.selectedDonorLocalDates ?? [],
        simulatedReasonCode: validationDay?.simulatedReasonCode ?? null,
        templateSelectionKind: validationDay?.templateSelectionKind ?? null,
        targetDateExcludedFromDonors: false,
        targetDateExcludedFromShapePool: false,
      }),
    ]);
    expect(leakyProof.ok).toBe(false);
  });

  it("Green Button validation holdout excludes target from donor pool and passes proof gates", () => {
    const fixture = buildWeekWindowFixture({
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-16",
      validationDate: "2026-05-15",
      intervalTrustedSource: "GREEN_BUTTON",
    });
    const dbg: { referenceDaysUsed?: number; validationHoldoutAuditRows?: unknown[] } = {};
    const run = buildPastSimulatedBaselineV1({
      actualIntervals: fixture.actualIntervals,
      canonicalDayStartsMs: fixture.gridCtx.canonicalDayStartsMs,
      canonicalDateKeyByDayStartMs: fixture.canonicalDateKeyByDayStartMs,
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp: fixture.gridCtx.dateKeyFromTimestamp,
      getDayGridTimestamps: fixture.gridCtx.getDayGridTimestamps,
      intervalTrustedSource: "GREEN_BUTTON",
      trustedActualDateKeys: fixture.trustedActualDateKeys,
      timezoneForProfile: "America/Chicago",
      homeProfile: { squareFeet: 2400 },
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-05": 45 },
        weekendAvgByMonthKey: { "2026-05": 36 },
      },
      actualWxByDateKey: fixture.actualWxByDateKey,
      collectSimulatedDayResults: true,
      validationHoldoutDateKeysLocal: new Set([fixture.validationDate]),
      validationHoldoutMode: "strict_holdout",
      intervalSourceType: "GREEN_BUTTON",
      modeledDaySelectionStrategy: "weather_donor_first",
      debug: { out: dbg as any },
    });
    expect(dbg.referenceDaysUsed).toBe(2);
    const validationDay = run.dayResults.find((r) => String(r.localDate).slice(0, 10) === fixture.validationDate);
    expect(validationDay?.simulatedReasonCode).toBe("VALIDATION_HOLDOUT");
    expect(validationDay?.selectedDonorLocalDates ?? []).not.toContain(fixture.validationDate);
    const proof = assertValidationHoldoutProofGates(
      (dbg.validationHoldoutAuditRows ?? []) as Parameters<typeof assertValidationHoldoutProofGates>[0]
    );
    expect(proof.ok).toBe(true);
    for (const row of dbg.validationHoldoutAuditRows ?? []) {
      expect((row as { sourceType?: string }).sourceType).toBe("GREEN_BUTTON");
    }
  });

  it("SMT keep-ref path leaks validation day into donor pool (pre-fix reconstruction)", () => {
    const fixture = buildWeekWindowFixture({
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-16",
      validationDate: "2026-05-15",
      intervalTrustedSource: "SMT",
    });
    const keepRefRun = buildPastSimulatedBaselineV1({
      actualIntervals: fixture.actualIntervals,
      canonicalDayStartsMs: fixture.gridCtx.canonicalDayStartsMs,
      canonicalDateKeyByDayStartMs: fixture.canonicalDateKeyByDayStartMs,
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp: fixture.gridCtx.dateKeyFromTimestamp,
      getDayGridTimestamps: fixture.gridCtx.getDayGridTimestamps,
      intervalTrustedSource: "SMT",
      trustedActualDateKeys: fixture.trustedActualDateKeys,
      timezoneForProfile: "America/Chicago",
      homeProfile: { squareFeet: 2400 },
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-05": 45 },
        weekendAvgByMonthKey: { "2026-05": 36 },
      },
      actualWxByDateKey: fixture.actualWxByDateKey,
      collectSimulatedDayResults: true,
      forceModeledOutputKeepReferencePoolDateKeys: new Set([fixture.validationDate]),
      modeledDaySelectionStrategy: "weather_donor_first",
    });
    const validationDay = keepRefRun.dayResults.find(
      (r) => String(r.localDate).slice(0, 10) === fixture.validationDate
    );
    expect(validationDay?.simulatedReasonCode).toBe("TEST_MODELED_KEEP_REF");
    const leakyProof = assertValidationHoldoutProofGates([
      buildValidationHoldoutAuditRow({
        sourceType: "SMT",
        validationDate: fixture.validationDate,
        validationHoldoutMode: "strict_holdout",
        selectedDonorLocalDates: validationDay?.selectedDonorLocalDates ?? [],
        simulatedReasonCode: validationDay?.simulatedReasonCode ?? null,
        templateSelectionKind: validationDay?.templateSelectionKind ?? null,
        targetDateExcludedFromDonors: false,
        targetDateExcludedFromShapePool: false,
      }),
    ]);
    expect(leakyProof.ok).toBe(false);
  });

  it("SMT validation holdout excludes target from donor pool and passes proof gates", () => {
    const fixture = buildWeekWindowFixture({
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-16",
      validationDate: "2026-05-15",
      intervalTrustedSource: "SMT",
    });
    const dbg: { referenceDaysUsed?: number; validationHoldoutAuditRows?: unknown[] } = {};
    const run = buildPastSimulatedBaselineV1({
      actualIntervals: fixture.actualIntervals,
      canonicalDayStartsMs: fixture.gridCtx.canonicalDayStartsMs,
      canonicalDateKeyByDayStartMs: fixture.canonicalDateKeyByDayStartMs,
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp: fixture.gridCtx.dateKeyFromTimestamp,
      getDayGridTimestamps: fixture.gridCtx.getDayGridTimestamps,
      intervalTrustedSource: "SMT",
      trustedActualDateKeys: fixture.trustedActualDateKeys,
      timezoneForProfile: "America/Chicago",
      homeProfile: { squareFeet: 2400 },
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-05": 45 },
        weekendAvgByMonthKey: { "2026-05": 36 },
      },
      actualWxByDateKey: fixture.actualWxByDateKey,
      collectSimulatedDayResults: true,
      validationHoldoutDateKeysLocal: new Set([fixture.validationDate]),
      validationHoldoutMode: "strict_holdout",
      intervalSourceType: "SMT",
      modeledDaySelectionStrategy: "weather_donor_first",
      debug: { out: dbg as any },
    });
    expect(dbg.referenceDaysUsed).toBe(2);
    const validationDay = run.dayResults.find((r) => String(r.localDate).slice(0, 10) === fixture.validationDate);
    expect(validationDay?.simulatedReasonCode).toBe("VALIDATION_HOLDOUT");
    expect(validationDay?.selectedDonorLocalDates ?? []).not.toContain(fixture.validationDate);
    const proof = assertValidationHoldoutProofGates(
      (dbg.validationHoldoutAuditRows ?? []) as Parameters<typeof assertValidationHoldoutProofGates>[0]
    );
    expect(proof.ok).toBe(true);
    for (const row of dbg.validationHoldoutAuditRows ?? []) {
      expect((row as { sourceType?: string }).sourceType).toBe("SMT");
    }
  });
});
