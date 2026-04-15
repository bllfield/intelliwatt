import {
  buildManualBillPeriodTargets,
  resolveManualStageOnePresentation,
} from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload, ManualStatementRange } from "@/modules/simulatedUsage/types";
import {
  resolveCanonicalUsage365CoverageWindow,
  resolveReportedCoverageWindow,
} from "@/modules/usageSimulator/metadataWindow";

export type OnePathTruthOwner = {
  label: string;
  owner: string;
  whyItMatters: string;
};

export type OnePathTruthSummary = {
  chartWindowDisplay: {
    title: string;
    summary: string;
    currentRun: Record<string, unknown>;
    sharedOwners: OnePathTruthOwner[];
  };
  manualStatementAnnual: {
    title: string;
    summary: string;
    currentRun: Record<string, unknown>;
    sharedOwners: OnePathTruthOwner[];
  };
  controlSurface: {
    title: string;
    summary: string;
    currentRun: Record<string, unknown>;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeStatementRanges(periods: unknown): ManualStatementRange[] {
  return asArray<Record<string, unknown>>(periods)
    .map((row) => ({
      month: String(row.month ?? row.id ?? "").trim(),
      startDate: row.startDate == null ? null : String(row.startDate ?? "").slice(0, 10),
      endDate: String(row.endDate ?? "").slice(0, 10),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && /^\d{4}-\d{2}-\d{2}$/.test(row.endDate));
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toDateKeys(value: unknown): string[] {
  return asArray(value)
    .map((entry) => String(entry ?? "").slice(0, 10))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
}

function buildManualPayload(args: {
  inputType: string | null | undefined;
  engineInput: Record<string, unknown>;
  artifact: Record<string, unknown>;
}): ManualUsagePayload | null {
  const travelRanges = asArray<{ startDate?: unknown; endDate?: unknown }>(args.engineInput.travelRanges).map((range) => ({
    startDate: String(range?.startDate ?? "").slice(0, 10),
    endDate: String(range?.endDate ?? "").slice(0, 10),
  }));
  if (args.inputType === "MANUAL_MONTHLY") {
    const statementRanges = normalizeStatementRanges(args.artifact.manualBillPeriods);
    const totalsById = asRecord(args.artifact.manualBillPeriodTotalsKwhById);
    return {
      mode: "MONTHLY",
      anchorEndDate: String(args.engineInput.anchorEndDate ?? "").slice(0, 10),
      monthlyKwh: statementRanges.map((range) => ({
        month: range.month,
        kwh: toNumberOrNull(totalsById[range.month]) ?? "",
      })),
      statementRanges,
      travelRanges,
      dateSourceMode: typeof args.engineInput.dateSourceMode === "string" ? (args.engineInput.dateSourceMode as any) : undefined,
      billEndDay: toNumberOrNull(args.engineInput.billEndDay) ?? undefined,
    };
  }
  if (args.inputType === "MANUAL_ANNUAL") {
    return {
      mode: "ANNUAL",
      anchorEndDate: String(args.engineInput.anchorEndDate ?? "").slice(0, 10),
      annualKwh: toNumberOrNull(args.engineInput.annualTargetKwh) ?? "",
      travelRanges,
    };
  }
  return null;
}

function pickAdapterNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const family = asRecord(asRecord(snapshot.familyByFamilyResolvedValues).adapterCanonicalInput);
  const resolvedValues = asRecord(family.resolvedValues);
  return toNumberOrNull(resolvedValues[key]);
}

export function buildOnePathTruthSummary(args: {
  inputType: string | null | undefined;
  engineInput: Record<string, unknown>;
  artifact: Record<string, unknown>;
  readModel: Record<string, unknown> | null | undefined;
}): OnePathTruthSummary {
  const dataset = asRecord(args.artifact.dataset);
  const datasetSummary = asRecord(dataset.summary);
  const datasetMeta = asRecord(dataset.meta);
  const runSnapshot = asRecord(args.readModel?.effectiveSimulationVariablesUsed);
  const adapterLagDays = pickAdapterNumber(runSnapshot, "canonicalCoverageLagDays");
  const adapterTotalDays = pickAdapterNumber(runSnapshot, "canonicalCoverageTotalDays");
  const canonicalWindowFromPolicy =
    adapterLagDays != null && adapterTotalDays != null
      ? resolveCanonicalUsage365CoverageWindow(new Date(), {
          canonicalCoverageLagDays: adapterLagDays,
          canonicalCoverageTotalDays: adapterTotalDays,
          manualMonthlyDefaultBillEndDay: 15,
          manualAnnualWindowDays: 365,
          longTermWeatherBaselineStartYear: 1991,
          longTermWeatherBaselineEndYear: 2020,
        })
      : null;
  const reportedWindow = resolveReportedCoverageWindow({
    dataset,
    fallbackStartDate: String(args.engineInput.coverageWindowStart ?? datasetSummary.start ?? ""),
    fallbackEndDate: String(args.engineInput.coverageWindowEnd ?? datasetSummary.end ?? ""),
  });
  const validationOnlyDateKeys = toDateKeys(
    args.engineInput.validationOnlyDateKeysLocal ?? datasetMeta.validationOnlyDateKeysLocal
  );
  const compareProjection = asRecord(args.readModel?.compareProjection);
  const manualPayload = buildManualPayload(args);
  const stageOnePresentation = resolveManualStageOnePresentation({
    surface: "admin_manual_monthly_stage_one",
    payload: manualPayload,
  });
  const manualBillTargets = manualPayload ? buildManualBillPeriodTargets(manualPayload) : [];
  const manualParitySummary = asRecord(args.readModel?.manualParitySummary);

  return {
    chartWindowDisplay: {
      title: "Chart / Window / Display Logic",
      summary:
        "This panel shows the shared owners that decide the canonical coverage window, reported chart window, validation-day masking, and projected display framing.",
      currentRun: {
        actualContextHouseId: String(args.engineInput.actualContextHouseId ?? ""),
        coverageWindowStart: args.engineInput.coverageWindowStart ?? null,
        coverageWindowEnd: args.engineInput.coverageWindowEnd ?? null,
        canonicalMonths: asArray<string>(args.engineInput.canonicalMonths),
        canonicalEndMonth: args.engineInput.canonicalEndMonth ?? null,
        datasetSummaryStart: datasetSummary.start ?? null,
        datasetSummaryEnd: datasetSummary.end ?? null,
        datasetMetaCoverageStart: datasetMeta.coverageStart ?? null,
        datasetMetaCoverageEnd: datasetMeta.coverageEnd ?? null,
        reportedWindowStart: reportedWindow.startDate,
        reportedWindowEnd: reportedWindow.endDate,
        validationSelectionMode: args.engineInput.validationSelectionMode ?? null,
        validationOnlyDateKeys,
        validationOnlyDateKeysCount: validationOnlyDateKeys.length,
        compareProjectionRowsCount: asArray(compareProjection.rows).length,
        sharedAdapterCoverageLagDays: adapterLagDays,
        sharedAdapterCoverageTotalDays: adapterTotalDays,
        currentPolicyCanonicalWindowPreview: canonicalWindowFromPolicy,
      },
      sharedOwners: [
        {
          label: "Canonical coverage owner",
          owner: "resolveCanonicalUsage365CoverageWindow",
          whyItMatters: "Owns the shared today-minus-lag framing used before the canonical producer runs.",
        },
        {
          label: "Reported chart window owner",
          owner: "resolveReportedCoverageWindow",
          whyItMatters: "Keeps summary/chart framing aligned to the shared dataset window instead of page-local date math.",
        },
        {
          label: "Display projection owner",
          owner: "projectBaselineFromCanonicalDataset",
          whyItMatters: "Applies shared validation-day masking and meter-backed display normalization for compare/chart surfaces.",
        },
      ],
    },
    manualStatementAnnual: {
      title: "Manual Statement / Annual Logic",
      summary:
        "This panel surfaces the shared owners that normalize statement ranges, build bill-period targets, and explain how manual monthly or annual inputs become canonical sim inputs.",
      currentRun: {
        inputType: args.inputType ?? null,
        anchorEndDate: args.engineInput.anchorEndDate ?? null,
        billEndDay: args.engineInput.billEndDay ?? null,
        dateSourceMode: args.engineInput.dateSourceMode ?? null,
        statementRangesCount: asArray(args.engineInput.statementRanges).length,
        statementRangesPreview: asArray(args.engineInput.statementRanges).slice(0, 4),
        manualBillPeriodCount: asArray(args.artifact.manualBillPeriods).length,
        manualBillPeriodTotalsKwhById: args.artifact.manualBillPeriodTotalsKwhById ?? {},
        annualTargetKwh: args.engineInput.annualTargetKwh ?? null,
        normalizedMonthTargetsByMonth: args.engineInput.normalizedMonthTargetsByMonth ?? {},
        stageOnePresentation,
        manualBillTargets,
        manualParityStatus: manualParitySummary.status ?? null,
        manualParitySummary,
      },
      sharedOwners: [
        {
          label: "Manual stage-one presentation owner",
          owner: "resolveManualStageOnePresentation",
          whyItMatters: "Explains the shared monthly or annual bill-entry contract before the canonical adapter runs.",
        },
        {
          label: "Bill-period target owner",
          owner: "buildManualBillPeriodTargets",
          whyItMatters: "Determines which manual periods are eligible constraints and why some periods are excluded.",
        },
        {
          label: "Statement normalization owner",
          owner: "deriveStatementRangesFromMonthlyPayload",
          whyItMatters: "Normalizes explicit statements or auto-built statement windows into the same shared monthly contract.",
        },
      ],
    },
    controlSurface: {
      title: "Shared source-of-truth summary",
      summary:
        "These are the thin admin controls that feed the shared adapter path without moving any simulation logic into the page.",
      currentRun: {
        selectedHouseId: args.engineInput.houseId ?? null,
        actualContextHouseId: args.engineInput.actualContextHouseId ?? null,
        validationSelectionMode: args.engineInput.validationSelectionMode ?? null,
        validationOnlyDateKeys,
        validationOnlyDateKeysCount: validationOnlyDateKeys.length,
        travelRangesCount: asArray(args.engineInput.travelRanges).length,
      },
    },
  };
}
