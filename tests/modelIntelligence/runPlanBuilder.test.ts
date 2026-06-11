import { describe, expect, it } from "vitest";
import { resolveModelIntelligenceModeAvailability } from "@/modules/modelIntelligence/modeAvailability";
import { buildModelIntelligenceSequencePreview } from "@/modules/modelIntelligence/runPlanBuilder";
import {
  defaultModelIntelligenceManualGapfillOptions,
  defaultModelIntelligenceOnePathOptions,
  defaultModelIntelligenceOrchestrationFlags,
} from "@/lib/admin/modelIntelligenceClient";
import {
  GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON,
  NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON,
  type ModelIntelligenceLabContext,
} from "@/modules/modelIntelligence/types";

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

describe("resolveModelIntelligenceModeAvailability", () => {
  it("disables Green Button with the default unavailable reason when GB is missing", () => {
    const rows = resolveModelIntelligenceModeAvailability(baseContext());
    const gb = rows.find((row) => row.mode === "GREEN_BUTTON_TRUTH");
    expect(gb?.available).toBe(false);
    expect(gb?.unavailableReason).toBe(GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON);
  });

  it("marks New Build unavailable with the orchestration reason", () => {
    const rows = resolveModelIntelligenceModeAvailability(baseContext());
    const nb = rows.find((row) => row.mode === "NEW_BUILD");
    expect(nb?.available).toBe(false);
    expect(nb?.unavailableReason).toBe(NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON);
  });

  it("requires pinned lab home for masked manual modes", () => {
    const rows = resolveModelIntelligenceModeAvailability(
      baseContext({
        labTestHome: {
          testHomeHouseId: "lab-1",
          linkedSourceHouseId: "other-source",
          isPinnedToSource: false,
          status: "unlinked",
          statusMessage: null,
          needsReplace: true,
        },
      })
    );
    const monthly = rows.find((row) => row.mode === "MONTHLY_MASKED");
    expect(monthly?.available).toBe(false);
    expect(monthly?.unavailableReason).toContain("not pinned");
  });
});

describe("buildModelIntelligenceSequencePreview", () => {
  it("returns phase 2 orchestration preview with runnable One Path dispatch steps only", () => {
    const preview = buildModelIntelligenceSequencePreview({
      context: baseContext(),
      selectedRuns: {
        SMT_INTERVAL_TRUTH: true,
        GREEN_BUTTON_TRUTH: true,
        MONTHLY_MASKED: true,
        ANNUAL_MASKED: false,
        NEW_BUILD: true,
      },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });

    expect(preview.phase).toBe("phase_2_client_orchestration");
    expect(preview.executionEnabled).toBe(true);
    expect(preview.summary.simulationWillRun).toBe(true);
    expect(preview.summary.runnableDispatchStepCount).toBe(2);
    expect(preview.summary.compareDiagnosticsPlanned).toBe(false);
    expect(preview.guardrails.onePathOnlySimulation).toBe(true);
    expect(preview.steps.some((step) => step.kind === "resolve_context")).toBe(true);
    expect(preview.steps.some((step) => step.runMode === "NEW_BUILD" && step.status === "unavailable")).toBe(true);
    expect(preview.steps.some((step) => step.runMode === "GREEN_BUTTON_TRUTH" && step.status === "unavailable")).toBe(
      true
    );
    expect(
      preview.steps.some(
        (step) => step.kind === "compare_diagnostics" && step.unavailableReason?.includes("compare adapter not enabled")
      )
    ).toBe(true);
    expect(
      preview.steps.some(
        (step) => step.kind === "dispatch_one_path_sim" && step.runMode === "SMT_INTERVAL_TRUTH" && step.clientRunnable
      )
    ).toBe(true);
  });
});
