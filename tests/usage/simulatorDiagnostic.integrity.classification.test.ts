import { describe, expect, it } from "vitest";

import { classifyPastCacheIntegrity } from "@/modules/usageSimulator/parityIntegrity";

describe("classifyPastCacheIntegrity", () => {
  it("classifies small cache drift as codec_drift_within_tolerance when cold/recalc are healthy", () => {
    const out = classifyPastCacheIntegrity({
      isCacheRestore: true,
      cacheDigestMatch: false,
      cacheTotalDeltaKwh: 0.03,
      cacheCodecDriftToleranceKwh: 0.05,
      coldParityOk: true,
      productionParityOk: true,
      coldVsRecalcMatch: true,
      coldVsProductionIntervalCountMatch: true,
      coldRecomputedFromIntervals: 100.0,
      cacheRecomputedFromIntervals: 100.03,
      coldRecomputedDailyFromIntervals: 100.0,
      cacheRecomputedDailyFromIntervals: 100.04,
      coldRecomputedMonthlyFromIntervals: 99.7,
      cacheRecomputedMonthlyFromIntervals: 99.72,
    });

    expect(out.cacheIntegrityPass).toBe(true);
    expect(out.cacheIntegrityReason).toBe("codec_drift_within_tolerance");
  });

  it("classifies daily display rounding accumulation as display_rounding_only", () => {
    const out = classifyPastCacheIntegrity({
      isCacheRestore: true,
      cacheDigestMatch: true,
      cacheTotalDeltaKwh: 0,
      cacheCodecDriftToleranceKwh: 0.05,
      coldParityOk: true,
      productionParityOk: true,
      coldVsRecalcMatch: true,
      coldVsProductionIntervalCountMatch: true,
      coldRecomputedFromIntervals: 100.0,
      cacheRecomputedFromIntervals: 100.0,
      coldRecomputedDailyFromIntervals: 100.06,
      cacheRecomputedDailyFromIntervals: 100.07,
      coldRecomputedMonthlyFromIntervals: 100.0,
      cacheRecomputedMonthlyFromIntervals: 100.0,
    });

    expect(out.cacheIntegrityPass).toBe(true);
    expect(out.cacheIntegrityReason).toBe("display_rounding_only");
    expect(out.firstDivergenceStage).toBe("daily_sum");
  });

  it("classifies stitched monthly presentation drift as display_month_stitch_only", () => {
    const out = classifyPastCacheIntegrity({
      isCacheRestore: true,
      cacheDigestMatch: true,
      cacheTotalDeltaKwh: 0,
      cacheCodecDriftToleranceKwh: 0.05,
      coldParityOk: true,
      productionParityOk: true,
      coldVsRecalcMatch: true,
      coldVsProductionIntervalCountMatch: true,
      coldRecomputedFromIntervals: 100.0,
      cacheRecomputedFromIntervals: 100.0,
      coldRecomputedDailyFromIntervals: 100.0,
      cacheRecomputedDailyFromIntervals: 100.0,
      coldRecomputedMonthlyFromIntervals: 99.5,
      cacheRecomputedMonthlyFromIntervals: 99.45,
    });

    expect(out.cacheIntegrityPass).toBe(true);
    expect(out.cacheIntegrityReason).toBe("display_month_stitch_only");
    expect(out.firstDivergenceStage).toBe("monthly_sum");
  });

  it("still fails as true_corruption for unexplained integrity breakage", () => {
    const out = classifyPastCacheIntegrity({
      isCacheRestore: true,
      cacheDigestMatch: false,
      cacheTotalDeltaKwh: 0.01,
      cacheCodecDriftToleranceKwh: 0.05,
      coldParityOk: false,
      productionParityOk: true,
      coldVsRecalcMatch: false,
      coldVsProductionIntervalCountMatch: false,
      coldRecomputedFromIntervals: 100.0,
      cacheRecomputedFromIntervals: 100.0,
      coldRecomputedDailyFromIntervals: 100.0,
      cacheRecomputedDailyFromIntervals: 100.0,
      coldRecomputedMonthlyFromIntervals: 100.0,
      cacheRecomputedMonthlyFromIntervals: 100.0,
    });

    expect(out.cacheIntegrityPass).toBe(false);
    expect(out.cacheIntegrityReason).toBe("true_corruption");
  });
});
