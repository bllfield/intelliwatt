import { describe, expect, it } from "vitest";
import {
  isCanonicalPastArtifactScenarioName,
  MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME,
  MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
  shouldPersistCanonicalPastArtifactForScenario,
  WORKSPACE_PAST_SCENARIO_NAME,
} from "@/lib/usage/canonicalPastArtifactScenario";
import {
  buildModelIntelligenceOnePathRunRequest,
  listOrchestrationDispatchSteps,
} from "@/modules/modelIntelligence/onePathDispatchPlan";
import { buildModelIntelligenceSequencePreview } from "@/modules/modelIntelligence/runPlanBuilder";
import {
  defaultModelIntelligenceManualGapfillOptions,
  defaultModelIntelligenceOnePathOptions,
  defaultModelIntelligenceOrchestrationFlags,
} from "@/lib/admin/modelIntelligenceClient";
import type { ModelIntelligenceLabContext } from "@/modules/modelIntelligence/types";

describe("canonicalPastArtifactScenario", () => {
  it("returns true only for explicit canonical Past artifact scenario names", () => {
    expect(isCanonicalPastArtifactScenarioName(WORKSPACE_PAST_SCENARIO_NAME)).toBe(true);
    expect(isCanonicalPastArtifactScenarioName(MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME)).toBe(true);
    expect(isCanonicalPastArtifactScenarioName(MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME)).toBe(true);
    expect(isCanonicalPastArtifactScenarioName("Future (What-if)")).toBe(false);
    expect(isCanonicalPastArtifactScenarioName("Scratch Test Scenario")).toBe(false);
    expect(isCanonicalPastArtifactScenarioName("")).toBe(false);
    expect(isCanonicalPastArtifactScenarioName(null)).toBe(false);
  });

  it("allows canonical artifact persistence for Model Intelligence masked scenarios with MANUAL_TOTALS", () => {
    expect(
      shouldPersistCanonicalPastArtifactForScenario({
        persistPastSimBaseline: true,
        scenarioName: MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
        simMode: "MANUAL_TOTALS",
      })
    ).toBe(true);
    expect(
      shouldPersistCanonicalPastArtifactForScenario({
        persistPastSimBaseline: true,
        scenarioName: MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME,
        simMode: "MANUAL_TOTALS",
      })
    ).toBe(true);
  });

  it("keeps Past (Corrected) eligible and rejects unrelated scenario names", () => {
    expect(
      shouldPersistCanonicalPastArtifactForScenario({
        persistPastSimBaseline: true,
        scenarioName: WORKSPACE_PAST_SCENARIO_NAME,
        simMode: "SMT_BASELINE",
      })
    ).toBe(true);
    expect(
      shouldPersistCanonicalPastArtifactForScenario({
        persistPastSimBaseline: true,
        scenarioName: "Admin scratch scenario",
        simMode: "MANUAL_TOTALS",
      })
    ).toBe(false);
    expect(
      shouldPersistCanonicalPastArtifactForScenario({
        persistPastSimBaseline: false,
        scenarioName: MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
        simMode: "MANUAL_TOTALS",
      })
    ).toBe(false);
  });
});

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

describe("model intelligence masked dispatch artifact scenarios", () => {
  it("uses dedicated monthly and annual scenarios with persistRequested and forceActualDerivedManualPayload", () => {
    const context = baseContext();
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { MONTHLY_MASKED: true, ANNUAL_MASKED: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const dispatchSteps = listOrchestrationDispatchSteps(preview);
    expect(dispatchSteps.some((step) => step.runMode === "MONTHLY_MASKED")).toBe(true);
    expect(dispatchSteps.some((step) => step.runMode === "ANNUAL_MASKED")).toBe(true);

    const monthlyBuilt = buildModelIntelligenceOnePathRunRequest({
      context,
      runMode: "MONTHLY_MASKED",
      availability: preview.modeAvailability.find((row) => row.mode === "MONTHLY_MASKED")!,
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      scenarioId: "scenario-monthly",
      ownerUserId: "owner-1",
    });
    const annualBuilt = buildModelIntelligenceOnePathRunRequest({
      context,
      runMode: "ANNUAL_MASKED",
      availability: preview.modeAvailability.find((row) => row.mode === "ANNUAL_MASKED")!,
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      scenarioId: "scenario-annual",
      ownerUserId: "owner-1",
    });

    expect(monthlyBuilt.ok).toBe(true);
    expect(annualBuilt.ok).toBe(true);
    if (!monthlyBuilt.ok || !annualBuilt.ok) return;

    expect(monthlyBuilt.request.scenarioId).toBe("scenario-monthly");
    expect(annualBuilt.request.scenarioId).toBe("scenario-annual");
    expect(monthlyBuilt.request.houseId).toBe("lab-1");
    expect(annualBuilt.request.houseId).toBe("lab-1");
    expect(monthlyBuilt.request.actualContextHouseId).toBe("source-1");
    expect(annualBuilt.request.actualContextHouseId).toBe("source-1");
    expect(monthlyBuilt.request.persistRequested).toBe(true);
    expect(annualBuilt.request.persistRequested).toBe(true);
    expect((monthlyBuilt.request.orchestration as Record<string, unknown>).forceActualDerivedManualPayload).toBe(
      true
    );
    expect((annualBuilt.request.orchestration as Record<string, unknown>).forceActualDerivedManualPayload).toBe(true);
    expect(monthlyBuilt.request.runReason).toContain("model_intelligence_monthly_masked");
    expect(annualBuilt.request.runReason).toContain("model_intelligence_annual_masked");
  });
});
