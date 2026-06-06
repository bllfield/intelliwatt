import {
  resolveSharedWeatherSensitivityEnvelope,
  WEATHER_CALCULATION_VERSION,
  WEATHER_SCORE_VERSION,
  type WeatherScoringContext,
  type WeatherSensitivityEnvelope,
  type WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";

export const WEATHER_SCORER_MODULE = "resolveSharedWeatherSensitivityEnvelope" as const;

export type WeatherDisplayOwner =
  | "actual_usage_weather_score"
  | "past_artifact_build"
  | "simulation_build_diagnostic"
  | "fingerprint_diagnostic";

export const PAST_DISPLAY_WEATHER_META_FIELD = "meta.pastDisplayWeatherSensitivityScore" as const;
export const PRE_SIM_BUILD_DIAGNOSTIC_META_FIELD = "meta.weatherSensitivityScore" as const;

export type WeatherScoringAudit = {
  scorerModule: typeof WEATHER_SCORER_MODULE;
  scoreVersion: string;
  calculationVersion: string;
  scoringContext: WeatherScoringContext;
  datasetKind: string | null;
  displayOwner: WeatherDisplayOwner;
  inputWindowStart: string | null;
  inputWindowEnd: string | null;
  inputDailyRowCount: number;
  dailyWeatherRowCount: number;
  simulatedTravelVacantDayCount: number;
  validationActualDayCount: number;
  outputField: string;
  outputScore: {
    weatherEfficiencyScore0to100: number | null;
    coolingSensitivityScore0to100: number | null;
    heatingSensitivityScore0to100: number | null;
    confidenceScore0to100: number | null;
  } | null;
};

export type WeatherScoringOwnershipRow = {
  surface: string;
  datasetKind: string;
  inputDataset: string;
  scorerFunction: typeof WEATHER_SCORER_MODULE;
  outputField: string;
  sourceOwner: WeatherDisplayOwner;
  scoreVersion: string;
  calculationVersion: string;
  visibleToUser: boolean;
  visibleToAdmin: boolean;
};

/** Static ownership matrix — all surfaces must route through WEATHER_SCORER_MODULE. */
export const WEATHER_SCORING_OWNERSHIP_MATRIX: WeatherScoringOwnershipRow[] = [
  {
    surface: "User Usage / Actual dashboard",
    datasetKind: "ACTUAL",
    inputDataset: "Green Button / SMT interval-derived daily + dailyWeather",
    scorerFunction: WEATHER_SCORER_MODULE,
    outputField: "contract.weatherSensitivityScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "Admin baseline read model",
    datasetKind: "ACTUAL",
    inputDataset: "Same actual interval layer as User Usage",
    scorerFunction: WEATHER_SCORER_MODULE,
    outputField: "runDisplayView.weatherScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: true,
  },
  {
    surface: "User Past / Admin Past weather cards",
    datasetKind: "SIMULATED (Past display)",
    inputDataset:
      "Finalized Past display daily (Travel/Vacant replaced, validation/test projected to actual, reconciled totals) + dailyWeather",
    scorerFunction: WEATHER_SCORER_MODULE,
    outputField: PAST_DISPLAY_WEATHER_META_FIELD,
    sourceOwner: "past_artifact_build",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "Past sim engine / fingerprint / build inputs",
    datasetKind: "SIMULATED (build)",
    inputDataset: "Pre-sim actual snapshot at build time",
    scorerFunction: WEATHER_SCORER_MODULE,
    outputField: PRE_SIM_BUILD_DIAGNOSTIC_META_FIELD,
    sourceOwner: "simulation_build_diagnostic",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: false,
  },
  {
    surface: "Fingerprint / tuning diagnostics",
    datasetKind: "DIAGNOSTIC",
    inputDataset: "Build-time or lab scoring dataset",
    scorerFunction: WEATHER_SCORER_MODULE,
    outputField: "diagnostic.weatherSensitivityScore",
    sourceOwner: "fingerprint_diagnostic",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: false,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function displayOwnerForContext(context: WeatherScoringContext): WeatherDisplayOwner {
  switch (context) {
    case "ACTUAL_USAGE":
      return "actual_usage_weather_score";
    case "PAST_DISPLAY":
      return "past_artifact_build";
    case "FINGERPRINT":
      return "fingerprint_diagnostic";
    case "SIMULATION_BUILD":
      return "simulation_build_diagnostic";
  }
}

export function outputFieldForContext(context: WeatherScoringContext): string {
  switch (context) {
    case "ACTUAL_USAGE":
      return "contract.weatherSensitivityScore";
    case "PAST_DISPLAY":
      return PAST_DISPLAY_WEATHER_META_FIELD;
    case "FINGERPRINT":
      return "diagnostic.weatherSensitivityScore";
    case "SIMULATION_BUILD":
      return PRE_SIM_BUILD_DIAGNOSTIC_META_FIELD;
  }
}

export function buildPastDisplayScoringDataset(dataset: Record<string, unknown>): Record<string, unknown> {
  const daily = Array.isArray(dataset.daily) ? dataset.daily : [];
  return {
    daily: daily.map((row) => {
      const record = asRecord(row);
      return {
        ...record,
        source: "ACTUAL",
        sourceDetail: "ACTUAL",
      };
    }),
    dailyWeather: dataset.dailyWeather,
  };
}

function countDailyRowsBySourceDetail(
  daily: unknown[],
  predicate: (detail: string) => boolean
): number {
  let count = 0;
  for (const row of daily) {
    const record = asRecord(row);
    const detail = String(record.sourceDetail ?? record.source ?? "").toUpperCase();
    if (predicate(detail)) count += 1;
  }
  return count;
}

export function buildWeatherScoringAudit(args: {
  scoringContext: WeatherScoringContext;
  scoringDataset: Record<string, unknown> | null | undefined;
  datasetKind?: string | null;
  outputField?: string;
  envelope: WeatherSensitivityEnvelope | null;
}): WeatherScoringAudit {
  const dataset = asRecord(args.scoringDataset);
  const meta = asRecord(dataset.meta);
  const summary = asRecord(dataset.summary);
  const daily = Array.isArray(dataset.daily) ? dataset.daily : [];
  const dailyWeather = asRecord(dataset.dailyWeather);
  const sortedDateKeys = daily
    .map((row) => asDateKey(asRecord(row).date))
    .filter((v): v is string => v != null)
    .sort();
  const score = args.envelope?.score ?? null;
  const displayOwner = displayOwnerForContext(args.scoringContext);
  const validationKeys = Array.isArray(meta.validationOnlyDateKeysLocal)
    ? (meta.validationOnlyDateKeysLocal as unknown[])
        .map((v) => asDateKey(v))
        .filter((v): v is string => v != null)
    : [];
  return {
    scorerModule: WEATHER_SCORER_MODULE,
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    scoringContext: args.scoringContext,
    datasetKind: args.datasetKind ?? (typeof meta.datasetKind === "string" ? meta.datasetKind : null),
    displayOwner,
    inputWindowStart:
      sortedDateKeys.length > 0 ? sortedDateKeys[0]! : asDateKey(summary.start ?? meta.coverageStart),
    inputWindowEnd:
      sortedDateKeys.length > 0
        ? sortedDateKeys[sortedDateKeys.length - 1]!
        : asDateKey(summary.end ?? meta.coverageEnd),
    inputDailyRowCount: daily.length,
    dailyWeatherRowCount: Object.keys(dailyWeather).length,
    simulatedTravelVacantDayCount: countDailyRowsBySourceDetail(daily, (d) =>
      /SIMULATED|TRAVEL|VACANT/.test(d)
    ),
    validationActualDayCount: validationKeys.length,
    outputField: args.outputField ?? outputFieldForContext(args.scoringContext),
    outputScore: score
      ? {
          weatherEfficiencyScore0to100: score.weatherEfficiencyScore0to100 ?? null,
          coolingSensitivityScore0to100: score.coolingSensitivityScore0to100 ?? null,
          heatingSensitivityScore0to100: score.heatingSensitivityScore0to100 ?? null,
          confidenceScore0to100: score.confidenceScore0to100 ?? null,
        }
      : null,
  };
}

export async function resolveWeatherScoreForContext(args: {
  scoringContext: WeatherScoringContext;
  scoringDataset: Record<string, unknown> | null | undefined;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  manualUsagePayload?: unknown;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  const scoringDataset = asRecord(args.scoringDataset);
  const displayOwner = displayOwnerForContext(args.scoringContext);
  const envelope = await resolveSharedWeatherSensitivityEnvelope({
    scoringDataset,
    actualDataset: scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId ?? null,
    manualUsagePayload: args.manualUsagePayload as never,
    scoringContext: args.scoringContext,
    displayOwner,
  });
  const meta = asRecord(scoringDataset.meta);
  return {
    ...envelope,
    audit: buildWeatherScoringAudit({
      scoringContext: args.scoringContext,
      scoringDataset,
      datasetKind: typeof meta.datasetKind === "string" ? meta.datasetKind : null,
      envelope,
    }),
  };
}

export async function resolvePastDisplayWeatherScore(args: {
  dataset: Record<string, unknown>;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  return resolveWeatherScoreForContext({
    scoringContext: "PAST_DISPLAY",
    scoringDataset: buildPastDisplayScoringDataset(args.dataset),
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
  });
}

export async function resolveActualUsageWeatherScore(args: {
  scoringDataset: Record<string, unknown> | null | undefined;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  manualUsagePayload?: unknown;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  return resolveWeatherScoreForContext({
    scoringContext: "ACTUAL_USAGE",
    scoringDataset: args.scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
    manualUsagePayload: args.manualUsagePayload,
  });
}

export function readPreSimBuildDiagnosticScore(
  meta: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const record = asRecord(meta);
  const preSim = asRecord(record.weatherSensitivityScore);
  return Object.keys(preSim).length > 0 ? preSim : null;
}

export function scoreCardValues(score: unknown): {
  weatherEfficiency: number | null;
  cooling: number | null;
  heating: number | null;
  confidence: number | null;
} {
  const record = asRecord(score);
  const pick = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const derived = asRecord(record.derivedInput ?? record.weatherEfficiencyDerivedInput);
  return {
    weatherEfficiency: pick(record.weatherEfficiencyScore0to100),
    cooling:
      pick(record.coolingSensitivityScore0to100) ??
      pick(derived.coolingSensitivityScore0to100) ??
      pick(derived.coolingSensitivity),
    heating:
      pick(record.heatingSensitivityScore0to100) ??
      pick(derived.heatingSensitivityScore0to100) ??
      pick(derived.heatingSensitivity),
    confidence:
      pick(record.confidenceScore0to100) ??
      pick(derived.confidenceScore0to100) ??
      pick(derived.confidence),
  };
}

/** Returns a violation message when visible Past weather matches bundle B or baseline A instead of C. */
export function detectPastVisibleWeatherOwnerViolation(args: {
  meta: Record<string, unknown>;
  visibleScore: unknown;
  visibleSourceOwner: string;
  actualBaselineScore?: unknown;
}): string | null {
  const visible = scoreCardValues(args.visibleScore);
  if (visible.weatherEfficiency == null) return null;

  const pastDisplay = scoreCardValues(asRecord(args.meta.pastDisplayWeatherSensitivityScore));
  const preSim = scoreCardValues(readPreSimBuildDiagnosticScore(args.meta));
  const actualBaseline = scoreCardValues(args.actualBaselineScore);

  if (
    pastDisplay.weatherEfficiency != null &&
    visible.weatherEfficiency === pastDisplay.weatherEfficiency &&
    visible.cooling === pastDisplay.cooling &&
    visible.heating === pastDisplay.heating &&
    visible.confidence === pastDisplay.confidence
  ) {
    return null;
  }

  if (
    preSim.weatherEfficiency != null &&
    visible.weatherEfficiency === preSim.weatherEfficiency &&
    visible.cooling === preSim.cooling &&
    visible.heating === preSim.heating &&
    visible.confidence === preSim.confidence
  ) {
    return "User Past visible weather matches pre-sim build diagnostic (meta.weatherSensitivityScore) not past display";
  }

  if (
    actualBaseline.weatherEfficiency != null &&
    visible.weatherEfficiency === actualBaseline.weatherEfficiency &&
    visible.cooling === actualBaseline.cooling &&
    visible.heating === actualBaseline.heating &&
    visible.confidence === actualBaseline.confidence
  ) {
    return "User Past visible weather matches Actual baseline score not past display";
  }

  if (args.visibleSourceOwner === "shared_weather_sensitivity_envelope") {
    return "User Past visible weather used Actual-layer shared envelope instead of meta.pastDisplayWeatherSensitivityScore";
  }

  if (args.visibleSourceOwner === "missing_past_display_weather") {
    return "User Past missing persisted past display weather score";
  }

  return "User Past visible weather does not match meta.pastDisplayWeatherSensitivityScore";
}

export function persistPastDisplayWeatherScoringAudit(
  dataset: Record<string, unknown>,
  audit: WeatherScoringAudit
): void {
  const meta = asRecord(dataset.meta);
  meta.pastDisplayWeatherScoringAudit = audit;
  dataset.meta = meta;
}

export function stampActualUsageWeatherOnContractScore(
  score: WeatherSensitivityScore | null
): WeatherSensitivityScore | null {
  if (!score) return null;
  return {
    ...score,
    scoringContext: "ACTUAL_USAGE",
    displayOwner: "actual_usage_weather_score",
    sourceOwner: "actual_usage_weather_score",
  };
}
