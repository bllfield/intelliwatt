import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";
import {
  computeValidationDayPolicyHash,
  resolveActiveValidationDayPolicyLive,
  resolveGlobalValidationDayKeysForPastSim,
} from "@/lib/usage/validationDayPolicy";
import { buildOnePathManualUsagePastSimReadResult } from "@/modules/onePathSim/manualPastSimReadResult";
import {
  hashManualGapfillSavedSeedPayload,
  type ManualGapfillSeedMode,
} from "@/modules/manualUsage/manualGapfillSeed";
import {
  loadManualGapfillSourceActualDataset,
  resolveManualGapfillSmtSourceContext,
  type ManualGapfillSourceContext,
} from "@/modules/manualUsage/manualGapfillSourceContext";
import type { ManualValidationSummary } from "@/modules/manualUsage/manualValidationSummary";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import type { ValidationDaySelectionMode } from "@/modules/usageSimulator/validationSelection";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

export type ManualGapfillRunReadbackStatus =
  | "ready"
  | "needs_seed"
  | "source_context_missing"
  | "seed_source_mismatch"
  | "policy_mismatch"
  | "run_failed"
  | "readback_failed";

export type ManualGapfillRunReadbackArgs = {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  esiid?: string | null;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  validationDayCount?: number;
  validationSelectionMode?: string;
  expectedSeedHash?: string | null;
  expectedSourceFingerprint?: string | null;
  expectedValidationDayPolicyHash?: string | null;
  persistRequested?: boolean;
  includeDiagnostics?: boolean;
};

export type ManualGapfillRunReadbackResult = {
  ok: boolean;
  status: ManualGapfillRunReadbackStatus;
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
    manualSeedFound: boolean;
    manualSeedHash: string | null;
    actualContextHouseId: string;
  };
  run: {
    dispatched: boolean;
    scenarioId: string | null;
    artifactId: string | null;
    artifactInputHash: string | null;
    buildInputsHash: string | null;
    engineVersion: string | null;
    simulatorMode: "MANUAL_TOTALS";
    inputType: "MANUAL_MONTHLY" | "MANUAL_ANNUAL";
    persisted: boolean;
  };
  readback: {
    coverageStart: string | null;
    coverageEnd: string | null;
    dailyRowCount: number | null;
    intervalCount: number | null;
    totalKwh: number | null;
    source: "SIMULATED" | null;
    sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" | null;
    billMatchStatus?: string | null;
    eligiblePeriodCount?: number | null;
    reconciledPeriodCount?: number | null;
    intervalShape?: "estimated" | "measured" | null;
    baseload15MinKwh?: number | null;
  };
  diagnostics: {
    usedPreparedLabSeed: boolean;
    usedSourceActualTruthAsContextOnly: boolean;
    usedTestHomeAsTruth: false;
    globalValidationPolicyUsed: true;
    localGapFillSelectorUsed: false;
    pastSimRecalcDispatched: boolean;
    compareRun: false;
    sourceHouseWritten: false;
    labManualPayloadWritten: false;
    warnings: string[];
  };
};

function mapSourceContextBlock(
  source: ManualGapfillSourceContext,
  policyHash: string
): ManualGapfillRunReadbackResult["sourceContext"] {
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

function emptySourceContextBlock(args: {
  sourceHouseId: string;
  policyHash: string;
}): ManualGapfillRunReadbackResult["sourceContext"] {
  return {
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
  };
}

function resolveInputType(mode: ManualGapfillSeedMode): "MANUAL_MONTHLY" | "MANUAL_ANNUAL" {
  return mode === "MONTHLY_FROM_SOURCE_INTERVALS" ? "MANUAL_MONTHLY" : "MANUAL_ANNUAL";
}

function expectedPayloadMode(mode: ManualGapfillSeedMode): ManualUsagePayload["mode"] {
  return mode === "MONTHLY_FROM_SOURCE_INTERVALS" ? "MONTHLY" : "ANNUAL";
}

function buildFailureResult(args: {
  status: ManualGapfillRunReadbackStatus;
  mode: ManualGapfillSeedMode;
  sourceContext: ManualGapfillRunReadbackResult["sourceContext"];
  labHouseId: string;
  sourceHouseId: string;
  manualSeedFound?: boolean;
  manualSeedHash?: string | null;
  warnings: string[];
  pastSimRecalcDispatched?: boolean;
  run?: Partial<ManualGapfillRunReadbackResult["run"]>;
}): ManualGapfillRunReadbackResult {
  return {
    ok: false,
    status: args.status,
    mode: args.mode,
    sourceContext: args.sourceContext,
    labContext: {
      labHouseId: args.labHouseId,
      manualSeedFound: args.manualSeedFound ?? false,
      manualSeedHash: args.manualSeedHash ?? null,
      actualContextHouseId: args.sourceHouseId,
    },
    run: {
      dispatched: args.run?.dispatched ?? false,
      scenarioId: args.run?.scenarioId ?? null,
      artifactId: args.run?.artifactId ?? null,
      artifactInputHash: args.run?.artifactInputHash ?? null,
      buildInputsHash: args.run?.buildInputsHash ?? null,
      engineVersion: args.run?.engineVersion ?? null,
      simulatorMode: "MANUAL_TOTALS",
      inputType: resolveInputType(args.mode),
      persisted: args.run?.persisted ?? false,
    },
    readback: {
      coverageStart: null,
      coverageEnd: null,
      dailyRowCount: null,
      intervalCount: null,
      totalKwh: null,
      source: null,
      sourceDetail: null,
    },
    diagnostics: {
      usedPreparedLabSeed: args.manualSeedFound ?? false,
      usedSourceActualTruthAsContextOnly: args.status !== "needs_seed",
      usedTestHomeAsTruth: false,
      globalValidationPolicyUsed: true,
      localGapFillSelectorUsed: false,
      pastSimRecalcDispatched: args.pastSimRecalcDispatched ?? false,
      compareRun: false,
      sourceHouseWritten: false,
      labManualPayloadWritten: false,
      warnings: args.warnings,
    },
  };
}

async function resolveLabPastScenarioId(args: {
  userId: string;
  labHouseId: string;
  scenarioId?: string | null;
}): Promise<string | null> {
  if (args.scenarioId && String(args.scenarioId).trim()) {
    return String(args.scenarioId).trim();
  }
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.labHouseId,
        name: WORKSPACE_PAST_NAME,
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  return row?.id ? String(row.id) : null;
}

function normalizeTravelRanges(payload: ManualUsagePayload | null) {
  if (!payload || !Array.isArray(payload.travelRanges)) return [];
  return payload.travelRanges
    .map((range) => ({
      startDate: String(range?.startDate ?? "").slice(0, 10),
      endDate: String(range?.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate));
}

function buildReadbackView(args: {
  dataset: any;
  manualValidationSummary: ManualValidationSummary | null;
}): ManualGapfillRunReadbackResult["readback"] {
  const summary = args.dataset?.summary ?? {};
  const source = String(summary?.source ?? "").trim();
  const sourceDetail = String(summary?.sourceDetail ?? "").trim();
  const meta = args.dataset?.meta ?? {};
  const baseload =
    typeof meta?.baseload15MinKwh === "number" && Number.isFinite(meta.baseload15MinKwh)
      ? meta.baseload15MinKwh
      : typeof meta?.manualBaseload15MinKwh === "number" && Number.isFinite(meta.manualBaseload15MinKwh)
        ? meta.manualBaseload15MinKwh
        : null;

  return {
    coverageStart: typeof summary.start === "string" ? summary.start.slice(0, 10) : null,
    coverageEnd: typeof summary.end === "string" ? summary.end.slice(0, 10) : null,
    dailyRowCount: Array.isArray(args.dataset?.daily) ? args.dataset.daily.length : null,
    intervalCount: Array.isArray(args.dataset?.series?.intervals15)
      ? args.dataset.series.intervals15.length
      : null,
    totalKwh: typeof summary.totalKwh === "number" && Number.isFinite(summary.totalKwh) ? summary.totalKwh : null,
    source: source === "SIMULATED" ? "SIMULATED" : null,
    sourceDetail:
      sourceDetail === "SIMULATED_MANUAL_CONSTRAINED" ? "SIMULATED_MANUAL_CONSTRAINED" : null,
    billMatchStatus: args.manualValidationSummary?.billMatchVerification?.status ?? null,
    eligiblePeriodCount: args.manualValidationSummary?.billMatchVerification?.eligiblePeriodCount ?? null,
    reconciledPeriodCount: args.manualValidationSummary?.billMatchVerification?.reconciledPeriodCount ?? null,
    intervalShape: args.manualValidationSummary?.intervalShape?.accuracyClaim ?? null,
    baseload15MinKwh: baseload,
  };
}

export async function runManualGapfillSeededPastSim(args: {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  esiid?: string | null;
  scenarioId: string;
  manualPayload: ManualUsagePayload;
  weatherPreference?: WeatherPreference;
  validationDayCount?: number;
  validationSelectionMode?: string;
  persistRequested?: boolean;
  correlationId?: string;
}): Promise<
  | {
      ok: true;
      dispatched: Awaited<ReturnType<typeof dispatchPastSimRecalc>>;
      artifactInputHash: string | null;
      buildInputsHash: string | null;
      artifactId: string | null;
      engineVersion: string | null;
      persisted: boolean;
    }
  | { ok: false; error: string; warnings: string[] }
> {
  const globalValidation = await resolveGlobalValidationDayKeysForPastSim({
    houseId: args.labHouseId,
    userId: args.userId,
    esiid: args.esiid ?? null,
    sourceHouseId: args.sourceHouseId,
    surface: "admin_lab",
  });
  const selectionMode = globalValidation.selectionMode as ValidationDaySelectionMode;
  const validationDayCount = globalValidation.validationDayCount;

  const persistPastSimBaseline = args.persistRequested !== false;
  const travelRanges = normalizeTravelRanges(args.manualPayload);

  const dispatched = await dispatchPastSimRecalc({
    userId: args.userId,
    houseId: args.labHouseId,
    esiid: args.esiid ?? null,
    actualContextHouseId: args.sourceHouseId,
    mode: "MANUAL_TOTALS",
    scenarioId: args.scenarioId,
    weatherPreference: args.weatherPreference ?? "LAST_YEAR_WEATHER",
    persistPastSimBaseline,
    preLockboxTravelRanges: travelRanges,
    validationOnlyDateKeysLocal: globalValidation.validationOnlyDateKeysLocal,
    validationDaySelectionMode: selectionMode,
    validationDayCount,
    correlationId: args.correlationId,
    runContext: {
      callerLabel: "manual_gapfill_run_readback",
      buildPathKind: "recalc",
      persistRequested: persistPastSimBaseline,
    },
  });

  if (dispatched.executionMode === "droplet_async") {
    return { ok: false, error: "droplet_async_not_supported_for_mg4_readback", warnings: [] };
  }

  if (!dispatched.result.ok) {
    return {
      ok: false,
      error: String(dispatched.result.error ?? "recalc_failed"),
      warnings: Array.isArray(dispatched.result.missingItems)
        ? dispatched.result.missingItems.map(String)
        : [],
    };
  }

  const artifactInputHash =
    typeof dispatched.result.canonicalArtifactInputHash === "string" &&
    dispatched.result.canonicalArtifactInputHash.trim()
      ? dispatched.result.canonicalArtifactInputHash.trim()
      : null;

  const [buildRow, artifactRow] = await Promise.all([
    (prisma as any).usageSimulatorBuild
      .findUnique({
        where: {
          userId_houseId_scenarioKey: {
            userId: args.userId,
            houseId: args.labHouseId,
            scenarioKey: args.scenarioId,
          },
        },
        select: { buildInputsHash: true },
      })
      .catch(() => null),
    (usagePrisma as any).pastSimulatedDatasetCache
      .findFirst({
        where: {
          houseId: args.labHouseId,
          scenarioId: args.scenarioId,
          ...(artifactInputHash ? { inputHash: artifactInputHash } : {}),
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, engineVersion: true, inputHash: true },
      })
      .catch(() => null),
  ]);

  return {
    ok: true,
    dispatched,
    artifactInputHash: artifactInputHash ?? artifactRow?.inputHash ?? null,
    buildInputsHash: buildRow?.buildInputsHash ? String(buildRow.buildInputsHash) : null,
    artifactId: artifactRow?.id ? String(artifactRow.id) : null,
    engineVersion: artifactRow?.engineVersion ? String(artifactRow.engineVersion) : null,
    persisted: persistPastSimBaseline,
  };
}

export async function readManualGapfillPastSimResult(args: {
  userId: string;
  labHouseId: string;
  sourceHouseId: string;
  mode: ManualGapfillSeedMode;
  scenarioId: string;
  manualPayload: ManualUsagePayload;
  artifactInputHash?: string | null;
  artifactId?: string | null;
  artifactEngineVersion?: string | null;
  correlationId?: string | null;
}): Promise<
  | {
      ok: true;
      readback: ManualGapfillRunReadbackResult["readback"];
      artifactInputHash: string | null;
      artifactId: string | null;
      engineVersion: string | null;
    }
  | { ok: false; error: string }
> {
  const usageInputMode = resolveInputType(args.mode);
  const sourceActual = await loadManualGapfillSourceActualDataset({
    userId: args.userId,
    sourceHouseId: args.sourceHouseId,
  });
  const readResult = await buildOnePathManualUsagePastSimReadResult({
    userId: args.userId,
    houseId: args.labHouseId,
    scenarioId: args.scenarioId,
    readMode: "artifact_only",
    callerType: "gapfill_test",
    correlationId: args.correlationId ?? null,
    exactArtifactInputHash: args.artifactInputHash ?? null,
    requireExactArtifactMatch: Boolean(args.artifactInputHash),
    usageInputMode,
    validationPolicyOwner: "global_validation_day_policy_v1",
    artifactId: args.artifactId ?? null,
    artifactInputHash: args.artifactInputHash ?? null,
    artifactEngineVersion: args.artifactEngineVersion ?? null,
    artifactPersistenceOutcome: "persisted_artifact_exact_read",
    manualUsagePayload: args.manualPayload,
    actualDataset: sourceActual.dataset,
    actualReference: {
      userId: args.userId,
      houseId: sourceActual.actualContextHouseId,
      scenarioId: null,
    },
  });

  if (!readResult.ok) {
    return { ok: false, error: String(readResult.failureCode ?? readResult.error ?? "readback_failed") };
  }

  return {
    ok: true,
    readback: buildReadbackView({
      dataset: readResult.displayDataset ?? readResult.dataset,
      manualValidationSummary: readResult.manualValidationSummary,
    }),
    artifactInputHash:
      args.artifactInputHash ??
      (typeof readResult.dataset?.meta?.artifactInputHash === "string"
        ? readResult.dataset.meta.artifactInputHash
        : null),
    artifactId: args.artifactId ?? null,
    engineVersion: args.artifactEngineVersion ?? null,
  };
}

export async function buildManualGapfillRunReadbackResult(
  args: ManualGapfillRunReadbackArgs
): Promise<ManualGapfillRunReadbackResult> {
  const userId = String(args.userId ?? "").trim();
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const labHouseId = String(args.labHouseId ?? "").trim();
  const mode = args.mode;
  const warnings: string[] = [];
  const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "admin_lab" });
  const policyHash = computeValidationDayPolicyHash(activePolicy);

  if (!userId || !sourceHouseId || !labHouseId) {
    return buildFailureResult({
      status: "run_failed",
      mode,
      sourceContext: emptySourceContextBlock({ sourceHouseId: sourceHouseId || "missing", policyHash }),
      labHouseId: labHouseId || "missing",
      sourceHouseId: sourceHouseId || "missing",
      warnings: ["userId, sourceHouseId, and labHouseId are required."],
    });
  }

  if (labHouseId === sourceHouseId) {
    return buildFailureResult({
      status: "run_failed",
      mode,
      sourceContext: emptySourceContextBlock({ sourceHouseId, policyHash }),
      labHouseId,
      sourceHouseId,
      warnings: ["labHouseId must differ from sourceHouseId."],
    });
  }

  if (
    args.expectedValidationDayPolicyHash &&
    args.expectedValidationDayPolicyHash !== policyHash
  ) {
    return buildFailureResult({
      status: "policy_mismatch",
      mode,
      sourceContext: emptySourceContextBlock({ sourceHouseId, policyHash }),
      labHouseId,
      sourceHouseId,
      warnings: ["Active validation-day policy hash does not match expectedValidationDayPolicyHash."],
    });
  }

  const manualRecord = await getManualUsageInputForUserHouse({ userId, houseId: labHouseId });
  const manualPayload = manualRecord.payload;
  const manualSeedFound = Boolean(manualPayload);
  const parsed = manualPayload ? validateManualUsagePayload(manualPayload) : null;
  const usablePayload = parsed?.ok ? parsed.value : null;
  const manualSeedHash = usablePayload ? hashManualGapfillSavedSeedPayload(usablePayload) : null;

  if (!usablePayload || usablePayload.mode !== expectedPayloadMode(mode)) {
    return buildFailureResult({
      status: "needs_seed",
      mode,
      sourceContext: emptySourceContextBlock({ sourceHouseId, policyHash }),
      labHouseId,
      sourceHouseId,
      manualSeedFound,
      manualSeedHash,
      warnings: [
        usablePayload
          ? `Lab manual seed mode ${usablePayload.mode} does not match requested ${expectedPayloadMode(mode)}.`
          : "No prepared manual seed payload found on lab home. Run MG-3 prepare-seed with persistToLabHome first.",
      ],
    });
  }

  if (args.expectedSeedHash && manualSeedHash !== args.expectedSeedHash) {
    return buildFailureResult({
      status: "seed_source_mismatch",
      mode,
      sourceContext: emptySourceContextBlock({ sourceHouseId, policyHash }),
      labHouseId,
      sourceHouseId,
      manualSeedFound: true,
      manualSeedHash,
      warnings: ["Saved lab manual seed hash does not match expectedSeedHash."],
    });
  }

  const sourceContext = await resolveManualGapfillSmtSourceContext({
    sourceHouseId,
    userId,
    esiid: args.esiid ?? null,
    includeDiagnostics: false,
  });

  if (
    sourceContext.status === "missing" ||
    sourceContext.status === "insufficient" ||
    sourceContext.status === "ambiguous" ||
    sourceContext.actualSourceKind === "missing" ||
    !sourceContext.diagnostics.sourceCoverageSufficient
  ) {
    return buildFailureResult({
      status: "source_context_missing",
      mode,
      sourceContext: mapSourceContextBlock(sourceContext, policyHash),
      labHouseId,
      sourceHouseId,
      manualSeedFound: true,
      manualSeedHash,
      warnings: [...warnings, ...sourceContext.diagnostics.warnings],
    });
  }

  if (
    args.expectedSourceFingerprint &&
    args.expectedSourceFingerprint !== sourceContext.fingerprints.intervalFingerprint
  ) {
    warnings.push("Source interval fingerprint differs from expectedSourceFingerprint.");
  }

  const scenarioId = await resolveLabPastScenarioId({
    userId,
    labHouseId,
    scenarioId: args.scenarioId ?? null,
  });
  if (!scenarioId) {
    return buildFailureResult({
      status: "run_failed",
      mode,
      sourceContext: mapSourceContextBlock(sourceContext, policyHash),
      labHouseId,
      sourceHouseId,
      manualSeedFound: true,
      manualSeedHash,
      warnings: [...warnings, "Past (Corrected) scenario is missing for lab home."],
    });
  }

  const runOut = await runManualGapfillSeededPastSim({
    userId,
    sourceHouseId,
    labHouseId,
    mode,
    esiid: args.esiid ?? null,
    scenarioId,
    manualPayload: usablePayload,
    weatherPreference: args.weatherPreference,
    validationDayCount: args.validationDayCount,
    validationSelectionMode: args.validationSelectionMode,
    persistRequested: args.persistRequested,
  });

  if (!runOut.ok) {
    return buildFailureResult({
      status: "run_failed",
      mode,
      sourceContext: mapSourceContextBlock(sourceContext, policyHash),
      labHouseId,
      sourceHouseId,
      manualSeedFound: true,
      manualSeedHash,
      pastSimRecalcDispatched: true,
      warnings: [...warnings, runOut.error, ...runOut.warnings],
      run: {
        dispatched: true,
        scenarioId,
        persisted: args.persistRequested !== false,
      },
    });
  }

  const readOut = await readManualGapfillPastSimResult({
    userId,
    labHouseId,
    sourceHouseId,
    mode,
    scenarioId,
    manualPayload: usablePayload,
    artifactInputHash: runOut.artifactInputHash,
    artifactId: runOut.artifactId,
    artifactEngineVersion: runOut.engineVersion,
    correlationId:
      runOut.dispatched.executionMode === "inline" ? runOut.dispatched.correlationId : undefined,
  });

  if (!readOut.ok) {
    return buildFailureResult({
      status: "readback_failed",
      mode,
      sourceContext: mapSourceContextBlock(sourceContext, policyHash),
      labHouseId,
      sourceHouseId,
      manualSeedFound: true,
      manualSeedHash,
      pastSimRecalcDispatched: true,
      warnings: [...warnings, readOut.error],
      run: {
        dispatched: true,
        scenarioId,
        artifactId: runOut.artifactId,
        artifactInputHash: runOut.artifactInputHash,
        buildInputsHash: runOut.buildInputsHash,
        engineVersion: runOut.engineVersion,
        persisted: runOut.persisted,
      },
    });
  }

  return {
    ok: true,
    status: "ready",
    mode,
    sourceContext: mapSourceContextBlock(sourceContext, policyHash),
    labContext: {
      labHouseId,
      manualSeedFound: true,
      manualSeedHash,
      actualContextHouseId: sourceHouseId,
    },
    run: {
      dispatched: true,
      scenarioId,
      artifactId: readOut.artifactId ?? runOut.artifactId,
      artifactInputHash: readOut.artifactInputHash ?? runOut.artifactInputHash,
      buildInputsHash: runOut.buildInputsHash,
      engineVersion: readOut.engineVersion ?? runOut.engineVersion,
      simulatorMode: "MANUAL_TOTALS",
      inputType: resolveInputType(mode),
      persisted: runOut.persisted,
    },
    readback: readOut.readback,
    diagnostics: {
      usedPreparedLabSeed: true,
      usedSourceActualTruthAsContextOnly: true,
      usedTestHomeAsTruth: false,
      globalValidationPolicyUsed: true,
      localGapFillSelectorUsed: false,
      pastSimRecalcDispatched: true,
      compareRun: false,
      sourceHouseWritten: false,
      labManualPayloadWritten: false,
      warnings,
    },
  };
}
