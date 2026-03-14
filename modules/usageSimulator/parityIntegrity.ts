export type CacheIntegrityReason =
  | "not_cache_restore"
  | "exact_match"
  | "codec_drift_within_tolerance"
  | "codec_drift_exceeds_tolerance"
  | "display_rounding_only"
  | "display_month_stitch_only"
  | "true_corruption";

function nearEqual(a: number | undefined | null, b: number | undefined | null, tolerance = 0.01): boolean {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tolerance;
}

export function classifyPastCacheIntegrity(args: {
  isCacheRestore: boolean;
  cacheDigestMatch: boolean | null;
  cacheTotalDeltaKwh: number | null;
  cacheCodecDriftToleranceKwh: number;
  coldParityOk: boolean;
  productionParityOk: boolean;
  coldVsRecalcMatch: boolean | null;
  coldVsProductionIntervalCountMatch: boolean | null;
  coldRecomputedFromIntervals?: number;
  cacheRecomputedFromIntervals?: number;
  coldRecomputedDailyFromIntervals?: number;
  cacheRecomputedDailyFromIntervals?: number;
  coldRecomputedMonthlyFromIntervals?: number;
  cacheRecomputedMonthlyFromIntervals?: number;
}): {
  cacheIntegrityPass: boolean | null;
  cacheIntegrityReason: CacheIntegrityReason;
  cacheCodecDriftLikely: boolean | null;
  firstDivergenceStage?: "none" | "interval_sum" | "daily_sum" | "monthly_sum" | "digest_only";
} {
  const {
    isCacheRestore,
    cacheDigestMatch,
    cacheTotalDeltaKwh,
    cacheCodecDriftToleranceKwh,
    coldParityOk,
    productionParityOk,
    coldVsRecalcMatch,
    coldVsProductionIntervalCountMatch,
    coldRecomputedFromIntervals,
    cacheRecomputedFromIntervals,
    coldRecomputedDailyFromIntervals,
    cacheRecomputedDailyFromIntervals,
    coldRecomputedMonthlyFromIntervals,
    cacheRecomputedMonthlyFromIntervals,
  } = args;

  if (!isCacheRestore) {
    return {
      cacheIntegrityPass: null,
      cacheIntegrityReason: "not_cache_restore",
      cacheCodecDriftLikely: null,
      firstDivergenceStage: undefined,
    };
  }

  const intervalTotalsNearEqual = nearEqual(coldRecomputedFromIntervals, cacheRecomputedFromIntervals);
  const coldDailyDisplayDelta =
    typeof coldRecomputedDailyFromIntervals === "number" && typeof coldRecomputedFromIntervals === "number"
      ? Math.abs(coldRecomputedDailyFromIntervals - coldRecomputedFromIntervals)
      : null;
  const cacheDailyDisplayDelta =
    typeof cacheRecomputedDailyFromIntervals === "number" && typeof cacheRecomputedFromIntervals === "number"
      ? Math.abs(cacheRecomputedDailyFromIntervals - cacheRecomputedFromIntervals)
      : null;
  const coldMonthlyDisplayDelta =
    typeof coldRecomputedMonthlyFromIntervals === "number" && typeof coldRecomputedFromIntervals === "number"
      ? Math.abs(coldRecomputedMonthlyFromIntervals - coldRecomputedFromIntervals)
      : null;
  const cacheMonthlyDisplayDelta =
    typeof cacheRecomputedMonthlyFromIntervals === "number" && typeof cacheRecomputedFromIntervals === "number"
      ? Math.abs(cacheRecomputedMonthlyFromIntervals - cacheRecomputedFromIntervals)
      : null;

  // Display-layer diagnostics only (rounded daily rows and stitched month presentation).
  const displayRoundingOnly =
    intervalTotalsNearEqual &&
    ((typeof coldDailyDisplayDelta === "number" && coldDailyDisplayDelta > 0.01) ||
      (typeof cacheDailyDisplayDelta === "number" && cacheDailyDisplayDelta > 0.01));
  const displayMonthStitchOnly =
    intervalTotalsNearEqual &&
    !displayRoundingOnly &&
    ((typeof coldMonthlyDisplayDelta === "number" && coldMonthlyDisplayDelta > 0.01) ||
      (typeof cacheMonthlyDisplayDelta === "number" && cacheMonthlyDisplayDelta > 0.01));

  const codecDriftLikely =
    cacheDigestMatch === false &&
    coldParityOk &&
    productionParityOk &&
    typeof cacheTotalDeltaKwh === "number" &&
    cacheTotalDeltaKwh <= cacheCodecDriftToleranceKwh;

  const firstDivergenceStage: "none" | "interval_sum" | "daily_sum" | "monthly_sum" | "digest_only" =
    !intervalTotalsNearEqual
      ? "interval_sum"
      : displayRoundingOnly
        ? "daily_sum"
        : displayMonthStitchOnly
          ? "monthly_sum"
          : cacheDigestMatch === false
            ? "digest_only"
            : "none";

  // Hard failures that still indicate true corruption or invalid artifact state.
  if (!coldParityOk || !productionParityOk || coldVsRecalcMatch === false || coldVsProductionIntervalCountMatch === false) {
    return {
      cacheIntegrityPass: false,
      cacheIntegrityReason: "true_corruption",
      cacheCodecDriftLikely: false,
      firstDivergenceStage,
    };
  }

  if (!intervalTotalsNearEqual) {
    if (typeof cacheTotalDeltaKwh === "number" && cacheTotalDeltaKwh <= cacheCodecDriftToleranceKwh) {
      return {
        cacheIntegrityPass: true,
        cacheIntegrityReason: "codec_drift_within_tolerance",
        cacheCodecDriftLikely: codecDriftLikely,
        firstDivergenceStage,
      };
    }
    if (typeof cacheTotalDeltaKwh === "number" && cacheTotalDeltaKwh > cacheCodecDriftToleranceKwh) {
      return {
        cacheIntegrityPass: false,
        cacheIntegrityReason: "codec_drift_exceeds_tolerance",
        cacheCodecDriftLikely: false,
        firstDivergenceStage,
      };
    }
    return {
      cacheIntegrityPass: false,
      cacheIntegrityReason: "true_corruption",
      cacheCodecDriftLikely: false,
      firstDivergenceStage,
    };
  }

  if (displayRoundingOnly) {
    return {
      cacheIntegrityPass: true,
      cacheIntegrityReason: "display_rounding_only",
      cacheCodecDriftLikely: codecDriftLikely,
      firstDivergenceStage,
    };
  }
  if (displayMonthStitchOnly) {
    return {
      cacheIntegrityPass: true,
      cacheIntegrityReason: "display_month_stitch_only",
      cacheCodecDriftLikely: codecDriftLikely,
      firstDivergenceStage,
    };
  }
  if (cacheDigestMatch === false) {
    return {
      cacheIntegrityPass: true,
      cacheIntegrityReason: "codec_drift_within_tolerance",
      cacheCodecDriftLikely: codecDriftLikely,
      firstDivergenceStage,
    };
  }
  return {
    cacheIntegrityPass: true,
    cacheIntegrityReason: "exact_match",
    cacheCodecDriftLikely: codecDriftLikely,
    firstDivergenceStage,
  };
}
