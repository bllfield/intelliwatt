import { sha256DigestBase64Url } from "@/lib/crypto/sha256Base64Url";
import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";
import {
  computeValidationDayPolicyHash,
  resolveActiveValidationDayPolicyLive,
} from "@/lib/usage/validationDayPolicy";
import { resolveGapfillSyntheticAnchorEndDate } from "@/modules/manualUsage/prefill";
import {
  buildManualUsageStageOneResolvedSeeds,
  deriveAnnualSeed,
  deriveMonthlySeedFromActual,
} from "@/modules/manualUsage/prefill";
import {
  resolveManualGapfillSmtSourceContext,
  type ManualGapfillSourceContext,
} from "@/modules/manualUsage/manualGapfillSourceContext";
import { saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import type {
  AnnualManualUsagePayload,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
} from "@/modules/simulatedUsage/types";
import { stableStringify } from "@/modules/usageSimulator/fingerprintHash";

export function hashManualGapfillSavedSeedPayload(payload: ManualUsagePayload): string {
  return sha256DigestBase64Url(stableStringify(payload), 22);
}

export type ManualGapfillSeedMode = "MONTHLY_FROM_SOURCE_INTERVALS" | "ANNUAL_FROM_SOURCE_INTERVALS";

export type ManualGapfillSeedStatus =
  | "ready"
  | "missing_source_truth"
  | "insufficient_source_truth"
  | "invalid_seed"
  | "persisted";

export type ResolveManualGapfillSeedFromSourceContextArgs = {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  esiid?: string | null;
  mode: ManualGapfillSeedMode;
  window?: { startDate: string; endDate: string } | null;
  anchorEndDate?: string | null;
  persistToLabHome?: boolean;
  includeDiagnostics?: boolean;
  /** Test-only escape hatch; production/admin routes must leave this false. */
  allowSameHousePersist?: boolean;
};

export type ManualGapfillSeedPayloadView = {
  manualUsageMode: "manual_monthly" | "manual_annual";
  anchorEndDate: string | null;
  statementRanges?: MonthlyManualUsagePayload["statementRanges"];
  monthlyTotalsKwhByMonth?: Record<string, number>;
  annualTotalKwh?: number | null;
  totalKwh: number | null;
  billPeriodCount?: number | null;
  normalizedPayloadHash?: string | null;
  billPeriodHash?: string | null;
  validationResultHash?: string | null;
};

export type ManualGapfillSeedResult = {
  ok: boolean;
  status: ManualGapfillSeedStatus;
  mode: ManualGapfillSeedMode;
  sourceContext: {
    sourceHouseId: string;
    actualSourceKind: string;
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalFingerprint: string | null;
    dailyFingerprint: string | null;
    monthlyFingerprint: string | null;
    annualTotalKwh: number | null;
    validationDayPolicyRevision: string;
    validationDayPolicyHash: string;
  };
  labContext: {
    labHouseId: string;
    wroteManualPayload: boolean;
    writeTarget: "lab_home_only" | "none";
  };
  seed: ManualGapfillSeedPayloadView | null;
  diagnostics: {
    usedSourceActualTruth: boolean;
    usedTestHomeAsTruth: false;
    sourceCoverageSufficient: boolean;
    localGapFillSelectorUsed: false;
    globalValidationPolicyUsed: true;
    pastSimRecalcDispatched: false;
    compareRun: false;
    persistRequested: boolean;
    sourceHouseId: string;
    labHouseId: string;
    sourceIntervalFingerprint: string | null;
    globalValidationPolicyHash: string;
    seedPayloadHash: string | null;
    warnings: string[];
  };
  payload?: ManualUsagePayload | null;
};

function mapSourceContextBlock(
  source: ManualGapfillSourceContext,
  policyHash: string
): ManualGapfillSeedResult["sourceContext"] {
  return {
    sourceHouseId: source.sourceHouseId,
    actualSourceKind: source.actualSourceKind,
    coverageStart: source.coverage.coverageStart,
    coverageEnd: source.coverage.coverageEnd,
    intervalFingerprint: source.fingerprints.intervalFingerprint,
    dailyFingerprint: source.fingerprints.dailyFingerprint,
    monthlyFingerprint: source.fingerprints.monthlyFingerprint,
    annualTotalKwh: source.actualData.annualTotal,
    validationDayPolicyRevision: source.validation.activeValidationDayPolicyRevision,
    validationDayPolicyHash: policyHash,
  };
}

function hashValidationResult(parsed: { ok: boolean; error?: string }): string {
  return sha256DigestBase64Url(
    JSON.stringify({ ok: parsed.ok, error: "error" in parsed ? parsed.error : null }),
    16
  );
}

function buildSeedView(args: {
  payload: ManualUsagePayload;
  parsed: { ok: true; value: ManualUsagePayload } | { ok: false; error: string };
}): ManualGapfillSeedPayloadView {
  const validationResultHash = hashValidationResult(args.parsed);
  const normalizedPayloadHash = hashManualGapfillSavedSeedPayload(args.payload);

  if (args.payload.mode === "MONTHLY") {
    const monthly = args.payload as MonthlyManualUsagePayload;
    const monthlyTotalsKwhByMonth = Object.fromEntries(
      (monthly.monthlyKwh ?? []).map((row) => [String(row.month).slice(0, 7), Number(row.kwh) || 0])
    );
    const totalKwh = round2(
      Object.values(monthlyTotalsKwhByMonth).reduce((sum, value) => sum + value, 0)
    );
    return {
      manualUsageMode: "manual_monthly",
      anchorEndDate: monthly.anchorEndDate ?? null,
      statementRanges: monthly.statementRanges,
      monthlyTotalsKwhByMonth,
      annualTotalKwh: null,
      totalKwh,
      billPeriodCount: monthly.statementRanges?.length ?? monthly.monthlyKwh?.length ?? null,
      normalizedPayloadHash,
      billPeriodHash: sha256DigestBase64Url(stableStringify(monthly.statementRanges ?? []), 22),
      validationResultHash,
    };
  }

  const annual = args.payload as AnnualManualUsagePayload;
  const annualKwh =
    typeof annual.annualKwh === "number" && Number.isFinite(annual.annualKwh) ? annual.annualKwh : null;
  return {
    manualUsageMode: "manual_annual",
    anchorEndDate: annual.anchorEndDate ?? null,
    annualTotalKwh: annualKwh,
    totalKwh: annualKwh,
    billPeriodCount: null,
    normalizedPayloadHash,
    billPeriodHash: null,
    validationResultHash,
  };
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function resolveStageOneMode(mode: ManualGapfillSeedMode): "MONTHLY" | "ANNUAL" {
  return mode === "MONTHLY_FROM_SOURCE_INTERVALS" ? "MONTHLY" : "ANNUAL";
}

function buildFailureResult(args: {
  status: Exclude<ManualGapfillSeedStatus, "ready" | "persisted">;
  mode: ManualGapfillSeedMode;
  source: ManualGapfillSourceContext | null;
  policyHash: string;
  labHouseId: string;
  sourceHouseId: string;
  persistRequested: boolean;
  warnings: string[];
  sourceCoverageSufficient?: boolean;
}): ManualGapfillSeedResult {
  return {
    ok: false,
    status: args.status,
    mode: args.mode,
    sourceContext: args.source
      ? mapSourceContextBlock(args.source, args.policyHash)
      : {
          sourceHouseId: args.sourceHouseId,
          actualSourceKind: "missing",
          coverageStart: null,
          coverageEnd: null,
          intervalFingerprint: null,
          dailyFingerprint: null,
          monthlyFingerprint: null,
          annualTotalKwh: null,
          validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
          validationDayPolicyHash: args.policyHash,
        },
    labContext: {
      labHouseId: args.labHouseId,
      wroteManualPayload: false,
      writeTarget: "none",
    },
    seed: null,
    payload: null,
    diagnostics: {
      usedSourceActualTruth: Boolean(args.source?.diagnostics.actualDatasetFound),
      usedTestHomeAsTruth: false,
      sourceCoverageSufficient: args.sourceCoverageSufficient ?? false,
      localGapFillSelectorUsed: false,
      globalValidationPolicyUsed: true,
      pastSimRecalcDispatched: false,
      compareRun: false,
      persistRequested: args.persistRequested,
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.labHouseId,
      sourceIntervalFingerprint: args.source?.fingerprints.intervalFingerprint ?? null,
      globalValidationPolicyHash: args.policyHash,
      seedPayloadHash: null,
      warnings: args.warnings,
    },
  };
}

export function buildManualGapfillMonthlySeedFromSourceContext(args: {
  sourceContext: ManualGapfillSourceContext;
  anchorEndDate: string;
  travelRanges?: [];
}): MonthlyManualUsagePayload | null {
  const dailyRows = args.sourceContext.actualData.dailyTotals ?? [];
  return deriveMonthlySeedFromActual({
    anchorEndDate: args.anchorEndDate,
    sourcePayload: null,
    travelRanges: args.travelRanges ?? [],
    dailyRows,
  });
}

export function buildManualGapfillAnnualSeedFromSourceContext(args: {
  sourceContext: ManualGapfillSourceContext;
  anchorEndDate: string;
  monthlySeed?: MonthlyManualUsagePayload | null;
  travelRanges?: [];
}): AnnualManualUsagePayload | null {
  const dailyRows = args.sourceContext.actualData.dailyTotals ?? [];
  return deriveAnnualSeed({
    anchorEndDate: args.anchorEndDate,
    sourcePayload: null,
    travelRanges: args.travelRanges ?? [],
    dailyRows,
    monthlySeed: args.monthlySeed ?? null,
  });
}

export async function resolveManualGapfillSeedFromSourceContext(
  args: ResolveManualGapfillSeedFromSourceContextArgs
): Promise<ManualGapfillSeedResult> {
  const userId = String(args.userId ?? "").trim();
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const labHouseId = String(args.labHouseId ?? "").trim();
  const mode = args.mode;
  const persistRequested = args.persistToLabHome === true;
  const warnings: string[] = [];
  const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "admin_lab" });
  const policyHash = computeValidationDayPolicyHash(activePolicy);

  if (!userId || !sourceHouseId || !labHouseId) {
    return buildFailureResult({
      status: "invalid_seed",
      mode,
      source: null,
      policyHash,
      labHouseId: labHouseId || "missing",
      sourceHouseId: sourceHouseId || "missing",
      persistRequested,
      warnings: ["userId, sourceHouseId, and labHouseId are required."],
    });
  }

  if (persistRequested && labHouseId === sourceHouseId && !args.allowSameHousePersist) {
    return buildFailureResult({
      status: "invalid_seed",
      mode,
      source: null,
      policyHash,
      labHouseId,
      sourceHouseId,
      persistRequested,
      warnings: ["persistToLabHome rejected: labHouseId must differ from sourceHouseId."],
    });
  }

  const sourceContext = await resolveManualGapfillSmtSourceContext({
    sourceHouseId,
    userId,
    esiid: args.esiid ?? null,
    window: args.window ?? null,
    includeDiagnostics: true,
  });

  if (sourceContext.status === "missing" || sourceContext.actualSourceKind === "missing") {
    return buildFailureResult({
      status: "missing_source_truth",
      mode,
      source: sourceContext,
      policyHash,
      labHouseId,
      sourceHouseId,
      persistRequested,
      warnings: [...warnings, ...sourceContext.diagnostics.warnings],
      sourceCoverageSufficient: false,
    });
  }

  if (
    sourceContext.status === "insufficient" ||
    sourceContext.status === "ambiguous" ||
    !sourceContext.diagnostics.sourceCoverageSufficient
  ) {
    return buildFailureResult({
      status: "insufficient_source_truth",
      mode,
      source: sourceContext,
      policyHash,
      labHouseId,
      sourceHouseId,
      persistRequested,
      warnings: [...warnings, ...sourceContext.diagnostics.warnings],
      sourceCoverageSufficient: false,
    });
  }

  const anchorEndDate =
    (args.anchorEndDate && /^\d{4}-\d{2}-\d{2}$/.test(args.anchorEndDate.slice(0, 10))
      ? args.anchorEndDate.slice(0, 10)
      : null) ??
    sourceContext.coverage.coverageEnd ??
    resolveGapfillSyntheticAnchorEndDate(sourceContext.coverage.latestDate);

  const stageOneMode = resolveStageOneMode(mode);
  const seedSet = buildManualUsageStageOneResolvedSeeds({
    sourcePayload: null,
    actualEndDate: anchorEndDate,
    travelRanges: [],
    dailyRows: sourceContext.actualData.dailyTotals ?? [],
  });

  const payload: ManualUsagePayload | null =
    stageOneMode === "MONTHLY"
      ? buildManualGapfillMonthlySeedFromSourceContext({ sourceContext, anchorEndDate })
      : buildManualGapfillAnnualSeedFromSourceContext({
          sourceContext,
          anchorEndDate,
          monthlySeed: seedSet.monthlySeed,
        });

  if (!payload) {
    return buildFailureResult({
      status: "invalid_seed",
      mode,
      source: sourceContext,
      policyHash,
      labHouseId,
      sourceHouseId,
      persistRequested,
      warnings: [...warnings, "Could not derive manual seed payload from source actual truth."],
      sourceCoverageSufficient: true,
    });
  }

  const parsed = validateManualUsagePayload(payload);
  if (!parsed.ok) {
    return buildFailureResult({
      status: "invalid_seed",
      mode,
      source: sourceContext,
      policyHash,
      labHouseId,
      sourceHouseId,
      persistRequested,
      warnings: [...warnings, `Seed validation failed: ${parsed.error}`],
      sourceCoverageSufficient: true,
    });
  }

  const seedView = buildSeedView({ payload: parsed.value, parsed });
  let wroteManualPayload = false;
  let writeTarget: "lab_home_only" | "none" = "none";
  let status: ManualGapfillSeedStatus = "ready";

  if (persistRequested) {
    const saved = await saveManualUsageInputForUserHouse({
      userId,
      houseId: labHouseId,
      payload: parsed.value,
    });
    if (!saved.ok) {
      return buildFailureResult({
        status: "invalid_seed",
        mode,
        source: sourceContext,
        policyHash,
        labHouseId,
        sourceHouseId,
        persistRequested,
        warnings: [...warnings, `Lab home persist failed: ${saved.error}`],
        sourceCoverageSufficient: true,
      });
    }
    wroteManualPayload = true;
    writeTarget = "lab_home_only";
    status = "persisted";
  }

  return {
    ok: true,
    status,
    mode,
    sourceContext: mapSourceContextBlock(sourceContext, policyHash),
    labContext: {
      labHouseId,
      wroteManualPayload,
      writeTarget,
    },
    seed: seedView,
    payload: args.includeDiagnostics ? parsed.value : null,
    diagnostics: {
      usedSourceActualTruth: true,
      usedTestHomeAsTruth: false,
      sourceCoverageSufficient: true,
      localGapFillSelectorUsed: false,
      globalValidationPolicyUsed: true,
      pastSimRecalcDispatched: false,
      compareRun: false,
      persistRequested,
      sourceHouseId,
      labHouseId,
      sourceIntervalFingerprint: sourceContext.fingerprints.intervalFingerprint,
      globalValidationPolicyHash: policyHash,
      seedPayloadHash: seedView.normalizedPayloadHash ?? null,
      warnings,
    },
  };
}
