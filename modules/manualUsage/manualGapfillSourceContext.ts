import { prisma } from "@/lib/db";
import {
  getIntervalDataFingerprint,
  type ActualHouseDataset,
  type UsageSummary,
} from "@/lib/usage/actualDatasetForHouse";
import {
  CANONICAL_COVERAGE_TOTAL_DAYS,
} from "@/lib/usage/canonicalCoverageConfig";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import { resolveHouseCommittedUsageSource } from "@/lib/usage/houseCommittedUsageSource";
import {
  computeValidationDayPolicyHash,
  previewGlobalValidationDaySelection,
  resolveActiveValidationDayPolicyLive,
  VALIDATION_DAY_POLICY_LAYER,
} from "@/lib/usage/validationDayPolicy";
import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";
import { readPastValidationPolicyRevisionFromMeta } from "@/lib/usage/pastSimulationCoreLabel";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";
import { getLatestUsageFingerprintByHouseId } from "@/modules/usageSimulator/fingerprintArtifactsRepo";
import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";
import { computeUsageFingerprintSourceHash } from "@/modules/usageSimulator/usageFingerprintBuilder";
import { resolveOnePathUpstreamUsageTruthForSimulation } from "@/modules/onePathSim/runtime";
import type { UpstreamUsageTruthSource } from "@/modules/onePathSim/upstreamUsageTruth";
import { computePastWeatherIdentity } from "@/modules/weather/identity";

export const MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER =
  "resolveOnePathUpstreamUsageTruthForSimulation" as const;

export async function loadManualGapfillSourceActualDataset(args: {
  userId: string;
  sourceHouseId: string;
  esiid?: string | null;
  preferredActualSource?: ActualUsageSource | null;
}): Promise<{
  dataset: ActualHouseDataset | null;
  alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null };
  usageTruthSource: UpstreamUsageTruthSource | null;
  actualContextHouseId: string;
  onePathUpstreamOwner: typeof MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER;
}> {
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  const upstream = await resolveOnePathUpstreamUsageTruthForSimulation({
    userId,
    houseId: sourceHouseId,
    actualContextHouseId: sourceHouseId,
    smtSourceEsiid: args.esiid ?? null,
    seedIfMissing: false,
    preferredActualSource: args.preferredActualSource ?? null,
    skipLightweightInsightRecompute: true,
  }).catch(() => null);

  return {
    dataset: (upstream?.dataset as ActualHouseDataset | null) ?? null,
    alternatives: {
      smt: (upstream?.alternatives?.smt as UsageSummary | null) ?? null,
      greenButton: (upstream?.alternatives?.greenButton as UsageSummary | null) ?? null,
    },
    usageTruthSource: upstream?.usageTruthSource ?? null,
    actualContextHouseId: upstream?.actualContextHouse?.id ?? sourceHouseId,
    onePathUpstreamOwner: MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER,
  };
}

export type ManualGapfillSourceContextStatus = "available" | "missing" | "insufficient" | "ambiguous";

export type ManualGapfillActualSourceKind = "SMT" | "GREEN_BUTTON" | "missing" | "ambiguous";

export type ManualGapfillSourceContextDiagnostics = {
  lookedForActualDataset: boolean;
  actualDatasetFound: boolean;
  actualIntervalsFound: boolean;
  sourceCoverageSufficient: boolean;
  committedSourceResolved: boolean;
  healAttempted: boolean;
  healSkippedReason: string | null;
  warnings: string[];
};

export type ManualGapfillSourceContextCoverage = {
  coverageStart: string | null;
  coverageEnd: string | null;
  latestDate: string | null;
  dailyCount: number;
  intervalCount: number;
  monthlyCount: number;
  fullYearAvailable: boolean;
  windowStart: string;
  windowEnd: string;
};

export type ManualGapfillSourceContextFingerprints = {
  intervalFingerprint: string | null;
  dailyFingerprint: string | null;
  monthlyFingerprint: string | null;
  weatherIdentity: string | null;
  usageShapeIdentity: string | null;
};

export type ManualGapfillSourceContextActualData = {
  actualDatasetSummary: {
    source: ActualUsageSource | null;
    totalKwh: number;
    start: string | null;
    end: string | null;
    latest: string | null;
    intervalsCount: number;
  } | null;
  dailyTotals: Array<{ date: string; kwh: number }> | null;
  monthlyTotals: Array<{ month: string; kwh: number }> | null;
  annualTotal: number | null;
};

export type ManualGapfillSourceContextValidation = {
  canonicalPastValidationPolicyRevision: string;
  activeValidationDayPolicyRevision: string;
  activeValidationDayPolicyLayer: string;
  activeValidationDayPolicyHash: string;
  policyPreviewSelectionMode: string | null;
  selectedValidationDateKeys: string[] | null;
  stampedPastValidationPolicyRevision: string | null;
  stampedValidationDateKeys: string[] | null;
  validationSelectionMode: string | null;
  localValidationSelectorRan: false;
};

export type ManualGapfillSourceContext = {
  status: ManualGapfillSourceContextStatus;
  sourceHouseId: string;
  userId: string;
  esiid: string | null;
  committedUsageSource: ActualUsageSource | null;
  actualSource: ActualUsageSource | null;
  sourceOwner: typeof MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER | "none";
  onePathUpstream: {
    owner: typeof MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER;
    usageTruthSource: UpstreamUsageTruthSource | null;
    actualContextHouseId: string;
  };
  actualSourceKind: ManualGapfillActualSourceKind;
  coverage: ManualGapfillSourceContextCoverage;
  fingerprints: ManualGapfillSourceContextFingerprints;
  actualData: ManualGapfillSourceContextActualData;
  validation: ManualGapfillSourceContextValidation;
  alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null };
  diagnostics: ManualGapfillSourceContextDiagnostics;
};

export type ResolveManualGapfillSmtSourceContextArgs = {
  sourceHouseId: string;
  userId: string;
  esiid?: string | null;
  window?: { startDate: string; endDate: string } | null;
  includeDiagnostics?: boolean;
};

const SOURCE_OWNER = MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER;

function normalizeDateKey(value: unknown): string | null {
  const key = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function hashTotalsFingerprint(rows: ReadonlyArray<Record<string, unknown>>): string | null {
  if (!rows.length) return null;
  return sha256HexUtf8(stableStringify(rows));
}

function summarizeActualDataset(dataset: ActualHouseDataset | null | undefined) {
  if (!dataset?.summary) return null;
  return {
    source: dataset.summary.source ?? null,
    totalKwh: Number(dataset.summary.totalKwh) || 0,
    start: dataset.summary.start ?? null,
    end: dataset.summary.end ?? null,
    latest: dataset.summary.latest ?? null,
    intervalsCount: Number(dataset.summary.intervalsCount) || 0,
  };
}

function resolveActualSourceKind(args: {
  committedUsageSource: ActualUsageSource | null;
  actualSource: ActualUsageSource | null;
  alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null };
}): ManualGapfillActualSourceKind {
  const smtAvailable = Boolean(args.alternatives.smt?.intervalsCount);
  const gbAvailable = Boolean(args.alternatives.greenButton?.intervalsCount);
  if (args.actualSource === "SMT" || args.actualSource === "GREEN_BUTTON") return args.actualSource;
  if (args.committedUsageSource === "SMT" || args.committedUsageSource === "GREEN_BUTTON") {
    return args.committedUsageSource;
  }
  if (smtAvailable && gbAvailable) return "ambiguous";
  if (smtAvailable) return "SMT";
  if (gbAvailable) return "GREEN_BUTTON";
  return "missing";
}

function resolveStatus(args: {
  houseFound: boolean;
  actualSourceKind: ManualGapfillActualSourceKind;
  sourceCoverageSufficient: boolean;
}): ManualGapfillSourceContextStatus {
  if (!args.houseFound) return "missing";
  if (args.actualSourceKind === "ambiguous") return "ambiguous";
  if (args.actualSourceKind === "missing") return "missing";
  if (!args.sourceCoverageSufficient) return "insufficient";
  return "available";
}

async function readStampedValidationContext(args: {
  userId: string;
  sourceHouseId: string;
}): Promise<{
  stampedPastValidationPolicyRevision: string | null;
  stampedValidationDateKeys: string[] | null;
  validationSelectionMode: string | null;
}> {
  const build = await prisma.usageSimulatorBuild
    .findFirst({
      where: { userId: args.userId, houseId: args.sourceHouseId },
      orderBy: { updatedAt: "desc" },
      select: { buildInputs: true },
    })
    .catch(() => null);
  const buildInputs =
    build?.buildInputs && typeof build.buildInputs === "object" && !Array.isArray(build.buildInputs)
      ? (build.buildInputs as Record<string, unknown>)
      : null;
  const rawKeys = Array.isArray(buildInputs?.validationOnlyDateKeysLocal)
    ? (buildInputs!.validationOnlyDateKeysLocal as unknown[])
    : [];
  const stampedValidationDateKeys = rawKeys
    .map((value) => normalizeDateKey(value))
    .filter((value): value is string => Boolean(value));
  return {
    stampedPastValidationPolicyRevision: readPastValidationPolicyRevisionFromMeta(buildInputs),
    stampedValidationDateKeys: stampedValidationDateKeys.length ? stampedValidationDateKeys.sort() : null,
    validationSelectionMode:
      typeof buildInputs?.validationSelectionMode === "string" ? buildInputs.validationSelectionMode : null,
  };
}

async function buildGlobalValidationContext(args: {
  stampedValidation: Awaited<ReturnType<typeof readStampedValidationContext>>;
  policyPreview: Awaited<ReturnType<typeof previewGlobalValidationDaySelection>> | null;
}): Promise<ManualGapfillSourceContextValidation> {
  const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "admin_lab" });
  return {
    canonicalPastValidationPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
    activeValidationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
    activeValidationDayPolicyLayer: VALIDATION_DAY_POLICY_LAYER,
    activeValidationDayPolicyHash:
      args.policyPreview?.policyHash ?? computeValidationDayPolicyHash(activePolicy),
    policyPreviewSelectionMode: args.policyPreview?.selectionMode ?? activePolicy.selectionMode,
    selectedValidationDateKeys: args.policyPreview?.selectedValidationDateKeys ?? null,
    stampedPastValidationPolicyRevision: args.stampedValidation.stampedPastValidationPolicyRevision,
    stampedValidationDateKeys: args.stampedValidation.stampedValidationDateKeys,
    validationSelectionMode: args.stampedValidation.validationSelectionMode,
    localValidationSelectorRan: false,
  };
}

async function buildEmptyContext(args: {
  sourceHouseId: string;
  userId: string;
  esiid?: string | null;
  window: { startDate: string; endDate: string };
  status: ManualGapfillSourceContextStatus;
  warnings: string[];
  diagnostics?: Partial<ManualGapfillSourceContextDiagnostics>;
}): Promise<ManualGapfillSourceContext> {
  return {
    status: args.status,
    sourceHouseId: args.sourceHouseId,
    userId: args.userId,
    esiid: args.esiid ?? null,
    committedUsageSource: null,
    actualSource: null,
    sourceOwner: "none",
    onePathUpstream: {
      owner: MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER,
      usageTruthSource: null,
      actualContextHouseId: args.sourceHouseId,
    },
    actualSourceKind: "missing",
    coverage: {
      coverageStart: null,
      coverageEnd: null,
      latestDate: null,
      dailyCount: 0,
      intervalCount: 0,
      monthlyCount: 0,
      fullYearAvailable: false,
      windowStart: args.window.startDate,
      windowEnd: args.window.endDate,
    },
    fingerprints: {
      intervalFingerprint: null,
      dailyFingerprint: null,
      monthlyFingerprint: null,
      weatherIdentity: null,
      usageShapeIdentity: null,
    },
    actualData: {
      actualDatasetSummary: null,
      dailyTotals: null,
      monthlyTotals: null,
      annualTotal: null,
    },
    validation: await buildGlobalValidationContext({
      stampedValidation: {
        stampedPastValidationPolicyRevision: null,
        stampedValidationDateKeys: null,
        validationSelectionMode: null,
      },
      policyPreview: null,
    }),
    alternatives: { smt: null, greenButton: null },
    diagnostics: {
      lookedForActualDataset: false,
      actualDatasetFound: false,
      actualIntervalsFound: false,
      sourceCoverageSufficient: false,
      committedSourceResolved: false,
      healAttempted: false,
      healSkippedReason: "read_only_resolver",
      warnings: args.warnings,
      ...args.diagnostics,
    },
  };
}

export async function resolveManualGapfillSmtSourceContext(
  args: ResolveManualGapfillSmtSourceContextArgs
): Promise<ManualGapfillSourceContext> {
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  const window = args.window ?? resolveCanonicalUsage365CoverageWindow();
  const warnings: string[] = [];

  if (!sourceHouseId || !userId) {
    return await buildEmptyContext({
      sourceHouseId: sourceHouseId || "missing",
      userId: userId || "missing",
      esiid: args.esiid ?? null,
      window,
      status: "missing",
      warnings: ["sourceHouseId and userId are required."],
    });
  }

  const house = await prisma.houseAddress
    .findFirst({
      where: { id: sourceHouseId, archivedAt: null },
      select: { id: true, esiid: true, userId: true },
    })
    .catch(() => null);

  if (!house?.id) {
    return await buildEmptyContext({
      sourceHouseId,
      userId,
      esiid: args.esiid ?? null,
      window,
      status: "missing",
      warnings: ["Source house was not found."],
    });
  }

  const ownerUserId = String(house.userId ?? "").trim();
  const effectiveUserId = ownerUserId || userId;
  if (userId && ownerUserId && userId !== ownerUserId) {
    warnings.push(
      `Provided userId did not match source house owner; resolved owner ${ownerUserId} from house record.`
    );
  } else if (!userId && !ownerUserId) {
    return await buildEmptyContext({
      sourceHouseId,
      userId: userId || "missing",
      esiid: args.esiid ?? null,
      window,
      status: "missing",
      warnings: ["Source house owner userId could not be resolved."],
    });
  }

  const effectiveEsiid = args.esiid ?? house.esiid ?? null;
  const committedUsageSource = await resolveHouseCommittedUsageSource({
    houseId: sourceHouseId,
    userId: effectiveUserId,
    esiid: effectiveEsiid,
  }).catch(() => null);

  const actualLoad = await loadManualGapfillSourceActualDataset({
    userId: effectiveUserId,
    sourceHouseId,
    esiid: effectiveEsiid,
    preferredActualSource: committedUsageSource ?? null,
  });

  const dataset = actualLoad.dataset;
  const alternatives = actualLoad.alternatives;
  const actualDatasetSummary = summarizeActualDataset(dataset);
  const actualSource = actualDatasetSummary?.source ?? committedUsageSource ?? null;
  const actualSourceKind = resolveActualSourceKind({
    committedUsageSource,
    actualSource,
    alternatives,
  });

  const dailyTotals = Array.isArray(dataset?.daily)
    ? dataset!.daily.map((row) => ({ date: String(row.date).slice(0, 10), kwh: Number(row.kwh) || 0 }))
    : [];
  const monthlyTotals = Array.isArray(dataset?.monthly)
    ? dataset!.monthly.map((row) => ({ month: String(row.month).slice(0, 7), kwh: Number(row.kwh) || 0 }))
    : [];
  const annualTotal = Array.isArray(dataset?.series?.annual)
    ? Number((dataset!.series!.annual as Array<{ kwh?: number }>)[0]?.kwh) || null
    : dailyTotals.reduce((sum, row) => sum + row.kwh, 0) || null;

  const intervalCount = actualDatasetSummary?.intervalsCount ?? 0;
  const dailyCount = dailyTotals.length;
  const monthlyCount = monthlyTotals.length;
  const coverageStart = actualDatasetSummary?.start ?? null;
  const coverageEnd = actualDatasetSummary?.end ?? null;
  const latestDate = actualDatasetSummary?.latest ?? coverageEnd;
  const fullYearAvailable =
    dailyCount >= CANONICAL_COVERAGE_TOTAL_DAYS &&
    Boolean(coverageStart && coverageEnd && coverageStart <= window.startDate && coverageEnd >= window.endDate);

  const actualDatasetFound = Boolean(dataset);
  const actualIntervalsFound = intervalCount > 0;
  const sourceCoverageSufficient = actualDatasetFound && actualIntervalsFound && dailyCount > 0;
  const status = resolveStatus({
    houseFound: true,
    actualSourceKind,
    sourceCoverageSufficient,
  });

  if (actualSourceKind === "missing") {
    warnings.push("No persisted actual usage truth was found for the source house.");
  } else if (actualSourceKind === "ambiguous") {
    warnings.push("Both SMT and Green Button usage summaries are present without a committed source.");
  } else if (!sourceCoverageSufficient) {
    warnings.push("Actual usage truth exists but coverage is insufficient for Manual GapFill source context.");
  }

  const [intervalFingerprint, weatherIdentity, usageFingerprintArtifact, stampedValidation, policyPreview] =
    await Promise.all([
    sourceCoverageSufficient
      ? getIntervalDataFingerprint({
          houseId: sourceHouseId,
          esiid: effectiveEsiid,
          startDate: window.startDate,
          endDate: window.endDate,
          preferredSource: actualSource ?? committedUsageSource ?? undefined,
        }).catch(() => null)
      : Promise.resolve(null),
    sourceCoverageSufficient
      ? computePastWeatherIdentity({
          houseId: sourceHouseId,
          startDate: window.startDate,
          endDate: window.endDate,
        }).catch(() => null)
      : Promise.resolve(null),
    getLatestUsageFingerprintByHouseId(sourceHouseId).catch(() => null),
    readStampedValidationContext({ userId: effectiveUserId, sourceHouseId }),
    sourceCoverageSufficient
      ? previewGlobalValidationDaySelection({
          sourceHouseId,
          houseId: sourceHouseId,
          userId: effectiveUserId,
          esiid: effectiveEsiid,
          window,
          surface: "admin_lab",
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const dailyFingerprint = hashTotalsFingerprint(dailyTotals);
  const monthlyFingerprint = hashTotalsFingerprint(monthlyTotals);
  const usageShapeIdentity =
    usageFingerprintArtifact?.sourceHash ??
    (intervalFingerprint && weatherIdentity
      ? computeUsageFingerprintSourceHash({
          intervalDataFingerprint: intervalFingerprint,
          weatherIdentity,
          windowStart: window.startDate,
          windowEnd: window.endDate,
        })
      : null);

  return {
    status,
    sourceHouseId,
    userId: effectiveUserId,
    esiid: effectiveEsiid,
    committedUsageSource,
    actualSource,
    sourceOwner: sourceCoverageSufficient ? SOURCE_OWNER : "none",
    onePathUpstream: {
      owner: MANUAL_GAPFILL_SOURCE_ACTUAL_OWNER,
      usageTruthSource: actualLoad.usageTruthSource,
      actualContextHouseId: actualLoad.actualContextHouseId,
    },
    actualSourceKind,
    coverage: {
      coverageStart,
      coverageEnd,
      latestDate,
      dailyCount,
      intervalCount,
      monthlyCount,
      fullYearAvailable,
      windowStart: window.startDate,
      windowEnd: window.endDate,
    },
    fingerprints: {
      intervalFingerprint,
      dailyFingerprint,
      monthlyFingerprint,
      weatherIdentity,
      usageShapeIdentity,
    },
    actualData: {
      actualDatasetSummary,
      dailyTotals: args.includeDiagnostics ? dailyTotals : null,
      monthlyTotals: args.includeDiagnostics ? monthlyTotals : null,
      annualTotal,
    },
    validation: await buildGlobalValidationContext({ stampedValidation, policyPreview }),
    alternatives,
    diagnostics: {
      lookedForActualDataset: true,
      actualDatasetFound,
      actualIntervalsFound,
      sourceCoverageSufficient,
      committedSourceResolved: Boolean(committedUsageSource),
      healAttempted: false,
      healSkippedReason: "read_only_resolver",
      warnings,
    },
  };
}
