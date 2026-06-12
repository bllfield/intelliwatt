import { describe, expect, it } from "vitest";
import {
  buildModelIntelligenceOnePathRunRequest,
  extractModelIntelligenceOnePathRunReadback,
  listOrchestrationDispatchSteps,
  mapModelIntelligenceRunModeToOnePathMode,
  resolveModelIntelligencePersistRequested,
} from "@/modules/modelIntelligence/onePathDispatchPlan";
import { buildModelIntelligenceSequencePreview } from "@/modules/modelIntelligence/runPlanBuilder";
import {
  defaultModelIntelligenceManualGapfillOptions,
  defaultModelIntelligenceOnePathOptions,
  defaultModelIntelligenceOrchestrationFlags,
} from "@/lib/admin/modelIntelligenceClient";
import type { ModelIntelligenceLabContext } from "@/modules/modelIntelligence/types";

function baseContext(overrides: Partial<ModelIntelligenceLabContext> = {}): ModelIntelligenceLabContext {
  return {
    email: "test@example.com",
    userId: "user-1",
    sourceHouseId: "source-1",
    esiid: "E123",
    addressLabel: "123 Main",
    committedUsageSource: "SMT",
    actualSourceKind: "SMT",
    actualContextHouseId: "source-1",
    sourceTruthAvailable: true,
    profileOnlyHouse: false,
    coverageStart: "2025-04-15",
    coverageEnd: "2026-04-14",
    dailyCount: 365,
    intervalCount: 35040,
    annualTotalKwh: 14456,
    intervalFingerprint: "fp-1",
    greenButtonAvailable: false,
    smtIntervalTruthAvailable: true,
    labTestHome: {
      testHomeHouseId: "lab-1",
      linkedSourceHouseId: "source-1",
      isPinnedToSource: true,
      status: "ready",
      statusMessage: null,
      needsReplace: false,
    },
    warnings: [],
    ...overrides,
  };
}

describe("onePathDispatchPlan", () => {
  it("maps model intelligence modes to One Path admin modes", () => {
    expect(mapModelIntelligenceRunModeToOnePathMode("SMT_INTERVAL_TRUTH")).toBe("INTERVAL");
    expect(mapModelIntelligenceRunModeToOnePathMode("GREEN_BUTTON_TRUTH")).toBe("GREEN_BUTTON");
    expect(mapModelIntelligenceRunModeToOnePathMode("MONTHLY_MASKED")).toBe("MANUAL_MONTHLY");
    expect(mapModelIntelligenceRunModeToOnePathMode("NEW_BUILD")).toBeNull();
  });

  it("builds MONTHLY_MASKED run requests with lab persistence and actual-derived payload", () => {
    const context = baseContext();
    const onePathOptions = { ...defaultModelIntelligenceOnePathOptions(), persistRequested: false };
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { MONTHLY_MASKED: true },
      onePathOptions,
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const availability = preview.modeAvailability.find((row) => row.mode === "MONTHLY_MASKED")!;
    expect(availability.writesToLabHomeOnly).toBe(true);
    const built = buildModelIntelligenceOnePathRunRequest({
      context,
      runMode: "MONTHLY_MASKED",
      availability,
      onePathOptions,
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      scenarioId: "scenario-past-1",
      ownerUserId: "owner-1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.mode).toBe("MANUAL_MONTHLY");
    expect(built.request.persistRequested).toBe(true);
    expect(built.request.sourceHouseId).toBe("source-1");
    expect(built.request.houseId).toBe("lab-1");
    expect(built.request.actualContextHouseId).toBe("source-1");
    expect((built.request.orchestration as any).surface).toBe("model_intelligence_lab");
    expect((built.request.orchestration as any).forceActualDerivedManualPayload).toBe(true);
    expect(built.request.action).toBe("run");
  });

  it("builds ANNUAL_MASKED run requests with lab persistence and actual-derived payload", () => {
    const context = baseContext();
    const onePathOptions = { ...defaultModelIntelligenceOnePathOptions(), persistRequested: false };
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { ANNUAL_MASKED: true },
      onePathOptions,
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const availability = preview.modeAvailability.find((row) => row.mode === "ANNUAL_MASKED")!;
    expect(availability.writesToLabHomeOnly).toBe(true);
    const built = buildModelIntelligenceOnePathRunRequest({
      context,
      runMode: "ANNUAL_MASKED",
      availability,
      onePathOptions,
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      scenarioId: "scenario-past-1",
      ownerUserId: "owner-1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.mode).toBe("MANUAL_ANNUAL");
    expect(built.request.persistRequested).toBe(true);
    expect(built.request.sourceHouseId).toBe("source-1");
    expect(built.request.houseId).toBe("lab-1");
    expect(built.request.actualContextHouseId).toBe("source-1");
    expect((built.request.orchestration as any).surface).toBe("model_intelligence_lab");
    expect((built.request.orchestration as any).forceActualDerivedManualPayload).toBe(true);
  });

  it("does not force persistRequested for non-masked One Path dispatch modes", () => {
    const onePathOptions = { ...defaultModelIntelligenceOnePathOptions(), persistRequested: false };
    expect(
      resolveModelIntelligencePersistRequested({
        runMode: "SMT_INTERVAL_TRUTH",
        onePathOptions,
      })
    ).toBe(false);
    expect(
      resolveModelIntelligencePersistRequested({
        runMode: "GREEN_BUTTON_TRUTH",
        onePathOptions,
      })
    ).toBe(false);
    expect(
      resolveModelIntelligencePersistRequested({
        runMode: "MONTHLY_MASKED",
        onePathOptions,
      })
    ).toBe(true);
  });

  it("keeps source actualContextHouseId for SMT interval truth while dispatching to pinned lab home", () => {
    const context = baseContext();
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { SMT_INTERVAL_TRUTH: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const availability = preview.modeAvailability.find((row) => row.mode === "SMT_INTERVAL_TRUTH")!;
    const built = buildModelIntelligenceOnePathRunRequest({
      context,
      runMode: "SMT_INTERVAL_TRUTH",
      availability,
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      scenarioId: "scenario-past-1",
      ownerUserId: "owner-1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.mode).toBe("INTERVAL");
    expect(built.request.sourceHouseId).toBe("source-1");
    expect(built.request.houseId).toBe("lab-1");
    expect(built.request.actualContextHouseId).toBe("source-1");
    expect(built.request.preferredActualSource).toBe("SMT");
    expect((built.request.orchestration as any).forceActualDerivedManualPayload).toBe(false);
  });

  it("extracts artifact readback fields from One Path run responses", () => {
    const readback = extractModelIntelligenceOnePathRunReadback({
      ok: true,
      runType: "PAST_SIM",
      engineInput: { scenarioId: "scenario-1" },
      artifact: {
        artifactId: "artifact-1",
        artifactInputHash: "hash-artifact",
        buildInputsHash: "hash-build",
        engineVersion: "engine-v1",
        scenarioId: "scenario-1",
      },
      runDisplayView: {
        summary: { coverageStart: "2025-04-15", coverageEnd: "2026-04-14", totalKwh: 14456 },
      },
    });
    expect(readback.scenarioId).toBe("scenario-1");
    expect(readback.artifactId).toBe("artifact-1");
    expect(readback.artifactInputHash).toBe("hash-artifact");
    expect(readback.buildInputsHash).toBe("hash-build");
    expect(readback.engineVersion).toBe("engine-v1");
    expect(readback.runType).toBe("PAST_SIM");
  });

  it("lists only runnable dispatch steps from the preview", () => {
    const preview = buildModelIntelligenceSequencePreview({
      context: baseContext(),
      selectedRuns: { SMT_INTERVAL_TRUTH: true, NEW_BUILD: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const dispatchSteps = listOrchestrationDispatchSteps(preview);
    expect(dispatchSteps.map((step) => step.runMode)).toEqual(["SMT_INTERVAL_TRUTH"]);
  });
});
