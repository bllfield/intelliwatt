type PriorityBand =
  | "Hard Truth"
  | "Hard Constraint"
  | "Reference Truth Pool"
  | "Primary Driver"
  | "Secondary Driver"
  | "Conditional Adjustment"
  | "Exclusion"
  | "Fallback Only"
  | "Not Used";

type LogicModeFamily = "actual_backed" | "manual_monthly" | "manual_annual" | "profile_only" | "other";

export type CalculationLogicInputGroup = {
  key: string;
  label: string;
  used: boolean;
  status: "hard truth" | "active driver" | "modeled-subset-only" | "context only" | "inactive";
  whereEntered: string[];
  sourceOfTruth: string;
  role: string;
  priorityBand: PriorityBand;
  details: string[];
  evidence: string[];
};

export type CalculationLogicLayer = {
  key: string;
  title: string;
  summary: string;
  variablesUsed: string[];
  preservedOrLocked: string[];
  simulatedOrDerived: string[];
  fallbackOrder: string[];
  modeSpecificRules: string[];
};

export type CalculationLogicPriorityItem = {
  label: string;
  priorityBand: PriorityBand;
  explanation: string;
};

export type CalculationLogicExclusionItem = {
  label: string;
  value: string;
  effect: string;
};

export type CalculationLogicTuningLever = {
  label: string;
  priorityBand: Exclude<PriorityBand, "Not Used">;
  explanation: string;
};

export type CalculationLogicCompositionItem = {
  label: string;
  priorityBand: Exclude<PriorityBand, "Not Used">;
  dayCount: number | null;
  dayShare: number | null;
  kwh: number | null;
  kwhShare: number | null;
  explanation: string;
};

export type CalculationLogicCompositionSection = {
  key: string;
  title: string;
  summary: string;
  items: CalculationLogicCompositionItem[];
};

export type CalculationLogicDecisionStep = {
  rank: number;
  key: string;
  label: string;
  explanation: string;
  observedCount: number | null;
};

export type CalculationLogicWeatherRow = {
  label: string;
  value: string;
  explanation: string;
};

export type CalculationLogicArtifactDecision = {
  label: string;
  value: string;
  explanation: string;
};

export type CalculationLogicRunImpactItem = {
  label: string;
  value: string;
  explanation: string;
};

export type CalculationLogicShapeBucketSummary = {
  bucketKey: string;
  monthKey: string;
  dayType: string;
  overnight: number;
  morning: number;
  afternoon: number;
  evening: number;
};

export type GapfillCalculationLogicSummary = {
  selectedMode: string;
  modeLabel: string;
  modeFamily: LogicModeFamily;
  modeOverview: string;
  stageOnePath: string;
  stageTwoPath: string;
  sharedProducerPathUsed: boolean;
  sourceHouseId: string | null;
  testHomeId: string | null;
  inputGroups: CalculationLogicInputGroup[];
  layers: CalculationLogicLayer[];
  compositionSections: CalculationLogicCompositionSection[];
  dailyTotalLogic: {
    summary: string;
    ladder: CalculationLogicDecisionStep[];
  };
  intervalCurveLogic: {
    summary: string;
    ladder: CalculationLogicDecisionStep[];
  };
  weatherExplanation: {
    summary: string;
    rows: CalculationLogicWeatherRow[];
  };
  priorityItems: CalculationLogicPriorityItem[];
  exclusions: CalculationLogicExclusionItem[];
  tuningLevers: CalculationLogicTuningLever[];
  artifactDecisionSummary: CalculationLogicArtifactDecision[];
  runImpactSummary: CalculationLogicRunImpactItem[];
  shapeBucketSummaries: CalculationLogicShapeBucketSummary[];
  rawDiagnostics: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function countBy<T>(items: T[], toKey: (item: T) => string | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = String(toKey(item) ?? "").trim();
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function joinNonEmpty(parts: Array<string | null | undefined>, sep = " | "): string {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(sep);
}

function describeCountMap(counts: Record<string, number>, empty = "none observed"): string {
  const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) return empty;
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}

function formatMaybeNumber(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "not attached";
}

function formatMaybeCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "not attached";
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function prettyLabel(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function bandForSourceDetail(detail: string): Exclude<PriorityBand, "Not Used"> {
  if (detail === "ACTUAL" || detail === "ACTUAL_VALIDATION_TEST_DAY") return "Hard Truth";
  if (detail === "SIMULATED_TEST_DAY") return "Primary Driver";
  if (detail === "SIMULATED_MONTHLY_CONSTRAINED_NON_TRAVEL") return "Hard Constraint";
  if (detail === "SIMULATED_TRAVEL_VACANT" || detail === "SIMULATED_INCOMPLETE_METER" || detail === "SIMULATED_LEADING_MISSING") {
    return "Exclusion";
  }
  return "Fallback Only";
}

function explanationForSourceDetail(detail: string): string {
  switch (detail) {
    case "ACTUAL":
      return "Passed through as trusted actual output in the final stitched artifact.";
    case "ACTUAL_VALIDATION_TEST_DAY":
      return "Actual day kept visible in compare scope so the scored/test-day truth remains inspectable.";
    case "SIMULATED_TEST_DAY":
      return "Modeled output produced specifically for selected validation/test-day compare behavior.";
    case "SIMULATED_TRAVEL_VACANT":
      return "Modeled because travel/vacant exclusions removed the day from the trusted fingerprint pool.";
    case "SIMULATED_MONTHLY_CONSTRAINED_NON_TRAVEL":
      return "Modeled underneath a monthly constraint even though the day is not a travel/vacant exclusion.";
    case "SIMULATED_INCOMPLETE_METER":
      return "Modeled because incomplete meter coverage disqualified the day from trusted actual truth.";
    case "SIMULATED_LEADING_MISSING":
      return "Modeled because leading missing coverage prevented use as trusted reference truth.";
    default:
      return "Modeled by the shared simulator after stronger truth or constraint paths ran out.";
  }
}

function normalizeDailyRows(dataset: any): Array<{ date: string; kwh: number; sourceDetail: string }> {
  return asArray<Record<string, unknown>>(dataset?.daily)
    .map((row) => ({
      date: String(row.date ?? "").slice(0, 10),
      kwh: Number(row.kwh ?? 0) || 0,
      sourceDetail: String(row.sourceDetail ?? row.source ?? "unknown").trim() || "unknown",
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

function buildCompositionItems(
  rows: Array<{ date: string; kwh: number; sourceDetail: string }>
): CalculationLogicCompositionItem[] {
  const totals = rows.reduce(
    (acc, row) => {
      acc.dayCount += 1;
      acc.kwh += row.kwh;
      return acc;
    },
    { dayCount: 0, kwh: 0 }
  );
  const grouped = new Map<string, { dayCount: number; kwh: number }>();
  rows.forEach((row) => {
    const bucket = grouped.get(row.sourceDetail) ?? { dayCount: 0, kwh: 0 };
    bucket.dayCount += 1;
    bucket.kwh += row.kwh;
    grouped.set(row.sourceDetail, bucket);
  });
  return Array.from(grouped.entries())
    .map(([detail, summary]) => ({
      label: detail,
      priorityBand: bandForSourceDetail(detail),
      dayCount: summary.dayCount,
      dayShare: totals.dayCount > 0 ? round4(summary.dayCount / totals.dayCount) : null,
      kwh: round4(summary.kwh),
      kwhShare: totals.kwh > 0 ? round4(summary.kwh / totals.kwh) : null,
      explanation: explanationForSourceDetail(detail),
    }))
    .sort((a, b) => (b.dayCount ?? 0) - (a.dayCount ?? 0) || a.label.localeCompare(b.label));
}

function countForKeys(counts: Record<string, number>, keys: string[]): number | null {
  const total = keys.reduce((sum, key) => sum + (Number(counts[key] ?? 0) || 0), 0);
  return total > 0 ? total : null;
}

function inferModeInfo(selectedMode: string, lockboxMode: string): {
  modeFamily: LogicModeFamily;
  modeLabel: string;
  stageOnePath: string;
  modeOverview: string;
} {
  const key = String(selectedMode || lockboxMode).trim();
  switch (key) {
    case "EXACT_INTERVALS":
    case "ACTUAL_INTERVAL_BASELINE":
    case "actual_data_fingerprint":
      return {
        modeFamily: "actual_backed",
        modeLabel: "Exact Intervals / Actual-Backed",
        stageOnePath: "Use source actual intervals as the pre-normalization truth input. No manual totals are created.",
        modeOverview:
          "This run is actual-backed: trusted source intervals stay primary, exclusions trim the usable reference pool, and compare scores persisted modeled output against actual validation days.",
      };
    case "MONTHLY_FROM_SOURCE_INTERVALS":
    case "MANUAL_MONTHLY":
    case "manual_monthly_constrained":
      return {
        modeFamily: "manual_monthly",
        modeLabel: "Manual Monthly Constrained",
        stageOnePath:
          "Run the shared manual-monthly Stage 1 helper flow first: source payload precedence, seeded statement ranges when needed, then monthly totals enter the lockbox as hard constraints.",
        modeOverview:
          "This run uses manual monthly constrained input: monthly totals stay fixed, bill-range semantics remain relevant for reconciliation, and daily/interval detail is generated by the shared Past simulator.",
      };
    case "ANNUAL_FROM_SOURCE_INTERVALS":
    case "MANUAL_ANNUAL":
    case "manual_annual_constrained":
      return {
        modeFamily: "manual_annual",
        modeLabel: "Manual Annual Constrained",
        stageOnePath:
          "Run the shared manual-annual Stage 1 helper flow first: source payload precedence, annual seed selection when needed, then one annual total enters the lockbox as the hard constraint.",
        modeOverview:
          "This run uses manual annual constrained input: the annual total stays fixed, monthly distribution is derived, and daily/interval detail is generated by the shared Past simulator.",
      };
    case "PROFILE_ONLY_NEW_BUILD":
      return {
        modeFamily: "profile_only",
        modeLabel: "Profile-Only New Build",
        stageOnePath:
          "Skip source-interval truth and build the run from home/appliance priors plus shared weather/profile context before lockbox entry.",
        modeOverview:
          "This run is profile-driven: home and appliance inputs lead, shared weather still shapes the output, and interval truth from a source house does not anchor the monthly result.",
      };
    default:
      return {
        modeFamily: "other",
        modeLabel: key || "Unknown GapFill Mode",
        stageOnePath: "Read the selected mode from persisted lockbox metadata. No extra mode-specific explanation was attached.",
        modeOverview:
          "This view is read-only and artifact-backed. It explains the persisted lockbox path without creating a second simulation path.",
      };
  }
}

function monthlyLayerSummary(modeFamily: LogicModeFamily): {
  summary: string;
  preservedOrLocked: string[];
  simulatedOrDerived: string[];
  modeSpecificRules: string[];
} {
  switch (modeFamily) {
    case "manual_monthly":
      return {
        summary: "Monthly totals are fixed first, then the shared simulator distributes daily and interval detail underneath those monthly constraints.",
        preservedOrLocked: ["Entered or source-derived monthly totals", "Bill-range intent for later reconciliation"],
        simulatedOrDerived: ["Daily totals inside each constrained month", "Interval curves inside each simulated day"],
        modeSpecificRules: [
          "Statement/bill-range semantics stay attached to the run.",
          "Monthly-target construction diagnostics explain travel-aware normalization when attached.",
        ],
      };
    case "manual_annual":
      return {
        summary: "The annual total is fixed first, then the shared builder derives monthly targets before daily and interval shaping.",
        preservedOrLocked: ["Single annual total"],
        simulatedOrDerived: ["Monthly allocation", "Daily totals", "Interval curves"],
        modeSpecificRules: [
          "Month targets are derived from the annual constraint instead of monthly statement entries.",
          "Annual allocation still flows into the same shared Stage 2 producer path.",
        ],
      };
    case "actual_backed":
      return {
        summary: "Monthly totals are aggregated from source intervals; there is no manual total constraint layer ahead of daily/interval truth.",
        preservedOrLocked: ["Actual interval-derived energy"],
        simulatedOrDerived: ["Only modeled keep-ref/test outputs where the shared producer requires them"],
        modeSpecificRules: [
          "The actual-backed branch preserves source interval truth as the baseline input.",
        ],
      };
    case "profile_only":
      return {
        summary: "Monthly targets are estimated from home/appliance priors because no actual-backed or manual total constraint anchors the run.",
        preservedOrLocked: ["Profile-only priors"],
        simulatedOrDerived: ["Monthly totals", "Daily totals", "Interval shapes"],
        modeSpecificRules: [
          "This mode is synthetic-first and falls back to priors earlier than other GapFill modes.",
        ],
      };
    default:
      return {
        summary: "Monthly targeting uses the persisted shared build inputs for the selected mode.",
        preservedOrLocked: [],
        simulatedOrDerived: [],
        modeSpecificRules: [],
      };
  }
}

export function buildGapfillCalculationLogicSummary(args: {
  selectedMode: string | null | undefined;
  dataset: any;
  sharedDiagnostics: unknown;
  compareProjection?: { rows?: unknown; metrics?: unknown } | null;
  sourceHouseId?: string | null;
  testHomeId?: string | null;
  sourceTravelRanges?: Array<{ startDate: string; endDate: string }> | null;
  testHomeTravelRanges?: Array<{ startDate: string; endDate: string }> | null;
  effectiveTravelRanges?: Array<{ startDate: string; endDate: string }> | null;
  effectiveTravelRangesSource?: string | null;
  rawCompareDailyRows?: Array<{ date: string; kwh: number; source?: string | null; sourceDetail?: string | null }> | null;
}): GapfillCalculationLogicSummary {
  const dataset = args.dataset ?? {};
  const meta = asRecord(dataset?.meta);
  const sharedDiagnostics = asRecord(args.sharedDiagnostics);
  const identityContext = asRecord(sharedDiagnostics.identityContext);
  const sourceTruthContext = asRecord(sharedDiagnostics.sourceTruthContext);
  const lockboxExecutionSummary = asRecord(sharedDiagnostics.lockboxExecutionSummary);
  const projectionReadSummary = asRecord(sharedDiagnostics.projectionReadSummary);
  const tuningSummary = asRecord(sharedDiagnostics.tuningSummary);
  const lockboxInput = asRecord(meta.lockboxInput);
  const perRunTrace = asRecord(meta.lockboxPerRunTrace);
  const sourceContext = asRecord(lockboxInput.sourceContext);
  const profileContext = asRecord(lockboxInput.profileContext);
  const validationKeys = asRecord(lockboxInput.validationKeys);
  const travelRanges = asRecord(lockboxInput.travelRanges);
  const perDayTrace = asArray<Record<string, unknown>>(meta.lockboxPerDayTrace);
  const compareProjection = asRecord(args.compareProjection);
  const compareMetrics = asRecord(compareProjection.metrics);
  const compareRows = asArray(compareProjection.rows);
  const sourceTravelRangeList = asArray<Record<string, unknown>>(args.sourceTravelRanges);
  const testHomeTravelRangeList = asArray<Record<string, unknown>>(args.testHomeTravelRanges);
  const effectiveTravelRangeList = asArray<Record<string, unknown>>(args.effectiveTravelRanges);
  const rawCompareDailyRows = asArray<Record<string, unknown>>(args.rawCompareDailyRows);
  const selectedMode = String(
    args.selectedMode ??
      identityContext.usageInputMode ??
      lockboxInput.mode ??
      identityContext.simulatorMode ??
      ""
  ).trim();
  const lockboxMode = String(lockboxInput.mode ?? identityContext.simulatorMode ?? "").trim();
  const modeInfo = inferModeInfo(selectedMode, lockboxMode);
  const sharedProducerPathUsed = lockboxExecutionSummary.sharedProducerPathUsed === true || meta.sharedProducerPathUsed === true;
  const sourceHouseId =
    String(
      args.sourceHouseId ??
        identityContext.sourceHouseId ??
        sourceContext.sourceHouseId ??
        perRunTrace.sourceHouseId ??
        ""
    ).trim() || null;
  const testHomeId =
    String(
      args.testHomeId ??
        identityContext.profileHouseId ??
        profileContext.testHomeId ??
        perRunTrace.testHomeId ??
        profileContext.profileHouseId ??
        ""
    ).trim() || null;
  const travelRangeList = asArray<Record<string, unknown>>(travelRanges.ranges ?? sourceTruthContext.travelRangesUsed);
  const validationKeyList = asArray<string>(validationKeys.localDateKeys ?? sourceTruthContext.validationTestKeysUsed);
  const monthlyDiagnostics = asArray<Record<string, unknown>>(sourceTruthContext.monthlyTargetConstructionDiagnostics);
  const fingerprintDiagnostics = asRecord(sourceTruthContext.intervalUsageFingerprintDiagnostics);
  const perDayReasonCounts = countBy(perDayTrace, (row) => String(row.simulatedReasonCode ?? "").trim());
  const perDayFallbackCounts = countBy(perDayTrace, (row) => String(row.fallbackLevel ?? "").trim());
  const perDayShapeVariantCounts = countBy(perDayTrace, (row) => String(row.shapeVariantUsed ?? "").trim());
  const perDayWeatherModeCounts = countBy(perDayTrace, (row) => String(row.weatherModeUsed ?? "").trim());
  const perDayClassificationCounts = countBy(perDayTrace, (row) => String(row.dayClassification ?? "").trim());
  const keepRefUtcDateKeyCount = lockboxExecutionSummary.keepRefUtcDateKeyCount;
  const dailySourceClassificationsSummary = asRecord(tuningSummary.dailySourceClassificationsSummary);
  const monthlyLayer = monthlyLayerSummary(modeInfo.modeFamily);
  const dailyRows = normalizeDailyRows(dataset);
  const selectedValidationDateSet = new Set(
    asArray<Record<string, unknown>>(tuningSummary.selectedValidationRows)
      .map((row) => String(row.localDate ?? "").slice(0, 10))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  );
  const selectedCompareRows = rawCompareDailyRows.length > 0
    ? rawCompareDailyRows
        .map((row) => ({
          date: String(row.date ?? "").slice(0, 10),
          kwh: Number(row.kwh ?? 0) || 0,
          sourceDetail: String(row.sourceDetail ?? row.source ?? "unknown").trim() || "unknown",
        }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && selectedValidationDateSet.has(row.date))
    : dailyRows.filter((row) => selectedValidationDateSet.has(row.date));
  const fingerprintShapeSummaryByMonthDayType = asRecord(tuningSummary.fingerprintShapeSummaryByMonthDayType);
  const shapeBucketSummaries: CalculationLogicShapeBucketSummary[] = Object.entries(fingerprintShapeSummaryByMonthDayType)
    .flatMap(([monthKey, dayTypeBuckets]) => {
      const dayTypeRecord = asRecord(dayTypeBuckets);
      return Object.entries(dayTypeRecord).map(([dayType, distribution]) => {
        const normalized = asRecord(distribution);
        return {
          bucketKey: `${monthKey}:${dayType}`,
          monthKey,
          dayType,
          overnight: Number(normalized.overnight ?? 0) || 0,
          morning: Number(normalized.morning ?? 0) || 0,
          afternoon: Number(normalized.afternoon ?? 0) || 0,
          evening: Number(normalized.evening ?? 0) || 0,
        };
      });
    })
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.dayType.localeCompare(b.dayType));
  const modeledFinalDayCount = dailyRows.filter((row) => /^SIMULATED/.test(row.sourceDetail)).length;
  const modeledCompareDayCount = selectedCompareRows.filter((row) => /^SIMULATED/.test(row.sourceDetail)).length;
  const weatherAdjustedDayCount =
    Number(perDayClassificationCounts.weather_scaled_day ?? 0) +
    Number(perDayClassificationCounts.extreme_cold_event_day ?? 0) +
    Number(perDayClassificationCounts.freeze_protect_day ?? 0);
  const usageShapeIdentity =
    String(
      sourceTruthContext.intervalUsageFingerprintIdentity ??
      profileContext.usageShapeProfileIdentity ??
      ""
    ).trim();
  const usageShapeProfileSourceOfTruth = usageShapeIdentity
    ? usageShapeIdentity
    : shapeBucketSummaries.length > 0
      ? "Explicit usageShapeProfileIdentity was not attached, but fingerprint-derived month/day-type/weather shape buckets were attached to the artifact diagnostics."
      : "not attached";

  const inputGroups: CalculationLogicInputGroup[] = [
    {
      key: "source-actual-intervals",
      label: "Source actual intervals",
      used: modeInfo.modeFamily !== "profile_only",
      status:
        modeInfo.modeFamily === "profile_only"
          ? "inactive"
          : modeInfo.modeFamily === "actual_backed"
            ? "hard truth"
            : "active driver",
      whereEntered:
        modeInfo.modeFamily === "profile_only"
          ? []
          : ["daily-total selection", "interval-shape selection", "compare only"],
      sourceOfTruth:
        sourceHouseId != null
          ? `Persisted source-house interval identity (${String(sourceTruthContext.intervalSourceIdentity ?? "identity not attached")})`
          : "Not attached",
      role:
        modeInfo.modeFamily === "actual_backed"
          ? "Main baseline truth"
          : "Trusted reference pool and source-derived seed context",
      priorityBand: modeInfo.modeFamily === "profile_only" ? "Not Used" : modeInfo.modeFamily === "actual_backed" ? "Reference Truth Pool" : "Primary Driver",
      details: [
        `Trusted fingerprint days: ${formatMaybeCount(fingerprintDiagnostics.trustedIntervalFingerprintDayCount)}`,
        `Interval fingerprint: ${String(sourceTruthContext.intervalSourceIdentity ?? "not attached")}`,
      ],
      evidence: [
        `Modeled final-output days: ${modeledFinalDayCount}`,
        `Selected compare days: ${selectedCompareRows.length}`,
      ],
    },
    {
      key: "manual-monthly",
      label: "Manual monthly totals",
      used: modeInfo.modeFamily === "manual_monthly",
      status: modeInfo.modeFamily === "manual_monthly" ? "hard truth" : "inactive",
      whereEntered: modeInfo.modeFamily === "manual_monthly" ? ["daily-total selection"] : [],
      sourceOfTruth:
        modeInfo.modeFamily === "manual_monthly"
          ? "Shared manual Stage 1 helper -> lockbox monthly constraints"
          : "Not used by this mode",
      role: modeInfo.modeFamily === "manual_monthly" ? "Fixed monthly constraint" : "Inactive",
      priorityBand: modeInfo.modeFamily === "manual_monthly" ? "Hard Constraint" : "Not Used",
      details: [
        monthlyDiagnostics.length > 0
          ? `Monthly target diagnostics attached for ${monthlyDiagnostics.length} month(s)`
          : "No monthly target diagnostics attached",
        modeInfo.modeFamily === "manual_monthly"
          ? "Bill-range semantics stay relevant for reconciliation."
          : "No monthly bill-range constraint path is active.",
      ],
      evidence: [
        monthlyDiagnostics.length > 0
          ? `Monthly target diagnostics present for ${monthlyDiagnostics.length} month bucket(s).`
          : "No monthly target diagnostics were attached to this artifact.",
      ],
    },
    {
      key: "manual-annual",
      label: "Manual annual total",
      used: modeInfo.modeFamily === "manual_annual",
      status: modeInfo.modeFamily === "manual_annual" ? "hard truth" : "inactive",
      whereEntered: modeInfo.modeFamily === "manual_annual" ? ["daily-total selection"] : [],
      sourceOfTruth:
        modeInfo.modeFamily === "manual_annual"
          ? `Shared annual constraint (${formatMaybeNumber(sourceContext.sourceDerivedAnnualTotalKwh, 0)} kWh when attached)`
          : "Not used by this mode",
      role: modeInfo.modeFamily === "manual_annual" ? "Fixed annual constraint" : "Inactive",
      priorityBand: modeInfo.modeFamily === "manual_annual" ? "Hard Constraint" : "Not Used",
      details: [
        modeInfo.modeFamily === "manual_annual"
          ? "Annual total is preserved while monthly/daily shape is derived later."
          : "No annual constraint path is active.",
      ],
      evidence: [
        `Derived annual total attached: ${formatMaybeNumber(sourceContext.sourceDerivedAnnualTotalKwh, 0)} kWh`,
      ],
    },
    {
      key: "home-profile",
      label: "Home profile",
      used: profileContext.profileHouseId != null || modeInfo.modeFamily === "profile_only",
      status:
        modeInfo.modeFamily === "profile_only"
          ? "active driver"
          : modeledFinalDayCount > 0
            ? "modeled-subset-only"
            : profileContext.profileHouseId != null
              ? "context only"
              : "inactive",
      whereEntered:
        modeInfo.modeFamily === "profile_only"
          ? ["daily-total selection", "weather adjustment", "interval-shape selection"]
          : modeledFinalDayCount > 0
            ? ["weather adjustment"]
            : [],
      sourceOfTruth: `Profile house ${String(profileContext.profileHouseId ?? testHomeId ?? "not attached")}`,
      role: modeInfo.modeFamily === "profile_only" ? "Primary synthetic driver" : "Context and tuning prior",
      priorityBand: modeInfo.modeFamily === "profile_only" ? "Primary Driver" : "Secondary Driver",
      details: [
        `Home profile snapshot ref: ${String(profileContext.homeProfileSnapshotRef ?? "not attached")}`,
      ],
      evidence: [
        modeInfo.modeFamily === "profile_only"
          ? "Profile-only mode elevates home context into an active synthetic driver."
          : modeledFinalDayCount > 0
            ? `Modeled subset size: ${modeledFinalDayCount} day(s); home profile context can affect weather/event behavior on those modeled days.`
            : "This artifact did not expose evidence that home profile inputs materially moved the final output.",
      ],
    },
    {
      key: "appliance-profile",
      label: "Appliance profile",
      used: profileContext.profileHouseId != null || modeInfo.modeFamily === "profile_only",
      status:
        modeInfo.modeFamily === "profile_only"
          ? "active driver"
          : modeledFinalDayCount > 0
            ? "modeled-subset-only"
            : profileContext.profileHouseId != null
              ? "context only"
              : "inactive",
      whereEntered:
        modeInfo.modeFamily === "profile_only"
          ? ["daily-total selection", "weather adjustment", "interval-shape selection"]
          : modeledFinalDayCount > 0
            ? ["weather adjustment"]
            : [],
      sourceOfTruth: `Profile house ${String(profileContext.profileHouseId ?? testHomeId ?? "not attached")}`,
      role: modeInfo.modeFamily === "profile_only" ? "Primary synthetic driver" : "Context and tuning prior",
      priorityBand: modeInfo.modeFamily === "profile_only" ? "Primary Driver" : "Secondary Driver",
      details: [
        `Appliance profile snapshot ref: ${String(profileContext.applianceProfileSnapshotRef ?? "not attached")}`,
      ],
      evidence: [
        modeInfo.modeFamily === "profile_only"
          ? "Profile-only mode elevates appliance context into an active synthetic driver."
          : modeledFinalDayCount > 0
            ? `Modeled subset size: ${modeledFinalDayCount} day(s); appliance context mostly matters on modeled weather/event days, not passthrough actual days.`
            : "This artifact did not expose evidence that appliance profile inputs materially moved the final output.",
      ],
    },
    {
      key: "weather",
      label: "Weather inputs",
      used: Boolean(identityContext.weatherLogicMode ?? sourceContext.weatherIdentity ?? meta.weatherSourceSummary),
      status:
        weatherAdjustedDayCount > 0
          ? "active driver"
          : modeledFinalDayCount > 0
            ? "modeled-subset-only"
            : Boolean(identityContext.weatherLogicMode ?? sourceContext.weatherIdentity ?? meta.weatherSourceSummary)
              ? "context only"
              : "inactive",
      whereEntered:
        Boolean(identityContext.weatherLogicMode ?? sourceContext.weatherIdentity ?? meta.weatherSourceSummary)
          ? ["weather adjustment", "interval-shape selection"]
          : [],
      sourceOfTruth: joinNonEmpty([
        String(identityContext.weatherLogicMode ?? sourceContext.weatherLogicMode ?? "weather mode not attached"),
        String(sourceTruthContext.weatherDatasetIdentity ?? sourceContext.weatherIdentity ?? "weather identity not attached"),
        String(sourceTruthContext.weatherSourceIdentity ?? meta.weatherSourceSummary ?? "weather provenance not attached"),
      ]),
      role: "Daily-total adjustment and weather-regime shape selection",
      priorityBand: "Conditional Adjustment",
      details: [
        `Weather mode counts: ${describeCountMap(perDayWeatherModeCounts)}`,
        `Weather classifications: ${describeCountMap(perDayClassificationCounts)}`,
      ],
      evidence: [
        `Weather-adjusted or event-day count: ${weatherAdjustedDayCount}`,
        `Modeled subset size: ${modeledFinalDayCount}`,
      ],
    },
    {
      key: "travel-validation",
      label: "Travel/vacant and validation selection",
      used: travelRangeList.length > 0 || validationKeyList.length > 0 || keepRefUtcDateKeyCount != null,
      status:
        travelRangeList.length > 0 || validationKeyList.length > 0 || keepRefUtcDateKeyCount != null
          ? "active driver"
          : "inactive",
      whereEntered:
        travelRangeList.length > 0 || validationKeyList.length > 0 || keepRefUtcDateKeyCount != null
          ? ["exclusions", "compare only"]
          : [],
      sourceOfTruth: "Persisted lockbox validation keys plus the effective travel-range set used for the latest test-home recalc",
      role: "Exclusion and compare-scope control",
      priorityBand: "Exclusion",
      details: [
        `Effective travel ranges used in artifact: ${travelRangeList.length}`,
        `Latest effective travel source: ${String(args.effectiveTravelRangesSource ?? "not attached")}`,
        `Source Home travel ranges visible in GapFill: ${sourceTravelRangeList.length}`,
        `Test Home saved travel ranges visible in GapFill: ${testHomeTravelRangeList.length}`,
        `Latest effective travel ranges returned by route: ${effectiveTravelRangeList.length}`,
        `Validation/test days: ${validationKeyList.length}`,
        `Modeled keep-ref days: ${formatMaybeCount(keepRefUtcDateKeyCount)}`,
      ],
      evidence: [
        `Selected validation/test compare days: ${selectedCompareRows.length}`,
        `Travel ranges attached to artifact: ${travelRangeList.length}`,
      ],
    },
    {
      key: "usage-shape-profile",
      label: "Usage shape profile",
      used: Boolean(usageShapeIdentity || shapeBucketSummaries.length > 0 || Object.keys(perDayShapeVariantCounts).length > 0),
      status:
        Object.keys(perDayShapeVariantCounts).length > 0
          ? modeledFinalDayCount > 0 || selectedCompareRows.length > 0
            ? "modeled-subset-only"
            : "active driver"
          : usageShapeIdentity || shapeBucketSummaries.length > 0
            ? "context only"
            : "inactive",
      whereEntered:
        usageShapeIdentity || shapeBucketSummaries.length > 0 || Object.keys(perDayShapeVariantCounts).length > 0
          ? ["interval-shape selection"]
          : [],
      sourceOfTruth: usageShapeProfileSourceOfTruth,
      role: "Interval-shape bucket selection and fallback shape context",
      priorityBand: modeInfo.modeFamily === "actual_backed" ? "Secondary Driver" : "Primary Driver",
      details: [
        `Shape variants observed: ${describeCountMap(perDayShapeVariantCounts)}`,
        `Month/day-type buckets: ${describeCountMap({
          months: asArray<string>(fingerprintDiagnostics.fingerprintMonthBucketsUsed).length,
          weekdayWeekend: asArray<string>(fingerprintDiagnostics.fingerprintWeekdayWeekendBucketsUsed).length,
          weather: asArray<string>(fingerprintDiagnostics.fingerprintWeatherBucketsUsed).length,
        })}`,
      ],
      evidence: [
        Object.keys(perDayShapeVariantCounts).length > 0
          ? `Shape buckets were actually used on ${Object.values(perDayShapeVariantCounts).reduce((sum, value) => sum + value, 0)} modeled day(s).`
          : "No per-day shape variant selections were attached to this artifact.",
        usageShapeIdentity
          ? `Explicit usageShapeProfileIdentity attached: ${usageShapeIdentity}`
          : shapeBucketSummaries.length > 0
            ? "Fingerprint-derived shape bucket summaries were attached even though an explicit identity string was missing."
            : "No explicit identity or bucket summary was attached.",
      ],
    },
    {
      key: "fallback-estimate",
      label: "Fallback estimation path",
      used: modeInfo.modeFamily !== "actual_backed",
      status:
        modeInfo.modeFamily === "actual_backed"
          ? "inactive"
          : Object.keys(perDayFallbackCounts).length > 0
            ? "modeled-subset-only"
            : "context only",
      whereEntered: modeInfo.modeFamily === "actual_backed" ? [] : ["daily-total selection"],
      sourceOfTruth: "Shared simulator fallback ladder",
      role: "Used only when stronger monthly/day-shape evidence is missing",
      priorityBand: modeInfo.modeFamily === "actual_backed" ? "Not Used" : "Fallback Only",
      details: [
        `Observed daily fallback levels: ${describeCountMap(perDayFallbackCounts)}`,
      ],
      evidence: [
        Object.keys(perDayFallbackCounts).length > 0
          ? `Fallbacks were exercised on ${Object.values(perDayFallbackCounts).reduce((sum, value) => sum + value, 0)} day(s).`
          : "No observed fallback selections were attached to this artifact.",
      ],
    },
  ];

  const layers: CalculationLogicLayer[] = [
    {
      key: "input-constraint-layer",
      title: "1. Input / Constraint Layer",
      summary: modeInfo.stageOnePath,
      variablesUsed: inputGroups.filter((group) => group.used).map((group) => group.label),
      preservedOrLocked:
        modeInfo.modeFamily === "actual_backed"
          ? ["Source interval truth", "Validation/test selection only changes grading scope"]
          : monthlyLayer.preservedOrLocked,
      simulatedOrDerived:
        modeInfo.modeFamily === "actual_backed"
          ? ["Modeled keep-ref/test outputs only where the shared producer requires them"]
          : monthlyLayer.simulatedOrDerived,
      fallbackOrder: [],
      modeSpecificRules: [
        modeInfo.modeOverview,
        `Selected mode key: ${selectedMode || lockboxMode || "not attached"}`,
      ],
    },
    {
      key: "monthly-target-layer",
      title: "2. Monthly Target Layer",
      summary: monthlyLayer.summary,
      variablesUsed: [
        "Monthly or annual constraint inputs",
        "Source-derived monthly/annual diagnostics",
        "Profile priors when stronger evidence is missing",
      ],
      preservedOrLocked: monthlyLayer.preservedOrLocked,
      simulatedOrDerived: monthlyLayer.simulatedOrDerived,
      fallbackOrder:
        modeInfo.modeFamily === "manual_monthly"
          ? [
              "Shared monthly payload precedence first",
              "Actual-derived seeded statement ranges when usable source monthly payload is missing",
              "Stage 2 still uses the shared producer path after normalization",
            ]
          : modeInfo.modeFamily === "manual_annual"
            ? [
                "Shared annual payload precedence first",
                "Actual-derived annual seed when a usable annual payload is missing",
                "No monthly bill-range reconciliation is injected into annual mode",
              ]
            : modeInfo.modeFamily === "profile_only"
              ? ["Profile-only priors lead because no stronger source truth is attached"]
              : ["Actual interval aggregation defines the monthly baseline when interval truth is available"],
      modeSpecificRules: monthlyLayer.modeSpecificRules,
    },
    {
      key: "reference-pool-layer",
      title: "3. Trusted Reference Pool Layer",
      summary: "Trusted interval days build the reference pool and fingerprint context; exclusions remove low-trust days before daily and shape selection.",
      variablesUsed: [
        "Trusted interval fingerprint days",
        "Travel/vacant exclusions",
        "Incomplete meter / leading missing exclusions",
        "Validation keep-ref settings",
      ],
      preservedOrLocked: ["Trusted source-day evidence that remains in the fingerprint pool"],
      simulatedOrDerived: ["Modeled keep-ref outputs for selected validation/test days when applicable"],
      fallbackOrder: [
        `Trusted days: ${formatMaybeCount(fingerprintDiagnostics.trustedIntervalFingerprintDayCount)}`,
        `Travel/vacant excluded: ${formatMaybeCount(fingerprintDiagnostics.excludedTravelVacantFingerprintDayCount)}`,
        `Incomplete meter excluded: ${formatMaybeCount(fingerprintDiagnostics.excludedIncompleteMeterFingerprintDayCount)}`,
        `Leading missing excluded: ${formatMaybeCount(fingerprintDiagnostics.excludedLeadingMissingFingerprintDayCount)}`,
      ],
      modeSpecificRules: [
        keepRefUtcDateKeyCount != null
          ? `Validation keep-ref UTC day count: ${formatMaybeCount(keepRefUtcDateKeyCount)}`
          : "No modeled keep-ref count was attached to this artifact.",
      ],
    },
    {
      key: "daily-total-layer",
      title: "4. Daily Total Selection Layer",
      summary:
        "The shared day selector chooses a target daily kWh from the strongest available same-shape history, then falls back step-by-step when that evidence is weak.",
      variablesUsed: [
        "Month/day-type history",
        "Neighbor day-of-month samples",
        "Adjacent-month day-type averages",
        "Global fallback averages",
      ],
      preservedOrLocked: ["Hard monthly or annual constraints remain intact above this layer"],
      simulatedOrDerived: ["Per-day kWh targets"],
      fallbackOrder: [
        "Same-month nearest day-of-month neighbor",
        "Same-month weekday/weekend average",
        "Adjacent-month weekday/weekend average",
        "Same-month overall average",
        "Season overall average",
        "Global weekday/weekend average",
        "Global overall average",
      ],
      modeSpecificRules: [
        `Observed fallback levels in this artifact: ${describeCountMap(perDayFallbackCounts)}`,
      ],
    },
    {
      key: "weather-layer",
      title: "5. Weather Adjustment Layer",
      summary:
        "Weather adjusts the selected day total after the base day is chosen. Heating/cooling days can scale the target, and event days can add stronger freeze or aux-heat behavior.",
      variablesUsed: ["Weather logic mode", "Weather identity/provenance", "Day classification", "Weather severity multiplier"],
      preservedOrLocked: ["Base day total remains the anchor for normal days"],
      simulatedOrDerived: ["Weather-scaled day totals", "Event-day adders and classifications"],
      fallbackOrder: [
        "Normal day: keep base day total",
        "Weather-scaled day: blend weather-adjusted total back toward the profile anchor",
        "Extreme cold / freeze-protect day: use full event energy",
      ],
      modeSpecificRules: [
        `Weather provenance: ${String(sourceTruthContext.weatherSourceIdentity ?? meta.weatherSourceSummary ?? "not attached")}`,
        `Weather mode/classification counts: ${describeCountMap({ ...perDayWeatherModeCounts, ...perDayClassificationCounts })}`,
      ],
    },
    {
      key: "shape-layer",
      title: "6. Interval Shape Layer",
      summary:
        "Once the day total is set, the shared shape selector chooses the strongest available 96-slot profile for that month/day-type/weather regime combination.",
      variablesUsed: ["Usage shape profile identity", "Month/day-type/weather buckets", "Per-day shape variant selection"],
      preservedOrLocked: ["Daily total chosen in the previous layer"],
      simulatedOrDerived: ["96-slot interval shape", "Per-interval kWh allocation"],
      fallbackOrder: [
        "Month + day-type + weather regime",
        "Month + day-type",
        "Month flat shape",
        "Weekday/weekend + weather regime",
        "Weekday/weekend flat shape",
        "Uniform 96-slot fallback",
      ],
      modeSpecificRules: [
        `Observed shape variants: ${describeCountMap(perDayShapeVariantCounts)}`,
      ],
    },
    {
      key: "stitch-layer",
      title: "7. Stitch / Final Output Layer",
      summary:
        "The shared producer writes the final daily, monthly, interval, and artifact metadata once the lockbox run completes; GapFill only reads that persisted truth.",
      variablesUsed: ["Shared producer path flag", "Artifact input hash", "Full chain hash", "Projection read mode"],
      preservedOrLocked: ["Shared Stage 2 producer path"],
      simulatedOrDerived: ["Persisted baseline projection and display rows"],
      fallbackOrder: [],
      modeSpecificRules: [
        `Shared producer path used: ${sharedProducerPathUsed ? "true" : "false"}`,
        `Artifact input hash: ${String(lockboxExecutionSummary.artifactInputHash ?? "not attached")}`,
        `Read mode / projection mode: ${joinNonEmpty([
          String(projectionReadSummary.readMode ?? ""),
          String(projectionReadSummary.projectionMode ?? ""),
        ]) || "not attached"}`,
      ],
    },
    {
      key: "compare-layer",
      title: "8. Compare / Scoring Layer",
      summary:
        "GapFill scoring stays read-only and artifact-backed. Persisted validation/test compare rows and metrics are read after the shared producer finishes; no route-local simulator path is introduced.",
      variablesUsed: ["Validation/test keys", "Persisted compare rows", "Persisted compare metrics", "Diagnostics verdict"],
      preservedOrLocked: ["Compare/scoring semantics"],
      simulatedOrDerived: ["Error metrics and row-level deltas"],
      fallbackOrder: [],
      modeSpecificRules: [
        `Persisted compare rows: ${formatMaybeCount(
          projectionReadSummary.validationRowsCount ?? compareRows.length
        )}`,
        `WAPE: ${formatMaybeNumber(compareMetrics.wape)} | MAE: ${formatMaybeNumber(compareMetrics.mae)}`,
      ],
    },
  ];

  const compositionSections: CalculationLogicCompositionSection[] = [
    {
      key: "final-output",
      title: "Final stitched output composition",
      summary:
        "This shows what the final persisted artifact is made of by day count and kWh share, separating passed-through actual truth from modeled categories.",
      items: buildCompositionItems(dailyRows),
    },
    {
      key: "compare-output",
      title: "Compare / test-day composition",
      summary:
        "This isolates the selected scored/test days only, so you can see whether the compare window is mostly actual, mostly modeled, or driven by specific exclusion classes.",
      items: buildCompositionItems(selectedCompareRows),
    },
    {
      key: "reference-pool",
      title: "Trusted reference-pool composition",
      summary:
        "Reference-pool rows come from persisted fingerprint diagnostics only. These counts show how much trusted history survived exclusions before daily and interval-shape selection ran.",
      items: [
        {
          label: "TRUSTED_INTERVAL_FINGERPRINT_DAYS",
          priorityBand: "Reference Truth Pool" as const,
          dayCount: Number(fingerprintDiagnostics.trustedIntervalFingerprintDayCount ?? 0) || 0,
          dayShare: null,
          kwh: null,
          kwhShare: null,
          explanation: "Clean source-history days that remained eligible to drive daily-total and shape selection.",
        },
        {
          label: "EXCLUDED_TRAVEL_VACANT",
          priorityBand: "Exclusion" as const,
          dayCount: Number(fingerprintDiagnostics.excludedTravelVacantFingerprintDayCount ?? 0) || 0,
          dayShare: null,
          kwh: null,
          kwhShare: null,
          explanation: "Travel/vacant exclusions shrink the trusted pool and force those days onto the modeled path.",
        },
        {
          label: "EXCLUDED_INCOMPLETE_METER",
          priorityBand: "Exclusion" as const,
          dayCount: Number(fingerprintDiagnostics.excludedIncompleteMeterFingerprintDayCount ?? 0) || 0,
          dayShare: null,
          kwh: null,
          kwhShare: null,
          explanation: "Incomplete-meter days were removed before they could bias the reference pool.",
        },
        {
          label: "EXCLUDED_LEADING_MISSING",
          priorityBand: "Exclusion" as const,
          dayCount: Number(fingerprintDiagnostics.excludedLeadingMissingFingerprintDayCount ?? 0) || 0,
          dayShare: null,
          kwh: null,
          kwhShare: null,
          explanation: "Leading-missing coverage was excluded from trusted fingerprint truth.",
        },
      ].filter((item) => (item.dayCount ?? 0) > 0),
    },
  ];

  const dailyTotalLogic = {
    summary:
      "This layer chooses the day's kWh target first. The shared day selector starts with the narrowest same-month evidence and only falls back toward broader priors when local evidence is weak.",
    ladder: [
      {
        rank: 1,
        key: "month_daytype_neighbor",
        label: "Same-month nearest day-of-month neighbor",
        explanation: "Highest-priority same-month day-type neighbor before the ladder broadens.",
        observedCount: countForKeys(perDayFallbackCounts, ["month_daytype_neighbor"]),
      },
      {
        rank: 2,
        key: "month_daytype",
        label: "Same-month weekday/weekend average",
        explanation: "Same-month day-type average when a strong neighbor is unavailable.",
        observedCount: countForKeys(perDayFallbackCounts, ["month_daytype"]),
      },
      {
        rank: 3,
        key: "adjacent_month_daytype",
        label: "Adjacent-month weekday/weekend average",
        explanation: "Brings in nearby-month seasonality while preserving weekday/weekend structure.",
        observedCount: countForKeys(perDayFallbackCounts, ["adjacent_month_daytype"]),
      },
      {
        rank: 4,
        key: "month_overall",
        label: "Same-month overall average",
        explanation: "Drops day-type specificity but stays inside the current month.",
        observedCount: countForKeys(perDayFallbackCounts, ["month_overall"]),
      },
      {
        rank: 5,
        key: "season_overall",
        label: "Season overall average",
        explanation: "Uses broader seasonal evidence when month-specific history is thin.",
        observedCount: countForKeys(perDayFallbackCounts, ["season_overall"]),
      },
      {
        rank: 6,
        key: "global_daytype",
        label: "Global weekday/weekend average",
        explanation: "Uses global day-type priors once local month/season evidence is exhausted.",
        observedCount: countForKeys(perDayFallbackCounts, ["global_daytype", "global_weekdayweekend"]),
      },
      {
        rank: 7,
        key: "global_overall",
        label: "Global overall average",
        explanation: "Broadest daily-total fallback and the weakest evidence class in the ladder.",
        observedCount: countForKeys(perDayFallbackCounts, ["global_overall"]),
      },
    ],
  };

  const intervalCurveLogic = {
    summary:
      "After the daily target is chosen, the shared shape selector chooses the 96-slot interval profile. It starts with month/day-type/weather buckets and falls back toward flatter shapes only when needed.",
    ladder: [
      {
        rank: 1,
        key: "month_daytype_weather",
        label: "Month + day-type + weather regime",
        explanation: "Most specific shape bucket for timing, ramp, and peak behavior.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["month_weekday_weather_heating", "month_weekday_weather_cooling", "month_weekday_weather_neutral", "month_weekend_weather_heating", "month_weekend_weather_cooling", "month_weekend_weather_neutral"]),
      },
      {
        rank: 2,
        key: "month_daytype",
        label: "Month + day-type",
        explanation: "Keeps month and weekday/weekend structure when weather-specific shape evidence is unavailable.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["month_weekday", "month_weekend"]),
      },
      {
        rank: 3,
        key: "month",
        label: "Month flat shape",
        explanation: "Keeps month seasonality but drops day-type detail.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["month"]),
      },
      {
        rank: 4,
        key: "weekdayweekend_weather",
        label: "Weekday/weekend + weather regime",
        explanation: "Uses broad weekday/weekend weather-aware shapes outside the current month bucket.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["weekdayweekend_weather_weekday_heating", "weekdayweekend_weather_weekday_cooling", "weekdayweekend_weather_weekday_neutral", "weekdayweekend_weather_weekend_heating", "weekdayweekend_weather_weekend_cooling", "weekdayweekend_weather_weekend_neutral"]),
      },
      {
        rank: 5,
        key: "weekdayweekend",
        label: "Weekday/weekend flat shape",
        explanation: "Retains only broad weekday/weekend shape structure.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["weekdayweekend_weekday", "weekdayweekend_weekend"]),
      },
      {
        rank: 6,
        key: "uniform_fallback",
        label: "Uniform fallback",
        explanation: "Flattest possible shape when no stronger bucket exists.",
        observedCount: countForKeys(perDayShapeVariantCounts, ["uniform_fallback"]),
      },
    ],
  };

  const weatherExplanation = {
    summary:
      "Weather does not create the whole day from scratch. The shared simulator first chooses a base daily kWh target, then weather can scale that day total and can also change which weather-regime shape bucket is selected.",
    rows: [
      {
        label: "Weather provenance / mode",
        value: joinNonEmpty([
          String(identityContext.weatherLogicMode ?? sourceContext.weatherLogicMode ?? ""),
          String(sourceTruthContext.weatherDatasetIdentity ?? ""),
          String(sourceTruthContext.weatherSourceIdentity ?? meta.weatherSourceSummary ?? ""),
        ]) || "not attached",
        explanation: "Shows which persisted weather mode and provenance were attached to the artifact.",
      },
      {
        label: "Heating / cooling / neutral counts",
        value: describeCountMap(perDayWeatherModeCounts),
        explanation: "These counts show how often weather pushed the day into heating, cooling, or neutral treatment.",
      },
      {
        label: "Normal vs weather-scaled counts",
        value: describeCountMap({
          normal_day: Number(perDayClassificationCounts.normal_day ?? 0),
          weather_scaled_day: Number(perDayClassificationCounts.weather_scaled_day ?? 0),
        }),
        explanation: "Normal days largely preserve the base-day target. Weather-scaled days adjust that base target toward weather severity.",
      },
      {
        label: "Event-day classifications",
        value: describeCountMap({
          extreme_cold_event_day: Number(perDayClassificationCounts.extreme_cold_event_day ?? 0),
          freeze_protect_day: Number(perDayClassificationCounts.freeze_protect_day ?? 0),
        }),
        explanation: "Extreme cold and freeze-protect classifications reflect stronger event behavior layered after the base day is selected.",
      },
    ],
  };

  const artifactDecisionSummary: CalculationLogicArtifactDecision[] = [
    {
      label: "Trusted fingerprint days",
      value: formatMaybeCount(fingerprintDiagnostics.trustedIntervalFingerprintDayCount),
      explanation: "How much clean source history survived to anchor the reference pool.",
    },
    {
      label: "Travel/vacant excluded",
      value: formatMaybeCount(fingerprintDiagnostics.excludedTravelVacantFingerprintDayCount),
      explanation: "Days excluded from trusted fingerprint truth because of travel/vacant ranges.",
    },
    {
      label: "Incomplete meter excluded",
      value: formatMaybeCount(fingerprintDiagnostics.excludedIncompleteMeterFingerprintDayCount),
      explanation: "Days removed from the trusted pool due to missing or incomplete meter coverage.",
    },
    {
      label: "Validation keep-ref count",
      value: formatMaybeCount(keepRefUtcDateKeyCount),
      explanation: "How many selected validation/test days remained in the reference pool while still producing modeled compare output.",
    },
    {
      label: "Most common daily fallback levels",
      value: describeCountMap(perDayFallbackCounts),
      explanation: "Shows which daily-total fallback levels actually dominated this run.",
    },
    {
      label: "Most common shape variants",
      value: describeCountMap(perDayShapeVariantCounts),
      explanation: "Shows which interval-shape buckets the shared selector used most often.",
    },
    {
      label: "Weather-scaled vs normal days",
      value: describeCountMap({
        normal_day: Number(perDayClassificationCounts.normal_day ?? 0),
        weather_scaled_day: Number(perDayClassificationCounts.weather_scaled_day ?? 0),
        extreme_cold_event_day: Number(perDayClassificationCounts.extreme_cold_event_day ?? 0),
        freeze_protect_day: Number(perDayClassificationCounts.freeze_protect_day ?? 0),
      }),
      explanation: "Operational summary of how weather actually changed day classification in this artifact.",
    },
  ];

  const runImpactSummary: CalculationLogicRunImpactItem[] = [
    {
      label: "Final passthrough-vs-modeled mix",
      value: describeCountMap(
        buildCompositionItems(dailyRows).reduce<Record<string, number>>((acc, item) => {
          acc[item.label] = Number(item.dayCount ?? 0) || 0;
          return acc;
        }, {})
      ),
      explanation:
        modeledFinalDayCount > 0
          ? "This run was materially influenced by modeled day ownership, not just passthrough actual truth."
          : "This run was dominated by passthrough actual truth; modeled influence was minimal.",
    },
    {
      label: "Modeled selected-day ownership",
      value: describeCountMap(
        buildCompositionItems(selectedCompareRows).reduce<Record<string, number>>((acc, item) => {
          acc[item.label] = Number(item.dayCount ?? 0) || 0;
          return acc;
        }, {})
      ),
      explanation:
        selectedCompareRows.length > 0
          ? "These are the ownership categories on the scored/test-day slice used for tuning and compare inspection."
          : "No selected compare-day ownership rows were attached.",
    },
    {
      label: "Dominant daily fallback levels",
      value: describeCountMap(perDayFallbackCounts),
      explanation:
        Object.keys(perDayFallbackCounts).length > 0
          ? "Frequent broad fallbacks indicate weaker local daily evidence."
          : "This artifact did not record observed daily fallbacks.",
    },
    {
      label: "Dominant shape variants",
      value: describeCountMap(perDayShapeVariantCounts),
      explanation:
        Object.keys(perDayShapeVariantCounts).length > 0
          ? "These are the interval-shape buckets that actually shaped modeled days in this run."
          : "No per-day shape variant selections were attached.",
    },
    {
      label: "Profile-input materiality",
      value:
        modeInfo.modeFamily === "profile_only"
          ? "primary synthetic driver"
          : modeledFinalDayCount > 0
            ? "modeled-subset-only context"
            : "mostly passive context",
      explanation:
        modeInfo.modeFamily === "profile_only"
          ? "Home and appliance profiles actively drive the synthetic run."
          : modeledFinalDayCount > 0
            ? "Home/appliance inputs mainly matter on modeled subsets, not passthrough actual days."
            : "This run did not show strong evidence that profile inputs materially changed the final result.",
    },
    {
      label: "Weather materiality",
      value:
        weatherAdjustedDayCount > 0
          ? `${weatherAdjustedDayCount} weather-adjusted or event day(s)`
          : "mostly passive weather context",
      explanation:
        weatherAdjustedDayCount > 0
          ? "Weather moved this run on enough days to matter materially for tuning."
          : "Weather provenance was attached, but attached diagnostics do not show frequent weather-driven changes.",
    },
  ];

  const priorityItems: CalculationLogicPriorityItem[] = [
    ...(modeInfo.modeFamily === "manual_monthly"
      ? [
          {
            label: "Monthly totals",
            priorityBand: "Hard Constraint" as const,
            explanation: "Monthly totals are preserved while daily and interval detail is generated underneath them.",
          },
          {
            label: "Bill-range semantics",
            priorityBand: "Primary Driver" as const,
            explanation: "Statement-range context matters for reconciliation and monthly target interpretation.",
          },
        ]
      : []),
    ...(modeInfo.modeFamily === "manual_annual"
      ? [
          {
            label: "Annual total",
            priorityBand: "Hard Constraint" as const,
            explanation: "The annual kWh total is fixed first, then monthly and daily allocation are derived.",
          },
        ]
      : []),
    ...(modeInfo.modeFamily === "actual_backed"
      ? [
          {
            label: "Actual interval pool",
            priorityBand: "Reference Truth Pool" as const,
            explanation: "Trusted source intervals lead the run and define the baseline evidence pool.",
          },
        ]
      : []),
    {
      label: "Trusted reference-pool quality",
      priorityBand: "Primary Driver",
      explanation:
        "The number and cleanliness of trusted fingerprint days materially affects daily and shape selection quality.",
    },
    {
      label: "Weather logic",
      priorityBand: "Conditional Adjustment",
      explanation: "Weather changes daily totals after the base day is selected and can alter the weather-regime shape bucket.",
    },
    {
      label: "Usage shape profile",
      priorityBand: modeInfo.modeFamily === "actual_backed" ? "Secondary Driver" : "Primary Driver",
      explanation: "Shape buckets determine how the final daily total is spread across 96 intervals.",
    },
    {
      label: "Fallback path frequency",
      priorityBand: "Fallback Only",
      explanation: "More fallback usage means weaker same-month/day-type evidence was available for this run.",
    },
  ];

  const exclusions: CalculationLogicExclusionItem[] = [
    {
      label: "Travel/vacant ranges",
      value: travelRangeList.length > 0 ? `${travelRangeList.length} range(s)` : "none attached",
      effect: "Removed from the trusted pool and modeled through the shared simulator instead of treated as clean reference truth.",
    },
    {
      label: "Incomplete meter days",
      value: formatMaybeCount(fingerprintDiagnostics.excludedIncompleteMeterFingerprintDayCount),
      effect: "Excluded from fingerprint/reference-pool truth so bad meter coverage does not anchor the simulation.",
    },
    {
      label: "Leading missing days",
      value: formatMaybeCount(fingerprintDiagnostics.excludedLeadingMissingFingerprintDayCount),
      effect: "Excluded from trusted reference truth and later filled by the shared simulator path.",
    },
    {
      label: "Validation/test modeled keep-ref logic",
      value: formatMaybeCount(keepRefUtcDateKeyCount),
      effect: "Selected validation/test days can remain in the reference pool while still producing modeled outputs for compare.",
    },
    {
      label: "Observed simulated-reason codes",
      value: describeCountMap(perDayReasonCounts),
      effect: "Shows which day classes were modeled rather than passed straight through from trusted meter truth.",
    },
    {
      label: "Daily source classifications",
      value: describeCountMap(
        Object.fromEntries(
          Object.entries(dailySourceClassificationsSummary).map(([key, value]) => [key, Number(value) || 0])
        )
      ),
      effect: "Explains which source categories dominated the final stitched daily output.",
    },
  ];

  const tuningLevers: CalculationLogicTuningLever[] = [
    ...(modeInfo.modeFamily === "manual_monthly"
      ? [
          {
            label: "Monthly constraint quality",
            priorityBand: "Hard Constraint" as const,
            explanation: "If the monthly totals or seeded statement ranges are off, every downstream daily/interval result is anchored to the wrong monthly target.",
          },
        ]
      : []),
    ...(modeInfo.modeFamily === "manual_annual"
      ? [
          {
            label: "Annual seed quality",
            priorityBand: "Hard Constraint" as const,
            explanation: "The annual total is the top-level anchor; downstream month/day tuning cannot fix a wrong annual input.",
          },
        ]
      : []),
    ...(modeInfo.modeFamily === "actual_backed"
      ? [
          {
            label: "Reference-pool cleanliness",
            priorityBand: "Reference Truth Pool" as const,
            explanation: "Travel, incomplete meter, and leading-missing exclusions materially change how much trusted actual history remains available.",
          },
        ]
      : []),
    {
      label: "Validation/test-day composition",
      priorityBand: "Primary Driver",
      explanation: "Changing the selected validation days changes what gets scored and which keep-ref behaviors are exercised.",
    },
    {
      label: "Weather scaling behavior",
      priorityBand: "Conditional Adjustment",
      explanation: "Heating/cooling regime changes and event-day caps alter daily kWh before interval shape is applied.",
    },
    {
      label: "Shape bucket quality",
      priorityBand: "Primary Driver",
      explanation: "Better month/day-type/weather buckets reduce reliance on flatter fallback shapes and usually move interval-error metrics the most.",
    },
    {
      label: "Fallback frequency",
      priorityBand: "Fallback Only",
      explanation: "When more days fall through to adjacent/global fallbacks, the run is relying more on broad priors and less on strong local evidence.",
    },
  ];

  return {
    selectedMode: selectedMode || lockboxMode || "not attached",
    modeLabel: modeInfo.modeLabel,
    modeFamily: modeInfo.modeFamily,
    modeOverview: modeInfo.modeOverview,
    stageOnePath: modeInfo.stageOnePath,
    stageTwoPath:
      "Shared lockbox -> shared Past producer -> persisted artifact -> read-only GapFill compare/diagnostics view.",
    sharedProducerPathUsed,
    sourceHouseId,
    testHomeId,
    inputGroups,
    layers,
    compositionSections,
    dailyTotalLogic,
    intervalCurveLogic,
    weatherExplanation,
    priorityItems,
    exclusions,
    tuningLevers,
    artifactDecisionSummary,
    runImpactSummary,
    shapeBucketSummaries,
    rawDiagnostics: {
      identityContext,
      sourceTruthContext,
      lockboxExecutionSummary,
      projectionReadSummary,
      tuningSummary,
      lockboxInput,
      perRunTrace,
      compareMetrics,
      sourceTravelRanges: sourceTravelRangeList,
      testHomeTravelRanges: testHomeTravelRangeList,
      effectiveTravelRanges: effectiveTravelRangeList,
      effectiveTravelRangesSource: args.effectiveTravelRangesSource ?? null,
      compositionSections,
      dailyTotalLogic,
      intervalCurveLogic,
      weatherExplanation,
      artifactDecisionSummary,
      runImpactSummary,
      shapeBucketSummaries,
      rawCompareDailyRows,
    },
  };
}
