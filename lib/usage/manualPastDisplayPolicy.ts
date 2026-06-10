function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isManualPastSimDisplayDataset(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta || meta.baselinePassthrough === true) return false;
  const pastSimDisplay =
    meta.datasetKind === "SIMULATED" || Boolean(meta.manualCanonicalArtifactWindowVersion);
  if (!pastSimDisplay) return false;
  const mode = String(meta.mode ?? "").trim().toUpperCase();
  if (mode === "MANUAL_TOTALS") return true;
  const usageInputMode = String(
    meta.usageInputMode ?? meta.gapfillUsageInputMode ?? meta.manualUsageMode ?? ""
  )
    .trim()
    .toUpperCase();
  if (usageInputMode.includes("MANUAL_MONTHLY") || usageInputMode.includes("MANUAL_ANNUAL")) return true;
  if (meta.manualCanonicalArtifactWindowVersion) return true;
  const preferred = String(meta.preferredActualSource ?? meta.actualSource ?? "").trim().toUpperCase();
  if (preferred === "SMT" || preferred === "GREEN_BUTTON") return false;
  return usageInputMode.includes("MANUAL");
}

export function buildManualPastWeatherExplanationSummary(args: {
  weatherEfficiencyScore0to100: number;
  coolingSensitivityScore0to100?: number | null;
  heatingSensitivityScore0to100?: number | null;
}): string {
  const billingPeriodCopy =
    "estimated usage movement from your manual bills, home details, weather, pool, HVAC, and thermostat inputs";
  const cooling = Number(args.coolingSensitivityScore0to100 ?? 0);
  const heating = Number(args.heatingSensitivityScore0to100 ?? 0);
  if (args.weatherEfficiencyScore0to100 <= 45) {
    const dominant = cooling >= heating ? "hot" : "cold";
    return `This home appears weather sensitive. The score reflects estimated ${dominant}-day usage movement from your manual bills, home details, weather, pool, HVAC, and thermostat inputs.`;
  }
  if (args.weatherEfficiencyScore0to100 >= 75) {
    return `This home looks relatively stable versus weather. The score reflects ${billingPeriodCopy}.`;
  }
  return `This home's usage has a moderate weather response. The score reflects ${billingPeriodCopy}.`;
}

export function applyManualPastWeatherExplanationCopy<T extends Record<string, unknown>>(
  score: T | null,
  meta?: Record<string, unknown> | null
): T | null {
  if (!score) return null;
  const metaRecord = asRecord(meta);
  if (!isManualPastSimDisplayDataset(metaRecord)) return score;
  const weatherEfficiencyScore0to100 = Number(score.weatherEfficiencyScore0to100);
  if (!Number.isFinite(weatherEfficiencyScore0to100)) return score;
  return {
    ...score,
    explanationSummary: buildManualPastWeatherExplanationSummary({
      weatherEfficiencyScore0to100,
      coolingSensitivityScore0to100:
        typeof score.coolingSensitivityScore0to100 === "number" ? score.coolingSensitivityScore0to100 : null,
      heatingSensitivityScore0to100:
        typeof score.heatingSensitivityScore0to100 === "number" ? score.heatingSensitivityScore0to100 : null,
    }),
  };
}

export const MANUAL_PAST_ZERO_FILL_DAILY_SOURCE = "SIMULATED" as const;
export const MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL = "SIMULATED_MANUAL_CONSTRAINED" as const;

export function labelManualPastZeroFillDailyRow<T extends { date: string; kwh: number }>(
  row: T,
  existing?: { source?: unknown; sourceDetail?: unknown } | null
): T & { source: string; sourceDetail: string } {
  if (existing?.source != null || existing?.sourceDetail != null) {
    return normalizeManualPastDailySourceLabel({
      ...row,
      source: String(existing.source ?? MANUAL_PAST_ZERO_FILL_DAILY_SOURCE),
      sourceDetail: String(existing.sourceDetail ?? MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL),
    }) as T & { source: string; sourceDetail: string };
  }
  return {
    ...row,
    source: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
    sourceDetail: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
  };
}

/** Relabel stale ACTUAL rows on manual-only Past artifacts back to simulated/manual-constrained. */
export function normalizeManualPastDailySourceLabel<T extends Record<string, unknown>>(row: T): T {
  const source = String(row.source ?? "").trim().toUpperCase();
  const detail = String(row.sourceDetail ?? "").trim().toUpperCase();
  if (detail.includes("VALIDATION") || detail === "ACTUAL_VALIDATION_TEST_DAY") return row;
  if (source === "ACTUAL" && (detail === "ACTUAL" || detail.length === 0)) {
    return {
      ...row,
      source: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE,
      sourceDetail: MANUAL_PAST_ZERO_FILL_DAILY_SOURCE_DETAIL,
    };
  }
  return row;
}
