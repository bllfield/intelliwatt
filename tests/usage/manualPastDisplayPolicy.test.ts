import { describe, expect, it } from "vitest";

import {
  applyManualPastWeatherExplanationCopy,
  buildManualPastWeatherExplanationSummary,
  isManualPastSimDisplayDataset,
  labelManualPastZeroFillDailyRow,
  MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
  MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
  normalizeManualPastDailySourceLabel,
} from "@/lib/usage/manualPastDisplayPolicy";
import { buildPastDisplayScoringDataset } from "@/lib/usage/weatherScoringOwnership";

describe("manualPastDisplayPolicy", () => {
  it("detects canonical-stamped manual artifacts without datasetKind SIMULATED", () => {
    expect(
      isManualPastSimDisplayDataset({
        manualCanonicalArtifactWindowVersion: "manual_canonical_artifact_v1",
        usageInputMode: "MANUAL_MONTHLY",
      })
    ).toBe(true);
  });

  it("detects manual monthly Past sim display datasets", () => {
    expect(
      isManualPastSimDisplayDataset({
        datasetKind: "SIMULATED",
        mode: "MANUAL_TOTALS",
        usageInputMode: "MANUAL_MONTHLY",
      })
    ).toBe(true);
    expect(
      isManualPastSimDisplayDataset({
        datasetKind: "SIMULATED",
        actualSource: "GREEN_BUTTON",
        preferredActualSource: "GREEN_BUTTON",
      })
    ).toBe(false);
  });

  it("uses estimated manual-bill wording for weather cards", () => {
    const summary = buildManualPastWeatherExplanationSummary({
      weatherEfficiencyScore0to100: 62,
      coolingSensitivityScore0to100: 80,
      heatingSensitivityScore0to100: 70,
    });
    expect(summary).toContain("estimated usage movement from your manual bills");
    expect(summary).not.toContain("measured usage movement");
  });

  it("overrides stale measured explanationSummary on read", () => {
    const patched = applyManualPastWeatherExplanationCopy(
      {
        weatherEfficiencyScore0to100: 62,
        coolingSensitivityScore0to100: 80,
        heatingSensitivityScore0to100: 70,
        explanationSummary:
          "This home's usage has a moderate weather response. The score reflects measured usage movement after accounting for pool, HVAC, thermostat.",
      },
      {
        datasetKind: "SIMULATED",
        mode: "MANUAL_TOTALS",
        usageInputMode: "MANUAL_MONTHLY",
      }
    );
    expect(patched?.explanationSummary).toContain("manual bills");
    expect(patched?.explanationSummary).not.toContain("measured usage movement");
  });

  it("relabels stale ACTUAL daily rows to simulated manual-constrained", () => {
    expect(
      normalizeManualPastDailySourceLabel({
        date: "2026-01-01",
        kwh: 10,
        source: "ACTUAL",
        sourceDetail: "ACTUAL",
      })
    ).toMatchObject({
      source: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
      sourceDetail: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
    });
    expect(
      normalizeManualPastDailySourceLabel({
        date: "2026-01-02",
        kwh: 10,
        source: "ACTUAL",
        sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
      }).sourceDetail
    ).toBe("ACTUAL_VALIDATION_TEST_DAY");
  });

  it("labels zero-fill rows for manual canonical coverage", () => {
    expect(labelManualPastZeroFillDailyRow({ date: "2026-01-01", kwh: 0 })).toMatchObject({
      source: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
      sourceDetail: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
    });
  });

  it("buildPastDisplayScoringDataset preserves manual daily source labels", () => {
    const scoringDataset = buildPastDisplayScoringDataset({
      meta: {
        datasetKind: "SIMULATED",
        mode: "MANUAL_TOTALS",
        usageInputMode: "MANUAL_MONTHLY",
      },
      daily: [
        { date: "2026-01-01", kwh: 10, source: "SIMULATED", sourceDetail: "MANUAL_CONSTRAINED" },
        { date: "2026-01-02", kwh: 11, source: "ACTUAL", sourceDetail: "ACTUAL" },
      ],
    });
    const rows = scoringDataset.daily as Array<{ source: string; sourceDetail: string }>;
    expect(rows[0]).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "MANUAL_CONSTRAINED",
    });
    expect(rows[1]).toMatchObject({
      source: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
      sourceDetail: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
    });
  });
});
