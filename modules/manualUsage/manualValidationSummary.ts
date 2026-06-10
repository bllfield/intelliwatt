import type { ManualBillPeriodCompareRow, ManualUsageReadModel } from "@/modules/manualUsage/readModel";

export const MANUAL_BILL_MATCH_TOLERANCE_KWH = 0.05;

export type BillMatchVerificationStatus = "pass" | "fail" | "partial" | "not_available";
export type BillMatchVerificationSource =
  | "manualBillPeriodSimTotalsById"
  | "legacy_daily_sum"
  | "not_available";

export type BillMatchVerificationRow = {
  periodId: string;
  startDate: string;
  endDate: string;
  enteredKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  status: ManualBillPeriodCompareRow["status"];
  eligible: boolean;
  exclusionReason: "missing_input" | "travel_overlap" | "filled_later" | null;
  parityRequirement: ManualBillPeriodCompareRow["parityRequirement"];
};

export type BillMatchVerificationTotalScope = "eligible_periods_only";

export type BillMatchVerification = {
  status: BillMatchVerificationStatus;
  label: "Bill Match Verification";
  /** Pass/fail totals are summed over eligible bill periods only. */
  totalScope: BillMatchVerificationTotalScope;
  /** Eligible-period entered total used for pass/fail. Same as eligibleEnteredTotalKwh. */
  enteredTotalKwh: number | null;
  /** Eligible-period simulated total used for pass/fail. Same as eligibleSimulatedTotalKwh. */
  simulatedTotalKwh: number | null;
  /** Eligible-period delta used for pass/fail. Same as eligibleDeltaKwh. */
  deltaKwh: number | null;
  allEnteredTotalKwh: number | null;
  eligibleEnteredTotalKwh: number | null;
  excludedEnteredTotalKwh: number | null;
  allSimulatedTotalKwh: number | null;
  eligibleSimulatedTotalKwh: number | null;
  excludedSimulatedTotalKwh: number | null;
  eligibleDeltaKwh: number | null;
  eligiblePeriodCount: number;
  excludedPeriodCount: number;
  reconciledPeriodCount: number;
  exactMatchPeriodCount: number;
  toleranceKwh: number;
  source: BillMatchVerificationSource;
  rows: BillMatchVerificationRow[];
  warnings: string[];
};

export type ManualSimulationConfidenceStatus = "high" | "medium" | "low" | "not_available";
export type ManualSimulationConfidenceBasis =
  | "manual_bills_weather_fit"
  | "smt_interval_truth"
  | "green_button_interval_truth"
  | "actual_source_backed_not_compared"
  | "insufficient_data";

export type ManualSimulationConfidence = {
  status: ManualSimulationConfidenceStatus;
  label: "Simulation Confidence";
  confidenceScore0to100: number | null;
  confidenceTier: string | null;
  basis: ManualSimulationConfidenceBasis;
  intervalAccuracyClaim: "estimated" | "measured";
  userFacingSummary: string;
  adminDiagnostics: {
    modelFitMode: string;
    constrainedCurveUsedForBills: boolean;
    unconstrainedOrHoldoutAvailable: boolean;
    holdoutPeriodCount: number;
    comparedPeriodCount: number;
    monthlyMaeKwh: number | null;
    monthlyMapePercent: number | null;
    wapePercent: number | null;
    weatherFitScore: number | null;
    homeDetailsCompleteness: number | null;
    applianceDetailsCompleteness: number | null;
    shapeFallbackLevel: string | null;
    actualIntervalTruthAvailable: boolean;
    intervalComparisonAvailable: boolean;
    holdoutConfidenceDeferred: boolean;
  };
  warnings: string[];
};

export type ManualIntervalShapeSummary = {
  label: "Interval Shape";
  accuracyClaim: "estimated" | "measured";
  userFacingSummary: string;
};

export type ManualValidationSummary = {
  billMatchVerification: BillMatchVerification;
  manualSimulationConfidence: ManualSimulationConfidence;
  intervalShape: ManualIntervalShapeSummary;
};

function round2(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function exclusionReasonForRow(row: ManualBillPeriodCompareRow): BillMatchVerificationRow["exclusionReason"] {
  if (row.status === "travel_overlap") return "travel_overlap";
  if (row.status === "missing_input") return "missing_input";
  if (row.status === "filled_later") return "filled_later";
  return null;
}

function resolveBillMatchSource(args: {
  artifactMeta: Record<string, unknown>;
  compare: ManualUsageReadModel["billPeriodCompare"];
}): BillMatchVerificationSource {
  const sidecar = args.artifactMeta.manualBillPeriodSimTotalsById;
  if (sidecar && typeof sidecar === "object" && Object.keys(sidecar as Record<string, unknown>).length > 0) {
    return "manualBillPeriodSimTotalsById";
  }
  const hasSimulatedTotals = args.compare.rows.some(
    (row) => row.simulatedStatementTotalKwh != null && row.simulatedStatementTotalKwh > 0
  );
  return hasSimulatedTotals ? "legacy_daily_sum" : "not_available";
}

function sumRowKwh(rows: BillMatchVerificationRow[], pick: (row: BillMatchVerificationRow) => number | null): number | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    const value = pick(row);
    if (value == null || !Number.isFinite(value)) continue;
    sum += value;
    any = true;
  }
  return any ? round2(sum) : null;
}

function mapBillMatchRow(row: ManualBillPeriodCompareRow): BillMatchVerificationRow {
  return {
    periodId: row.month,
    startDate: row.startDate,
    endDate: row.endDate,
    enteredKwh: row.enteredStatementTotalKwh ?? row.stageOneTargetTotalKwh,
    simulatedKwh: row.simulatedStatementTotalKwh,
    deltaKwh: row.deltaKwh,
    status: row.status,
    eligible: row.eligible,
    exclusionReason: exclusionReasonForRow(row),
    parityRequirement: row.parityRequirement,
  };
}

function buildBillMatchVerification(args: {
  manualReadModel: ManualUsageReadModel | null;
  dataset: any;
}): BillMatchVerification {
  const compare = args.manualReadModel?.billPeriodCompare;
  if (!compare) {
    return {
      status: "not_available",
      label: "Bill Match Verification",
      totalScope: "eligible_periods_only",
      enteredTotalKwh: null,
      simulatedTotalKwh: null,
      deltaKwh: null,
      allEnteredTotalKwh: null,
      eligibleEnteredTotalKwh: null,
      excludedEnteredTotalKwh: null,
      allSimulatedTotalKwh: null,
      eligibleSimulatedTotalKwh: null,
      excludedSimulatedTotalKwh: null,
      eligibleDeltaKwh: null,
      eligiblePeriodCount: 0,
      excludedPeriodCount: 0,
      reconciledPeriodCount: 0,
      exactMatchPeriodCount: 0,
      toleranceKwh: MANUAL_BILL_MATCH_TOLERANCE_KWH,
      source: "not_available",
      rows: [],
      warnings: ["Manual bill-period compare data was not available for this read."],
    };
  }

  const meta =
    args.dataset?.meta && typeof args.dataset.meta === "object" ? (args.dataset.meta as Record<string, unknown>) : {};
  const source = resolveBillMatchSource({ artifactMeta: meta, compare });
  const rows = compare.rows.map(mapBillMatchRow);
  const eligibleRows = rows.filter((row) => row.eligible);
  const excludedRows = rows.filter((row) => !row.eligible);
  const allEnteredTotalKwh = sumRowKwh(rows, (row) => row.enteredKwh);
  const eligibleEnteredTotalKwh = sumRowKwh(eligibleRows, (row) => row.enteredKwh);
  const excludedEnteredTotalKwh = sumRowKwh(excludedRows, (row) => row.enteredKwh);
  const allSimulatedTotalKwh = sumRowKwh(rows, (row) => row.simulatedKwh);
  const eligibleSimulatedTotalKwh = sumRowKwh(eligibleRows, (row) => row.simulatedKwh);
  const excludedSimulatedTotalKwh = sumRowKwh(excludedRows, (row) => row.simulatedKwh);
  const eligibleDeltaKwh =
    eligibleEnteredTotalKwh != null && eligibleSimulatedTotalKwh != null
      ? round2(eligibleSimulatedTotalKwh - eligibleEnteredTotalKwh)
      : null;
  const enteredTotalKwh = eligibleEnteredTotalKwh;
  const simulatedTotalKwh = eligibleSimulatedTotalKwh;
  const deltaKwh = eligibleDeltaKwh;
  const exactMatchPeriodCount = eligibleRows.filter((row) => row.status === "reconciled").length;
  const warnings: string[] = [];
  if (source === "legacy_daily_sum") {
    warnings.push(
      "Bill-period simulated totals were derived from legacy daily sums because manualBillPeriodSimTotalsById was not stamped on this artifact."
    );
  }
  if (excludedRows.length > 0) {
    warnings.push(
      "Pass/fail totals use eligible bill periods only. Excluded travel/vacant or missing-input periods remain visible in rows with their entered and simulated kWh."
    );
  }

  let status: BillMatchVerificationStatus = "not_available";
  if (compare.eligibleRangeCount > 0) {
    const allEligibleReconciled =
      compare.reconciledRangeCount === compare.eligibleRangeCount && compare.deltaPresentRangeCount === 0;
    const totalWithinTolerance = deltaKwh == null || Math.abs(deltaKwh) <= MANUAL_BILL_MATCH_TOLERANCE_KWH;
    status = allEligibleReconciled && totalWithinTolerance ? "pass" : "fail";
  } else if (compare.ineligibleRangeCount > 0) {
    status = "partial";
  }

  return {
    status,
    label: "Bill Match Verification",
    totalScope: "eligible_periods_only",
    enteredTotalKwh,
    simulatedTotalKwh,
    deltaKwh,
    allEnteredTotalKwh,
    eligibleEnteredTotalKwh,
    excludedEnteredTotalKwh,
    allSimulatedTotalKwh,
    eligibleSimulatedTotalKwh,
    excludedSimulatedTotalKwh,
    eligibleDeltaKwh,
    eligiblePeriodCount: compare.eligibleRangeCount,
    excludedPeriodCount: compare.ineligibleRangeCount,
    reconciledPeriodCount: compare.reconciledRangeCount,
    exactMatchPeriodCount,
    toleranceKwh: MANUAL_BILL_MATCH_TOLERANCE_KWH,
    source,
    rows,
    warnings,
  };
}

function resolveActualSourceKind(args: {
  actualDataset?: any;
  artifactMeta?: Record<string, unknown>;
}): "SMT" | "Green Button" | null {
  const meta = (args.actualDataset?.meta && typeof args.actualDataset.meta === "object"
    ? args.actualDataset.meta
    : args.artifactMeta ?? {}) as Record<string, unknown>;
  const preferred = String(meta.preferredActualSource ?? meta.source ?? "").toUpperCase();
  if (preferred.includes("GREEN_BUTTON")) return "Green Button";
  if (preferred.includes("SMT")) return "SMT";
  return null;
}

function resolveActualIntervalTruthAvailable(actualDataset?: any): boolean {
  const intervals = Array.isArray(actualDataset?.series?.intervals15) ? actualDataset.series.intervals15 : [];
  if (intervals.length > 0) return true;
  const daily = Array.isArray(actualDataset?.daily) ? actualDataset.daily : [];
  return daily.some((row: { kwh?: unknown }) => Number.isFinite(Number(row.kwh)));
}

function resolveIntervalComparisonAvailable(
  compareProjection?: { rows?: unknown; metrics?: unknown } | null
): boolean {
  const compareRows = Array.isArray(compareProjection?.rows) ? compareProjection.rows : [];
  return compareRows.some((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const record = row as Record<string, unknown>;
    return (
      typeof record.localDate === "string" &&
      Number.isFinite(Number(record.actualDayKwh)) &&
      Number.isFinite(Number(record.simulatedDayKwh))
    );
  });
}

function resolveConfidenceBasis(args: {
  inputType?: string | null;
  actualIntervalTruthAvailable: boolean;
  intervalComparisonAvailable: boolean;
  measuredSourceLabel: "SMT" | "Green Button" | null;
}): ManualSimulationConfidenceBasis {
  const inputType = String(args.inputType ?? "").trim().toUpperCase();
  if (inputType === "MANUAL_MONTHLY" || inputType === "MANUAL_ANNUAL") {
    return "manual_bills_weather_fit";
  }
  if (args.intervalComparisonAvailable && args.actualIntervalTruthAvailable) {
    if (args.measuredSourceLabel === "Green Button") return "green_button_interval_truth";
    return "smt_interval_truth";
  }
  if (args.actualIntervalTruthAvailable) {
    return "actual_source_backed_not_compared";
  }
  if (inputType.includes("SOURCE_INTERVAL")) {
    return "manual_bills_weather_fit";
  }
  return "insufficient_data";
}

const MANUAL_ESTIMATED_CONFIDENCE_COPY =
  "Your bill totals were matched. The 15-minute timing is estimated from your bills, home details, weather, and our usage-shape model. Connect Smart Meter Texas or upload Green Button data to verify actual interval behavior.";

function buildManualSimulationConfidence(args: {
  billMatch: BillMatchVerification;
  actualDataset?: any;
  compareProjection?: { rows?: unknown; metrics?: unknown } | null;
  inputType?: string | null;
  artifactMeta?: Record<string, unknown>;
  includeAdminMetrics?: boolean;
}): ManualSimulationConfidence {
  const actualIntervalTruthAvailable = resolveActualIntervalTruthAvailable(args.actualDataset);
  const intervalComparisonAvailable = resolveIntervalComparisonAvailable(args.compareProjection);
  const measuredSourceLabel = resolveActualSourceKind({
    actualDataset: args.actualDataset,
    artifactMeta: args.artifactMeta,
  });
  const basis = resolveConfidenceBasis({
    inputType: args.inputType,
    actualIntervalTruthAvailable,
    intervalComparisonAvailable,
    measuredSourceLabel,
  });
  const intervalAccuracyClaim: "estimated" | "measured" =
    intervalComparisonAvailable && actualIntervalTruthAvailable ? "measured" : "estimated";
  const metrics =
    args.compareProjection?.metrics && typeof args.compareProjection.metrics === "object"
      ? (args.compareProjection.metrics as Record<string, unknown>)
      : {};
  const compareRows = Array.isArray(args.compareProjection?.rows) ? args.compareProjection.rows : [];
  const wapePercent =
    args.includeAdminMetrics &&
    intervalComparisonAvailable &&
    typeof metrics.wape === "number" &&
    Number.isFinite(metrics.wape)
      ? Number(metrics.wape)
      : null;

  let status: ManualSimulationConfidenceStatus = "not_available";
  let confidenceTier: string | null = null;
  let userFacingSummary =
    "Simulation confidence is not available yet because unconstrained holdout diagnostics are deferred for this manual path.";
  const warnings: string[] = [];

  if (intervalAccuracyClaim === "measured") {
    status = wapePercent != null && wapePercent <= 15 ? "high" : wapePercent != null && wapePercent <= 25 ? "medium" : "medium";
    confidenceTier = "actual_interval_measured";
    userFacingSummary = `Actual ${measuredSourceLabel ?? "interval"} data is being compared to the simulated curve on held-out days. This reflects measured interval behavior, not bill-match alone.`;
  } else if (basis === "manual_bills_weather_fit") {
    if (args.billMatch.status === "pass") {
      status = "medium";
      confidenceTier = "constrained_bill_match";
    } else if (args.billMatch.status === "fail") {
      status = "low";
      confidenceTier = "constrained_bill_match";
    } else {
      status = "not_available";
      confidenceTier = "constrained_bill_match";
    }
    userFacingSummary = MANUAL_ESTIMATED_CONFIDENCE_COPY;
    warnings.push("Unconstrained bill-period holdout confidence is deferred; this is not a measured interval-accuracy claim.");
  } else if (basis === "actual_source_backed_not_compared") {
    status = "medium";
    confidenceTier = "actual_source_backed_not_compared";
    userFacingSummary = `Actual ${measuredSourceLabel ?? "interval"} data is attached, but interval timing has not been compared yet. ${MANUAL_ESTIMATED_CONFIDENCE_COPY}`;
    warnings.push("Actual interval truth is present, but no actual-vs-simulated compare rows were attached for this read.");
  } else {
    warnings.push("Insufficient manual or actual-source inputs to estimate simulation confidence.");
  }

  return {
    status,
    label: "Simulation Confidence",
    confidenceScore0to100: null,
    confidenceTier,
    basis,
    intervalAccuracyClaim,
    userFacingSummary,
    adminDiagnostics: {
      modelFitMode:
        intervalAccuracyClaim === "measured"
          ? "actual_interval_measured"
          : basis === "actual_source_backed_not_compared"
            ? "actual_source_backed_not_compared"
            : "constrained_bill_match",
      constrainedCurveUsedForBills: true,
      unconstrainedOrHoldoutAvailable: false,
      holdoutPeriodCount: 0,
      comparedPeriodCount: compareRows.length,
      monthlyMaeKwh: null,
      monthlyMapePercent: null,
      wapePercent,
      weatherFitScore: null,
      homeDetailsCompleteness: null,
      applianceDetailsCompleteness: null,
      shapeFallbackLevel: intervalAccuracyClaim === "measured" ? null : "manual_bill_inferred_shape",
      actualIntervalTruthAvailable,
      intervalComparisonAvailable,
      holdoutConfidenceDeferred: true,
    },
    warnings,
  };
}

function buildIntervalShapeSummary(args: {
  intervalAccuracyClaim: "estimated" | "measured";
  measuredSourceLabel: "SMT" | "Green Button" | null;
  actualSourceAttachedButNotCompared: boolean;
}): ManualIntervalShapeSummary {
  if (args.intervalAccuracyClaim === "measured") {
    return {
      label: "Interval Shape",
      accuracyClaim: "measured",
      userFacingSummary: `Measured from ${args.measuredSourceLabel ?? "actual interval"} compare data.`,
    };
  }
  if (args.actualSourceAttachedButNotCompared) {
    return {
      label: "Interval Shape",
      accuracyClaim: "estimated",
      userFacingSummary: `Estimated from manual bills. Actual ${args.measuredSourceLabel ?? "interval"} data is attached but not yet compared for interval timing.`,
    };
  }
  return {
    label: "Interval Shape",
    accuracyClaim: "estimated",
    userFacingSummary: "Estimated from manual bills.",
  };
}

export function buildManualValidationSummary(args: {
  manualReadModel: ManualUsageReadModel | null;
  dataset: any;
  artifactMeta?: Record<string, unknown> | null;
  inputType?: string | null;
  actualComparison?: any;
  compareProjection?: { rows?: unknown; metrics?: unknown } | null;
  includeAdminMetrics?: boolean;
}): ManualValidationSummary | null {
  if (!args.manualReadModel) return null;
  const artifactMeta =
    args.artifactMeta ??
    (args.dataset?.meta && typeof args.dataset.meta === "object"
      ? (args.dataset.meta as Record<string, unknown>)
      : {});
  const billMatchVerification = buildBillMatchVerification({
    manualReadModel: args.manualReadModel,
    dataset: args.dataset,
  });
  const manualSimulationConfidence = buildManualSimulationConfidence({
    billMatch: billMatchVerification,
    actualDataset: args.actualComparison,
    compareProjection: args.compareProjection,
    inputType: args.inputType,
    artifactMeta,
    includeAdminMetrics: args.includeAdminMetrics ?? false,
  });
  const intervalShape = buildIntervalShapeSummary({
    intervalAccuracyClaim: manualSimulationConfidence.intervalAccuracyClaim,
    measuredSourceLabel: resolveActualSourceKind({
      actualDataset: args.actualComparison,
      artifactMeta,
    }),
    actualSourceAttachedButNotCompared:
      manualSimulationConfidence.basis === "actual_source_backed_not_compared",
  });
  return {
    billMatchVerification,
    manualSimulationConfidence,
    intervalShape,
  };
}
