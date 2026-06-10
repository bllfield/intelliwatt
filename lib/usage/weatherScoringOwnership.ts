import {
  resolveSharedWeatherSensitivityEnvelope,
  WEATHER_CALCULATION_VERSION,
  WEATHER_SCORE_VERSION,
  type WeatherScoringContext,
  type WeatherSensitivityEnvelope,
  type WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";
import {
  isManualPastSimDisplayDataset,
  normalizeManualPastDailySourceLabel,
} from "@/lib/usage/manualPastDisplayPolicy";

export const WEATHER_SCORER_MODULE = "resolveSharedWeatherSensitivityEnvelope" as const;

export type WeatherDisplayOwner =
  | "actual_usage_weather_score"
  | "past_artifact_build"
  | "simulation_build_diagnostic"
  | "fingerprint_diagnostic";

export const PAST_DISPLAY_WEATHER_META_FIELD = "meta.pastDisplayWeatherSensitivityScore" as const;
export const PRE_SIM_BUILD_DIAGNOSTIC_META_FIELD = "meta.weatherSensitivityScore" as const;

export type WeatherUsageSourceType = "SMT" | "GREEN_BUTTON" | "MANUAL" | "NEW_BUILD";

export type WeatherScoringAudit = {
  scorerModule: typeof WEATHER_SCORER_MODULE;
  scoreVersion: string;
  calculationVersion: string;
  sourceType: WeatherUsageSourceType;
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
  scoringContext: WeatherScoringContext;
  sourceType: WeatherUsageSourceType | "ANY";
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
    surface: "User Usage / SMT Actual",
    datasetKind: "ACTUAL",
    inputDataset: "SMT interval-derived daily series + dailyWeather",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "ACTUAL_USAGE",
    sourceType: "SMT",
    outputField: "contract.weatherSensitivityScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "User Usage / Green Button Actual",
    datasetKind: "ACTUAL",
    inputDataset: "Green Button interval-derived daily series + dailyWeather",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "ACTUAL_USAGE",
    sourceType: "GREEN_BUTTON",
    outputField: "contract.weatherSensitivityScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "One Path Admin / SMT Baseline",
    datasetKind: "ACTUAL",
    inputDataset: "Same SMT actual interval layer as User Usage",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "ACTUAL_USAGE",
    sourceType: "SMT",
    outputField: "runDisplayView.weatherScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: true,
  },
  {
    surface: "One Path Admin / Green Button Baseline",
    datasetKind: "ACTUAL",
    inputDataset: "Same Green Button actual interval layer as User Usage",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "ACTUAL_USAGE",
    sourceType: "GREEN_BUTTON",
    outputField: "runDisplayView.weatherScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: true,
  },
  {
    surface: "User Past / SMT-backed Past",
    datasetKind: "SIMULATED Past Display",
    inputDataset:
      "Finalized SMT-backed Past display daily rows after Travel/Vacant replacement, validation/test projection, canonical reconciliation, and dailyWeather attach",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "PAST_DISPLAY",
    sourceType: "SMT",
    outputField: PAST_DISPLAY_WEATHER_META_FIELD,
    sourceOwner: "past_artifact_build",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "User Past / Green Button-backed Past",
    datasetKind: "SIMULATED Past Display",
    inputDataset:
      "Finalized Green Button-backed Past display daily rows after Travel/Vacant replacement, validation/test projection, canonical reconciliation, and dailyWeather attach",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "PAST_DISPLAY",
    sourceType: "GREEN_BUTTON",
    outputField: PAST_DISPLAY_WEATHER_META_FIELD,
    sourceOwner: "past_artifact_build",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "One Path Admin / SMT Past",
    datasetKind: "SIMULATED Past Display",
    inputDataset: "Exact same finalized SMT-backed Past display artifact/read model as User Past",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "PAST_DISPLAY",
    sourceType: "SMT",
    outputField: PAST_DISPLAY_WEATHER_META_FIELD,
    sourceOwner: "past_artifact_build",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: true,
  },
  {
    surface: "One Path Admin / Green Button Past",
    datasetKind: "SIMULATED Past Display",
    inputDataset: "Exact same finalized Green Button-backed Past display artifact/read model as User Past",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "PAST_DISPLAY",
    sourceType: "GREEN_BUTTON",
    outputField: PAST_DISPLAY_WEATHER_META_FIELD,
    sourceOwner: "past_artifact_build",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: true,
  },
  {
    surface: "Manual-derived interval / billing Actual",
    datasetKind: "ACTUAL",
    inputDataset: "Manual monthly totals or manual-derived usage payload + weather",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "ACTUAL_USAGE",
    sourceType: "MANUAL",
    outputField: "contract.weatherSensitivityScore",
    sourceOwner: "actual_usage_weather_score",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: true,
    visibleToAdmin: true,
  },
  {
    surface: "SMT simulation / fingerprint / build diagnostics",
    datasetKind: "DIAGNOSTIC / SIMULATION_BUILD",
    inputDataset: "SMT-backed build/fingerprint snapshot at sim time",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "SIMULATION_BUILD",
    sourceType: "SMT",
    outputField: PRE_SIM_BUILD_DIAGNOSTIC_META_FIELD,
    sourceOwner: "simulation_build_diagnostic",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: false,
  },
  {
    surface: "Green Button / manual fingerprint diagnostics",
    datasetKind: "DIAGNOSTIC",
    inputDataset: "Lab fingerprint or tuning compare dataset",
    scorerFunction: WEATHER_SCORER_MODULE,
    scoringContext: "FINGERPRINT",
    sourceType: "ANY",
    outputField: "diagnostic.weatherSensitivityScore",
    sourceOwner: "fingerprint_diagnostic",
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    visibleToUser: false,
    visibleToAdmin: false,
  },
];

export function matrixRowsForSourceType(sourceType: WeatherUsageSourceType): WeatherScoringOwnershipRow[] {
  return WEATHER_SCORING_OWNERSHIP_MATRIX.filter(
    (row) => row.sourceType === sourceType || row.sourceType === "ANY"
  );
}

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

export function resolveUsageSourceTypeFromDataset(
  dataset: Record<string, unknown> | null | undefined,
  args?: {
    manualUsagePayload?: unknown;
    preferredActualSource?: string | null;
    mode?: string | null;
  }
): WeatherUsageSourceType {
  if (args?.manualUsagePayload != null) return "MANUAL";
  const mode = String(args?.mode ?? "").trim().toUpperCase();
  if (mode === "NEW_BUILD" || mode.includes("NEW_BUILD")) return "NEW_BUILD";
  const record = asRecord(dataset);
  const meta = asRecord(record.meta);
  const summary = asRecord(record.summary);
  const source = String(
    args?.preferredActualSource ??
      meta.preferredActualSource ??
      meta.actualSource ??
      summary.source ??
      summary.actualSource ??
      ""
  )
    .trim()
    .toUpperCase();
  if (source === "GREEN_BUTTON" || source.includes("GREEN_BUTTON")) return "GREEN_BUTTON";
  if (source === "SMT" || source.includes("SMT")) return "SMT";
  if (source.includes("MANUAL") || meta.datasetKind === "MANUAL") return "MANUAL";
  if (source.includes("NEW_BUILD")) return "NEW_BUILD";
  return "SMT";
}

export function buildPastDisplayScoringDataset(dataset: Record<string, unknown>): Record<string, unknown> {
  const meta = asRecord(dataset.meta);
  const manualPastDisplay = isManualPastSimDisplayDataset(meta);
  const daily = Array.isArray(dataset.daily) ? dataset.daily : [];
  return {
    daily: daily.map((row) => {
      const record = asRecord(row);
      if (manualPastDisplay) {
        return normalizeManualPastDailySourceLabel(record);
      }
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
  sourceType?: WeatherUsageSourceType;
  preferredActualSource?: string | null;
  manualUsagePayload?: unknown;
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
  const sourceType =
    args.sourceType ??
    resolveUsageSourceTypeFromDataset(dataset, {
      manualUsagePayload: args.manualUsagePayload,
      preferredActualSource: args.preferredActualSource,
      mode: typeof meta.mode === "string" ? meta.mode : null,
    });
  return {
    scorerModule: WEATHER_SCORER_MODULE,
    scoreVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    sourceType,
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
  preferredActualSource?: string | null;
  sourceType?: WeatherUsageSourceType;
  simulationVariablePolicy?: import("@/modules/usageSimulator/simulationVariablePolicy").SimulationVariablePolicy | null;
  dailyWeather?: Record<string, unknown> | null;
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
    simulationVariablePolicy: args.simulationVariablePolicy ?? undefined,
    dailyWeather: args.dailyWeather as never,
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
      sourceType: args.sourceType,
      preferredActualSource: args.preferredActualSource,
      manualUsagePayload: args.manualUsagePayload,
      envelope,
    }),
  };
}

export async function resolvePastDisplayWeatherScore(args: {
  dataset: Record<string, unknown>;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  preferredActualSource?: string | null;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  const sourceType = resolveUsageSourceTypeFromDataset(args.dataset, {
    preferredActualSource: args.preferredActualSource,
  });
  return resolveWeatherScoreForContext({
    scoringContext: "PAST_DISPLAY",
    scoringDataset: buildPastDisplayScoringDataset(args.dataset),
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
    preferredActualSource: args.preferredActualSource,
    sourceType,
  });
}

export async function resolveActualUsageWeatherScore(args: {
  scoringDataset: Record<string, unknown> | null | undefined;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  manualUsagePayload?: unknown;
  preferredActualSource?: string | null;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  const sourceType = resolveUsageSourceTypeFromDataset(args.scoringDataset, {
    manualUsagePayload: args.manualUsagePayload,
    preferredActualSource: args.preferredActualSource,
  });
  return resolveWeatherScoreForContext({
    scoringContext: "ACTUAL_USAGE",
    scoringDataset: args.scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
    manualUsagePayload: args.manualUsagePayload,
    preferredActualSource: args.preferredActualSource,
    sourceType,
  });
}

export async function resolveSimulationBuildDiagnosticWeatherScore(args: {
  scoringDataset?: Record<string, unknown> | null;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  manualUsagePayload?: unknown;
  preferredActualSource?: string | null;
  sourceType?: WeatherUsageSourceType;
  simulationVariablePolicy?: import("@/modules/usageSimulator/simulationVariablePolicy").SimulationVariablePolicy | null;
  dailyWeather?: Record<string, unknown> | null;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  const sourceType =
    args.sourceType ??
    resolveUsageSourceTypeFromDataset(args.scoringDataset, {
      manualUsagePayload: args.manualUsagePayload,
      preferredActualSource: args.preferredActualSource,
    });
  return resolveWeatherScoreForContext({
    scoringContext: "SIMULATION_BUILD",
    scoringDataset: args.scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
    manualUsagePayload: args.manualUsagePayload,
    preferredActualSource: args.preferredActualSource,
    sourceType,
    simulationVariablePolicy: args.simulationVariablePolicy,
    dailyWeather: args.dailyWeather,
  });
}

export async function resolveFingerprintDiagnosticWeatherScore(args: {
  scoringDataset?: Record<string, unknown> | null;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  manualUsagePayload?: unknown;
  preferredActualSource?: string | null;
  sourceType?: WeatherUsageSourceType;
}): Promise<WeatherSensitivityEnvelope & { audit: WeatherScoringAudit }> {
  const sourceType =
    args.sourceType ??
    resolveUsageSourceTypeFromDataset(args.scoringDataset, {
      manualUsagePayload: args.manualUsagePayload,
      preferredActualSource: args.preferredActualSource,
    });
  return resolveWeatherScoreForContext({
    scoringContext: "FINGERPRINT",
    scoringDataset: args.scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
    manualUsagePayload: args.manualUsagePayload,
    preferredActualSource: args.preferredActualSource,
    sourceType,
  });
}

export function readPreSimBuildDiagnosticScore(
  meta: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const record = asRecord(meta);
  const preSim = asRecord(record.weatherSensitivityScore);
  return Object.keys(preSim).length > 0 ? preSim : null;
}

export function weatherScoreCardValuesMatch(
  left: unknown,
  right: unknown
): boolean {
  const a = scoreCardValues(left);
  const b = scoreCardValues(right);
  if (a.weatherEfficiency == null || b.weatherEfficiency == null) return false;
  return (
    a.weatherEfficiency === b.weatherEfficiency &&
    a.cooling === b.cooling &&
    a.heating === b.heating &&
    a.confidence === b.confidence
  );
}

/** Persisted bundle C that still matches pre-sim bundle B was scored before display truth / stitched daily rows. */
export function pastDisplayScoreMatchesPreSimDiagnostic(
  meta: Record<string, unknown> | null | undefined
): boolean {
  const record = asRecord(meta);
  const pastDisplay = asRecord(record.pastDisplayWeatherSensitivityScore);
  if (Object.keys(pastDisplay).length === 0) return false;
  const preSim = readPreSimBuildDiagnosticScore(record);
  if (!preSim) return false;
  return weatherScoreCardValuesMatch(pastDisplay, preSim);
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
    if (
      preSim.weatherEfficiency != null &&
      pastDisplay.weatherEfficiency === preSim.weatherEfficiency &&
      pastDisplay.cooling === preSim.cooling &&
      pastDisplay.heating === preSim.heating &&
      pastDisplay.confidence === preSim.confidence
    ) {
      return "Persisted past display weather matches pre-sim build diagnostic (stale bundle C)";
    }
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

  if (
    args.visibleSourceOwner === "shared_weather_sensitivity_envelope" ||
    args.visibleSourceOwner === "actual_usage_weather_score"
  ) {
    return "User Past visible weather used Actual-layer score instead of meta.pastDisplayWeatherSensitivityScore";
  }

  if (args.visibleSourceOwner === "simulation_build_diagnostic" || args.visibleSourceOwner === "fingerprint_diagnostic") {
    return "User Past visible weather exposed build/fingerprint diagnostic score instead of past display weather";
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
