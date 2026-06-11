import {
  asArray,
  asNumber,
  asRecord,
  asString,
  extractValidationDayKeysFromCompareProjection,
  extractValidationDayKeysFromPolicySnapshot,
  pickKeys,
  type ExportDeploymentMetadata,
} from "@/lib/admin/aiTuningBundleHelpers";
import { buildSimulationCodeMap } from "@/lib/admin/simulationCodeMap";

function resolveSourceKind(args: {
  mode: string;
  loadedSourceContext: Record<string, unknown>;
  engineInput: Record<string, unknown>;
}): string {
  const mode = String(args.mode ?? "").toUpperCase();
  if (mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL") return "manual";
  if (mode === "GREEN_BUTTON") return "GREEN_BUTTON";
  const preferred = asString(args.engineInput.preferredActualSource) ?? asString(args.loadedSourceContext.committedUsageSource);
  if (preferred === "GREEN_BUTTON") return "GREEN_BUTTON";
  return "SMT";
}

function buildIntervalDiagnosticsExportSection(diagnostics: Record<string, unknown> | null) {
  if (!diagnostics || diagnostics.available !== true) {
    return {
      available: false,
      unavailableReason: diagnostics?.unavailableReason ?? "missing_or_unavailable",
      validationIntervalCurveDiagnostics: null,
      exactMatchDiagnostics: null,
      exportHints: [
        "Run an INTERVAL or GREEN_BUTTON Past sim on the test home, then copy again.",
        "For posthoc top-miss curves, enable the checkbox and use Re-read run with posthoc interval curves.",
      ],
    };
  }

  const validationCurves = asRecord(diagnostics.validationIntervalCurveDiagnostics);
  const curveDays = asArray(validationCurves.days);
  const exactMatch = asRecord(diagnostics.exactMatchDiagnostics);
  const exportHints: string[] = [];
  if (curveDays.length === 0) {
    exportHints.push(
      "validationIntervalCurveDiagnostics.days is empty. Re-read diagnostics with includePosthocTopMissIntervalCurves or ensure validation-day keys exist in compare projection."
    );
  }

  return {
    available: true,
    unavailableReason: null,
    dailyCompare: diagnostics.dailyCompare ?? null,
    weatherMissDiagnostics: diagnostics.weatherMissDiagnostics ?? null,
    worstDayDiagnostics: diagnostics.worstDayDiagnostics ?? null,
    todBucketDiagnostics: diagnostics.todBucketDiagnostics ?? null,
    validationIntervalCurveDiagnostics: {
      ...validationCurves,
      days: curveDays,
      populated: curveDays.length > 0,
      requiredFieldsPresent: curveDays.length
        ? curveDays.every((day) => {
            const record = asRecord(day);
            return (
              record.rawIntervalWape != null ||
              record.intervalMae != null ||
              record.normalizedShapeError != null ||
              record.peakActualKwh != null
            );
          })
        : false,
    },
    exactMatchDiagnostics: exactMatch,
    exportHints,
  };
}

export function buildOnePathAiTuningBundle(args: {
  mode: string;
  runResult?: Record<string, unknown> | null;
  lookup?: Record<string, unknown> | null;
  simulationVariablesPayload?: Record<string, unknown> | null;
  uiControls?: Record<string, unknown> | null;
  deployment?: ExportDeploymentMetadata | null;
}): Record<string, unknown> {
  const runResult = asRecord(args.runResult);
  const lookup = asRecord(args.lookup);
  const simulationVariables = asRecord(args.simulationVariablesPayload);
  const loadedSourceContext = asRecord(simulationVariables.loadedSourceContext);
  const readModel = asRecord(simulationVariables.rawReadModel ?? simulationVariables.readModel);
  const runDisplayContract = asRecord(simulationVariables.runDisplayContract);
  const simRunAudit = asRecord(simulationVariables.simRunAudit);
  const artifactIdentity = asRecord(simRunAudit.artifactIdentity);
  const engineInputIdentity = asRecord(simRunAudit.engineInputIdentity);
  const engineInput = asRecord(simulationVariables.engineInput);
  const compareProjection = asRecord(readModel.compareProjection ?? runDisplayContract.compare);
  const compareRows = asArray(compareProjection.rows ?? asRecord(runDisplayContract.compare).rows);
  const dailyRows = asArray(asRecord(runDisplayContract.dailyUsage).rows);
  const dailyWeather = asRecord(runDisplayContract.dailyUsage).dailyWeather ?? null;
  const intervalDiagnostics = asRecord(runResult.onePathIntervalDiagnosticsV1 ?? simulationVariables.onePathIntervalDiagnosticsV1);
  const validationDayKeys =
    extractValidationDayKeysFromCompareProjection(compareProjection).length > 0
      ? extractValidationDayKeysFromCompareProjection(compareProjection)
      : extractValidationDayKeysFromPolicySnapshot(lookup.sourceContext ?? loadedSourceContext);

  const actualTotalKwh =
    asNumber(asRecord(runDisplayContract.coverage).totalKwh) ??
    asNumber(asRecord(asRecord(readModel.dataset).summary).totalKwh) ??
    asNumber(asRecord(simulationVariables.runResults).actualTotalKwh);
  const simulatedTotalKwh =
    asNumber(asRecord(asRecord(readModel.dataset).summary).totalKwh) ??
    asNumber(asRecord(simulationVariables.runResults).simulatedTotalKwh);

  return {
    purpose:
      "Structured One Path admin AI tuning bundle for simulation accuracy review, miss identification, and targeted tuning recommendations.",
    bundleVersion: "one-path-ai-tuning-bundle-v1",
    exportedAt: new Date().toISOString(),
    selectedMode: String(args.mode ?? simulationVariables.selectedMode ?? "").toUpperCase() || null,
    sourceKind: resolveSourceKind({ mode: args.mode, loadedSourceContext, engineInput }),
    identity: {
      actualContextHouseId:
        asString(engineInputIdentity.actualContextHouseId) ??
        asString(args.uiControls?.actualContextHouseId) ??
        asString(loadedSourceContext.actualContextHouseId),
      sourceHouseId:
        asString(lookup.selectedHouseId) ??
        asString(asRecord(lookup.selectedHouse).id) ??
        asString(loadedSourceContext.sourceHouseId),
      scenarioId: asString(engineInputIdentity.scenarioId) ?? asString(engineInput.scenarioId),
      artifactId: asString(artifactIdentity.artifactId),
      artifactInputHash: asString(artifactIdentity.artifactInputHash),
      buildInputsHash: asString(artifactIdentity.buildInputsHash),
      engineVersion: asString(artifactIdentity.engineVersion),
      simulatorMode: asString(artifactIdentity.simulatorMode) ?? asString(engineInput.simulatorMode),
      inputType: asString(artifactIdentity.inputType) ?? asString(engineInput.inputType),
      coverageStart:
        asString(asRecord(runDisplayContract.coverage).start) ??
        asString(engineInputIdentity.coverageWindowStart) ??
        asString(asRecord(asRecord(readModel.dataset).summary).start),
      coverageEnd:
        asString(asRecord(runDisplayContract.coverage).end) ??
        asString(engineInputIdentity.coverageWindowEnd) ??
        asString(asRecord(asRecord(readModel.dataset).summary).end),
    },
    totals: {
      actualKwh: actualTotalKwh,
      simulatedKwh: simulatedTotalKwh,
      deltaKwh:
        actualTotalKwh != null && simulatedTotalKwh != null
          ? Math.round((simulatedTotalKwh - actualTotalKwh) * 100) / 100
          : null,
    },
    dailyActualVsSimulatedRows: dailyRows.length ? dailyRows : compareRows,
    selectedValidationDateKeys: validationDayKeys,
    weatherRowsUsed: dailyWeather,
    profileInputs: {
      homeProfile: loadedSourceContext.homeProfile ?? null,
      applianceProfile: loadedSourceContext.applianceProfile ?? null,
      travelVacantInputs: loadedSourceContext.travelRangesFromDb ?? [],
      weatherDerivedInput: loadedSourceContext.weatherDerivedInput ?? null,
      weatherScore: loadedSourceContext.weatherScore ?? null,
    },
    diagnostics: {
      dailyCompare: intervalDiagnostics.dailyCompare ?? null,
      weatherMissDiagnostics: intervalDiagnostics.weatherMissDiagnostics ?? null,
      worstDayDiagnostics: intervalDiagnostics.worstDayDiagnostics ?? null,
      onePathIntervalDiagnosticsV1: buildIntervalDiagnosticsExportSection(intervalDiagnostics),
    },
    compareProjection: pickKeys(compareProjection, ["metrics", "rows"]),
    simulationVariablesSummary: pickKeys(simulationVariables, [
      "selectedMode",
      "source",
      "aiPayloadMeta",
      "validationTargets",
      "curveShapingSummary",
      "parityAudit",
      "performanceAudit",
    ]),
    simulationCodeMap: buildSimulationCodeMap({
      surface: "one_path_admin",
      deployment: args.deployment ?? null,
    }),
  };
}
