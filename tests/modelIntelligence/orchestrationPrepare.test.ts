import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultModelIntelligenceManualGapfillOptions,
  defaultModelIntelligenceOnePathOptions,
  defaultModelIntelligenceOrchestrationFlags,
} from "@/lib/admin/modelIntelligenceClient";
import { buildModelIntelligenceSequencePreview } from "@/modules/modelIntelligence/runPlanBuilder";
import type { ModelIntelligenceLabContext } from "@/modules/modelIntelligence/types";

vi.mock("server-only", () => ({}));

const ensureModelIntelligenceScenarioForRunMode = vi.fn();
const scenarioFindFirst = vi.fn();

vi.mock("@/modules/modelIntelligence/modelIntelligenceScenarios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/modelIntelligence/modelIntelligenceScenarios")>();
  return {
    ...actual,
    ensureModelIntelligenceScenarioForRunMode: (...args: unknown[]) =>
      ensureModelIntelligenceScenarioForRunMode(...args),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: unknown[]) => scenarioFindFirst(...args),
    },
  },
}));

function pinnedContext(overrides: Partial<ModelIntelligenceLabContext> = {}): ModelIntelligenceLabContext {
  return {
    email: "brian@intellipath-solutions.com",
    userId: "customer-user",
    sourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
    esiid: "E1",
    addressLabel: "Brian",
    committedUsageSource: "SMT",
    actualSourceKind: "SMT",
    actualContextHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
    sourceTruthAvailable: true,
    profileOnlyHouse: false,
    coverageStart: "2025-04-15",
    coverageEnd: "2026-04-14",
    dailyCount: 365,
    intervalCount: 35040,
    annualTotalKwh: 14448.98,
    intervalFingerprint: "fp-1",
    greenButtonAvailable: false,
    smtIntervalTruthAvailable: true,
    labTestHome: {
      testHomeHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      linkedSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      isPinnedToSource: true,
      status: "ready",
      statusMessage: null,
      needsReplace: false,
    },
    warnings: [],
    ...overrides,
  };
}

describe("orchestrationPrepare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureModelIntelligenceScenarioForRunMode.mockImplementation(
      async (args: { userId: string; houseId: string; runMode: string }) => {
        if (args.houseId === "29a3d820-2593-4673-9dd6-cd161bbd7f6f") {
          if (args.runMode === "MONTHLY_MASKED") return "scenario-lab-monthly";
          if (args.runMode === "ANNUAL_MASKED") return "scenario-lab-annual";
          return "scenario-lab-past";
        }
        if (args.houseId === "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8") {
          return "scenario-source-a";
        }
        return null;
      }
    );
    scenarioFindFirst.mockImplementation(async (query: { where?: { id?: string; houseId?: string; userId?: string } }) => {
      const id = String(query?.where?.id ?? "");
      const houseId = query?.where?.houseId ? String(query.where.houseId) : null;
      const rowForId = (rowId: string, rowHouseId: string, name: string) => ({
        id: rowId,
        userId: "admin-owner",
        houseId: rowHouseId,
        name,
      });
      if (id === "orphan-scenario-id") {
        return null;
      }
      if (id === "scenario-lab-past" && (!houseId || houseId === "29a3d820-2593-4673-9dd6-cd161bbd7f6f")) {
        return rowForId("scenario-lab-past", "29a3d820-2593-4673-9dd6-cd161bbd7f6f", "Past (Corrected)");
      }
      if (id === "scenario-lab-monthly" && (!houseId || houseId === "29a3d820-2593-4673-9dd6-cd161bbd7f6f")) {
        return rowForId(
          "scenario-lab-monthly",
          "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
          "Model Intelligence · Monthly Masked"
        );
      }
      if (id === "scenario-lab-annual" && (!houseId || houseId === "29a3d820-2593-4673-9dd6-cd161bbd7f6f")) {
        return rowForId(
          "scenario-lab-annual",
          "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
          "Model Intelligence · Annual Masked"
        );
      }
      if (id === "scenario-source-a" && (!houseId || houseId === "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8")) {
        return rowForId("scenario-source-a", "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8", "Past (Corrected)");
      }
      return null;
    });
  });

  it("prepare_dispatch_step uses lab-home scenario for pinned SMT interval truth", async () => {
    const { prepareModelIntelligenceDispatchStep } = await import("@/modules/modelIntelligence/orchestrationPrepare");
    const context = pinnedContext();
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { SMT_INTERVAL_TRUTH: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const prepared = await prepareModelIntelligenceDispatchStep({
      context,
      preview,
      runMode: "SMT_INTERVAL_TRUTH",
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      ownerUserId: "admin-owner",
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(ensureModelIntelligenceScenarioForRunMode).toHaveBeenCalledWith({
      userId: "admin-owner",
      houseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      runMode: "SMT_INTERVAL_TRUTH",
    });
    expect(prepared.onePathRunRequest.scenarioId).toBe("scenario-lab-past");
    expect(prepared.onePathRunRequest.houseId).toBe("29a3d820-2593-4673-9dd6-cd161bbd7f6f");
    expect(prepared.onePathRunRequest.actualContextHouseId).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
  });

  it("prepare_dispatch_step uses distinct lab scenarios for masked modes", async () => {
    const { prepareModelIntelligenceDispatchStep } = await import("@/modules/modelIntelligence/orchestrationPrepare");
    const context = pinnedContext();
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { MONTHLY_MASKED: true, ANNUAL_MASKED: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });

    const monthlyPrepared = await prepareModelIntelligenceDispatchStep({
      context,
      preview,
      runMode: "MONTHLY_MASKED",
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      ownerUserId: "admin-owner",
    });
    const annualPrepared = await prepareModelIntelligenceDispatchStep({
      context,
      preview,
      runMode: "ANNUAL_MASKED",
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      ownerUserId: "admin-owner",
    });

    expect(monthlyPrepared.ok).toBe(true);
    expect(annualPrepared.ok).toBe(true);
    if (!monthlyPrepared.ok || !annualPrepared.ok) return;
    expect(monthlyPrepared.onePathRunRequest.scenarioId).toBe("scenario-lab-monthly");
    expect(annualPrepared.onePathRunRequest.scenarioId).toBe("scenario-lab-annual");
    expect(monthlyPrepared.onePathRunRequest.scenarioId).not.toBe(annualPrepared.onePathRunRequest.scenarioId);
  });

  it("blocks lab dispatch when scenarioId belongs to source house", async () => {
    const { validateLabDispatchScenarioHouseMatch } = await import("@/modules/modelIntelligence/orchestrationPrepare");
    const blocked = await validateLabDispatchScenarioHouseMatch({
      scenarioId: "scenario-source-a",
      dispatchHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      sourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      actualContextHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      ownerUserId: "admin-owner",
      contextUserId: "customer-user",
    });

    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toBe("scenario_house_mismatch");
    expect(blocked.scenarioHouseMismatch).toBe(true);
    expect(blocked.expectedScenarioHouseId).toBe("29a3d820-2593-4673-9dd6-cd161bbd7f6f");
    expect(blocked.actualContextHouseId).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
    expect(blocked.message).toBe(
      "Model Intelligence refused to dispatch a lab-home run with a source-house scenarioId."
    );
  });

  it("prepare_dispatch_step heals a stale orphan scenario id for the current pinned lab home", async () => {
    let monthlyEnsureCalls = 0;
    ensureModelIntelligenceScenarioForRunMode.mockImplementation(
      async (args: { userId: string; houseId: string; runMode: string }) => {
        if (args.runMode !== "MONTHLY_MASKED") {
          return args.houseId === "29a3d820-2593-4673-9dd6-cd161bbd7f6f" ? "scenario-lab-past" : null;
        }
        monthlyEnsureCalls += 1;
        return monthlyEnsureCalls === 1 ? "orphan-scenario-id" : "scenario-lab-monthly";
      }
    );

    const { prepareModelIntelligenceDispatchStep } = await import("@/modules/modelIntelligence/orchestrationPrepare");
    const context = pinnedContext();
    const preview = buildModelIntelligenceSequencePreview({
      context,
      selectedRuns: { MONTHLY_MASKED: true },
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      flags: defaultModelIntelligenceOrchestrationFlags(),
    });
    const prepared = await prepareModelIntelligenceDispatchStep({
      context,
      preview,
      runMode: "MONTHLY_MASKED",
      onePathOptions: defaultModelIntelligenceOnePathOptions(),
      manualGapfillOptions: defaultModelIntelligenceManualGapfillOptions(),
      ownerUserId: "admin-owner",
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(monthlyEnsureCalls).toBe(2);
    expect(prepared.onePathRunRequest.scenarioId).toBe("scenario-lab-monthly");
    expect(prepared.scenarioIdHealed).toBe(true);
  });
});
