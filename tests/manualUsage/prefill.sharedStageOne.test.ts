import { describe, expect, it } from "vitest";
import {
  buildManualUsageStageOneResolvedSeeds,
  resolveManualUsageStageOnePayloadForMode,
} from "@/modules/manualUsage/prefill";

describe("manualUsage shared Stage 1 helpers", () => {
  it("builds deterministic monthly and annual actual-derived seeds from shared source context", () => {
    const seedSet = buildManualUsageStageOneResolvedSeeds({
      sourcePayload: null,
      actualEndDate: "2025-04-15",
      travelRanges: [],
      dailyRows: [
        { date: "2025-03-16", kwh: 10 },
        { date: "2025-03-17", kwh: 10 },
        { date: "2025-04-14", kwh: 20 },
        { date: "2025-04-15", kwh: 20 },
      ],
    });

    expect(seedSet.sourceMode).toBe("ACTUAL_INTERVALS_MONTHLY_PREFILL");
    expect(seedSet.monthlySeed).toMatchObject({
      mode: "MONTHLY",
      anchorEndDate: "2025-04-15",
    });
    expect(seedSet.monthlySeed?.statementRanges?.[0]).toMatchObject({
      month: "2025-04",
      endDate: "2025-04-15",
    });
    expect(seedSet.annualSeed).toMatchObject({
      mode: "ANNUAL",
      anchorEndDate: "2025-04-15",
      annualKwh: 60,
    });
  });

  it("prefers saved test-home payloads over source payloads for the matching mode", () => {
    const seedSet = buildManualUsageStageOneResolvedSeeds({
      sourcePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-15",
        monthlyKwh: [{ month: "2025-04", kwh: 456 }],
        statementRanges: [{ month: "2025-04", startDate: "2025-03-16", endDate: "2025-04-15" }],
        travelRanges: [],
      },
      actualEndDate: "2025-04-15",
      travelRanges: [],
      dailyRows: [],
    });

    const resolved = resolveManualUsageStageOnePayloadForMode({
      mode: "MONTHLY",
      testHomePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-15",
        monthlyKwh: [{ month: "2025-04", kwh: 123 }],
        statementRanges: [{ month: "2025-04", startDate: "2025-03-16", endDate: "2025-04-15" }],
        travelRanges: [],
      },
      seedSet,
    });

    expect(resolved.payloadSource).toBe("test_home_saved_payload");
    expect(resolved.payload).toMatchObject({
      mode: "MONTHLY",
      monthlyKwh: [{ month: "2025-04", kwh: 123 }],
    });
  });

  it("does not force monthly payload semantics onto annual mode", () => {
    const seedSet = buildManualUsageStageOneResolvedSeeds({
      sourcePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-15",
        monthlyKwh: [{ month: "2025-04", kwh: 456 }],
        statementRanges: [{ month: "2025-04", startDate: "2025-03-16", endDate: "2025-04-15" }],
        travelRanges: [],
      },
      actualEndDate: "2025-04-15",
      travelRanges: [],
      dailyRows: [],
    });

    const resolved = resolveManualUsageStageOnePayloadForMode({
      mode: "ANNUAL",
      testHomePayload: null,
      seedSet,
    });

    expect(resolved.payloadSource).toBe("actual_derived_seed");
    expect(resolved.payload).toMatchObject({
      mode: "ANNUAL",
      anchorEndDate: "2025-04-15",
      annualKwh: 456,
    });
  });
});
