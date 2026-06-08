import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  extractPersistIntervals15,
  isManualCanonicalArtifactWindowPersistEnabled,
  MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV,
  prepareManualPastDatasetForArtifactPersist,
  resolveManualPastPersistUsageInputMode,
  shouldProjectManualPastDatasetAtPersist,
} from "@/lib/usage/manualPastArtifactCanonicalWindowPersist";
import { MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION } from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

function addDays(dateKey: string, days: number): string {
  const dt = new Date(`${dateKey}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) out.push(current);
  return out;
}

function buildManualBillWindowDataset(args?: { mode?: "MONTHLY" | "ANNUAL"; anchorEndDate?: string }) {
  const startDate = "2025-06-05";
  const endDate = "2026-06-04";
  const dates = enumerateDateKeysInclusive(startDate, endDate);
  const totalKwh = dates.length;
  return {
    summary: { start: startDate, end: endDate, totalKwh },
    meta: {
      anchorEndDate: args?.anchorEndDate ?? "2026-06-06",
    },
    totals: { importKwh: totalKwh, exportKwh: 0, netKwh: totalKwh },
    daily: dates.map((date) => ({ date, kwh: 1, source: "SIMULATED" })),
    insights: {
      timeOfDayBuckets: [
        { key: "overnight", label: "Overnight (12am–6am)", kwh: 90 },
        { key: "morning", label: "Morning (6am–12pm)", kwh: 90 },
        { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 90 },
        { key: "evening", label: "Evening (6pm–12am)", kwh: 95 },
      ],
    },
    series: {
      intervals15: dates.map((date) => ({ timestamp: `${date}T00:00:00.000Z`, kwh: 1 })),
    },
    manualUsageMode: args?.mode ?? "MONTHLY",
  };
}

describe("manualPastArtifactCanonicalWindowPersist", () => {
  const annualProofNow = new Date("2026-06-08T18:00:00.000Z");
  const canonicalAnnual = resolveCanonicalUsage365CoverageWindow(annualProofNow);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables persist projection only when MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST=1", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    expect(isManualCanonicalArtifactWindowPersistEnabled()).toBe(true);
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "0");
    expect(isManualCanonicalArtifactWindowPersistEnabled()).toBe(false);
  });

  it("resolves manual monthly and annual usage input modes for MANUAL_TOTALS", () => {
    expect(
      resolveManualPastPersistUsageInputMode({
        simMode: "MANUAL_TOTALS",
        manualUsagePayload: { mode: "MONTHLY" },
      })
    ).toBe("MANUAL_MONTHLY");
    expect(
      resolveManualPastPersistUsageInputMode({
        simMode: "MANUAL_TOTALS",
        manualUsagePayload: { mode: "ANNUAL" },
      })
    ).toBe("MANUAL_ANNUAL");
    expect(resolveManualPastPersistUsageInputMode({ simMode: "SMT_BASELINE" })).toBeNull();
  });

  it("projects One Path-style manual monthly artifacts when the flag is enabled", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    const source = buildManualBillWindowDataset({ mode: "MONTHLY" });
    let legacyApplied = false;

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "MANUAL_TOTALS",
      scenarioKey: "PAST",
      manualUsagePayload: { mode: "MONTHLY" },
      now: annualProofNow,
      applyLegacyCanonicalCoverageMetadata: () => {
        legacyApplied = true;
      },
    });

    expect(out.projected).toBe(true);
    expect(legacyApplied).toBe(false);
    expect(out.dataset.summary.start).toBe(canonicalAnnual.startDate);
    expect(out.dataset.summary.end).toBe(canonicalAnnual.endDate);
    expect(out.dataset.meta.manualCanonicalArtifactWindowVersion).toBe(
      MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION
    );
  });

  it("projects manual annual artifacts to canonical coverage when the flag is enabled", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    const source = buildManualBillWindowDataset({ mode: "ANNUAL", anchorEndDate: "2026-06-06" });

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "MANUAL_TOTALS",
      scenarioKey: "PAST",
      manualUsagePayload: { mode: "ANNUAL" },
      now: annualProofNow,
      applyLegacyCanonicalCoverageMetadata: () => {},
    });

    expect(out.projected).toBe(true);
    expect(out.dataset.summary.start).toBe("2025-06-07");
    expect(out.dataset.summary.end).toBe("2026-06-06");
    expect(out.dataset.meta.manualBillPeriodWindow).toMatchObject({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      simulationWindowStart: "2025-06-05",
      simulationWindowEnd: "2026-06-04",
      anchorEndDate: "2026-06-06",
      source: "bill_period_input",
    });
  });

  it("uses the same projection behavior for user-site manual persist prep", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    const source = buildManualBillWindowDataset({ mode: "ANNUAL" });

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "MANUAL_TOTALS",
      scenarioKey: "PAST",
      manualUsagePayload: { mode: "ANNUAL" },
      buildInputs: { mode: "MANUAL_TOTALS" },
      now: annualProofNow,
      applyLegacyCanonicalCoverageMetadata: () => {
        source.summary.start = "2025-06-05";
        source.summary.end = "2026-06-04";
      },
    });

    expect(out.projected).toBe(true);
    expect(out.dataset.meta.manualCanonicalArtifactWindowVersion).toBe(
      MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION
    );
    expect(out.persistWindowStartDate).toBe("2025-06-07");
    expect(out.persistWindowEndDate).toBe("2026-06-06");
  });

  it("preserves total kWh and recomputes monthly/time-of-day buckets after projection", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    const source = buildManualBillWindowDataset({ mode: "ANNUAL" });
    const sourceTotal = source.daily.reduce((sum, row) => sum + row.kwh, 0);

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "MANUAL_TOTALS",
      scenarioKey: "PAST",
      manualUsagePayload: { mode: "ANNUAL" },
      now: annualProofNow,
      applyLegacyCanonicalCoverageMetadata: () => {},
    });

    const projectedDailyTotal = out.dataset.daily.reduce(
      (sum: number, row: { kwh: number }) => sum + row.kwh,
      0
    );
    const monthlyTotal = out.dataset.monthly.reduce(
      (sum: number, row: { kwh: number }) => sum + row.kwh,
      0
    );
    const bucketTotal = out.dataset.insights.timeOfDayBuckets.reduce(
      (sum: number, row: { kwh: number }) => sum + row.kwh,
      0
    );

    expect(projectedDailyTotal).toBe(sourceTotal);
    expect(monthlyTotal).toBe(sourceTotal);
    expect(bucketTotal).toBe(sourceTotal);
    expect(extractPersistIntervals15(out.dataset)).toHaveLength(365);
  });

  it("keeps legacy behavior when the flag is disabled", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "0");
    const source = buildManualBillWindowDataset({ mode: "ANNUAL" });
    let legacyApplied = false;

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "MANUAL_TOTALS",
      scenarioKey: "PAST",
      manualUsagePayload: { mode: "ANNUAL" },
      now: annualProofNow,
      applyLegacyCanonicalCoverageMetadata: () => {
        legacyApplied = true;
        source.summary.start = "2025-06-07";
        source.summary.end = "2026-06-06";
      },
    });

    expect(out.projected).toBe(false);
    expect(legacyApplied).toBe(true);
    expect(out.dataset.meta.manualCanonicalArtifactWindowVersion).toBeUndefined();
    expect(out.persistWindowStartDate).toBeNull();
  });

  it("does not project unsupported non-manual datasets", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    const source = {
      summary: { start: "2025-06-05", end: "2026-06-04", totalKwh: 365 },
      series: { intervals15: [{ timestamp: "2025-06-05T00:00:00.000Z", kwh: 365 }] },
    };
    let legacyApplied = false;

    const out = prepareManualPastDatasetForArtifactPersist({
      dataset: source,
      simMode: "SMT_BASELINE",
      scenarioKey: "PAST",
      applyLegacyCanonicalCoverageMetadata: () => {
        legacyApplied = true;
      },
    });

    expect(out.projected).toBe(false);
    expect(legacyApplied).toBe(true);
    expect(shouldProjectManualPastDatasetAtPersist({ simMode: "SMT_BASELINE" })).toBe(false);
  });

  it("does not project EXACT_INTERVALS-style SMT baseline artifacts", () => {
    vi.stubEnv(MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV, "1");
    expect(
      shouldProjectManualPastDatasetAtPersist({
        simMode: "SMT_BASELINE",
        buildInputs: { mode: "SMT_BASELINE", gapfillUsageInputMode: "EXACT_INTERVALS" },
      })
    ).toBe(false);
  });
});
