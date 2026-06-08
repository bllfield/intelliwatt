import { describe, expect, it } from "vitest";

import {
  buildManualReadModelFingerprints,
  readArtifactCoverageFromDataset,
  readDisplayCoverageFromDataset,
  readManualArtifactProofDiagnostics,
} from "@/lib/usage/manualCrossSurfaceParityProof";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
  preserveCanonicalManualPastArtifactCoverageForRead,
  projectManualPastDatasetToCanonicalWindow,
  resolveManualArtifactCoverageClass,
} from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

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

function buildBillWindowManualDataset(mode: "MONTHLY" | "ANNUAL" = "ANNUAL") {
  const startDate = "2025-06-05";
  const endDate = "2026-06-04";
  const dates = enumerateDateKeysInclusive(startDate, endDate);
  return {
    summary: { start: startDate, end: endDate, totalKwh: dates.length },
    meta: {
      anchorEndDate: "2026-06-06",
      usageInputMode: mode === "ANNUAL" ? "MANUAL_ANNUAL" : "MANUAL_MONTHLY",
    },
    manualUsageMode: mode,
    totals: { importKwh: dates.length, exportKwh: 0, netKwh: dates.length },
    daily: dates.map((date) => ({ date, kwh: 1, source: "SIMULATED" })),
    monthly: [{ month: "2026-05", kwh: dates.length }],
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
  };
}

describe("manualPastArtifactReadTimeCanonical", () => {
  const proofNow = new Date("2026-06-08T18:00:00.000Z");
  const canonical = resolveCanonicalUsage365CoverageWindow(proofNow);

  it("preserves canonical summary/meta coverage on read without using persist audit", () => {
    const projected = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("ANNUAL"), {
      usageInputMode: "MANUAL_ANNUAL",
      now: proofNow,
    });

    const coverage = readArtifactCoverageFromDataset(projected);
    expect(coverage.artifactCoverageStart).toBe("2025-06-07");
    expect(coverage.artifactCoverageEnd).toBe("2026-06-06");
    expect(projected.meta.manualCanonicalArtifactWindowPersistAudit).toBeUndefined();
  });

  it("classifies canonical-stamped artifacts and legacy artifacts distinctly", () => {
    const canonicalDataset = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("MONTHLY"), {
      usageInputMode: "MANUAL_MONTHLY",
      now: proofNow,
    });
    const legacyDataset = buildBillWindowManualDataset("MONTHLY");

    expect(resolveManualArtifactCoverageClass(canonicalDataset, "MANUAL_MONTHLY")).toBe("canonical");
    expect(resolveManualArtifactCoverageClass(legacyDataset, "MANUAL_MONTHLY")).toBe("legacy");
  });

  it("readDisplayCoverageFromDataset exposes canonical coverage for stamped artifacts", () => {
    const canonicalDataset = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("ANNUAL"), {
      usageInputMode: "MANUAL_ANNUAL",
      now: proofNow,
    });

    const userDisplay = readDisplayCoverageFromDataset({
      dataset: canonicalDataset,
      usageInputMode: "MANUAL_ANNUAL",
      applyAdminRemap: false,
    });
    const adminDisplay = readDisplayCoverageFromDataset({
      dataset: canonicalDataset,
      usageInputMode: "MANUAL_ANNUAL",
      applyAdminRemap: true,
    });

    expect(userDisplay.displayCoverageStart).toBe(canonical.startDate);
    expect(userDisplay.displayCoverageEnd).toBe(canonical.endDate);
    expect(adminDisplay.displayCoverageStart).toBe(canonical.startDate);
    expect(adminDisplay.displayCoverageEnd).toBe(canonical.endDate);
  });

  it("matches user and admin read fingerprints for canonical-stamped annual artifacts", () => {
    const canonicalDataset = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("ANNUAL"), {
      usageInputMode: "MANUAL_ANNUAL",
      now: proofNow,
    });
    const userDisplay = readDisplayCoverageFromDataset({
      dataset: canonicalDataset,
      usageInputMode: "MANUAL_ANNUAL",
      applyAdminRemap: false,
    }).displayDataset!;
    const adminDisplay = readDisplayCoverageFromDataset({
      dataset: canonicalDataset,
      usageInputMode: "MANUAL_ANNUAL",
      applyAdminRemap: true,
    }).displayDataset!;

    const userFingerprint = buildManualReadModelFingerprints({
      dataset: userDisplay,
      fallbackHouseId: "house-a",
    });
    const adminFingerprint = buildManualReadModelFingerprints({
      dataset: adminDisplay,
      fallbackHouseId: "house-a",
    });

    expect(userFingerprint.finalizedDailyRowsHash).toBe(adminFingerprint.finalizedDailyRowsHash);
    expect(userFingerprint.displayTruthRevision).toBe(adminFingerprint.displayTruthRevision);
  });

  it("preserveCanonicalManualPastArtifactCoverageForRead keeps persisted coverage on artifact restore", () => {
    const dataset = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("ANNUAL"), {
      usageInputMode: "MANUAL_ANNUAL",
      now: proofNow,
    });
    dataset.summary.start = "2025-06-05";
    dataset.summary.end = "2026-06-04";
    dataset.meta.coverageStart = "2025-06-07";
    dataset.meta.coverageEnd = "2026-06-06";

    const preserved = preserveCanonicalManualPastArtifactCoverageForRead(dataset);
    expect(preserved).toEqual({ startDate: "2025-06-07", endDate: "2026-06-06" });
    expect(dataset.summary.start).toBe("2025-06-07");
    expect(dataset.summary.end).toBe("2026-06-06");
  });

  it("labels legacy artifacts via readManualArtifactProofDiagnostics", () => {
    const legacy = readManualArtifactProofDiagnostics(buildBillWindowManualDataset("MONTHLY"));
    const canonical = readManualArtifactProofDiagnostics(
      projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("MONTHLY"), {
        usageInputMode: "MANUAL_MONTHLY",
        now: proofNow,
      })
    );

    expect(legacy.manualArtifactCoverageClass).toBe("legacy");
    expect(canonical.manualArtifactCoverageClass).toBe("canonical");
    expect(canonical.legacyManualDisplayRemapApplied).toBe(false);
  });

  it("stamps canonical version on projected artifacts used for read-time no-op", () => {
    const projected = projectManualPastDatasetToCanonicalWindow(buildBillWindowManualDataset("ANNUAL"), {
      usageInputMode: "MANUAL_ANNUAL",
      now: proofNow,
    });
    expect(projected.meta.manualCanonicalArtifactWindowVersion).toBe(
      MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION
    );
    expect(projected.meta.manualBillPeriodWindow).toMatchObject({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
    });
  });
});
