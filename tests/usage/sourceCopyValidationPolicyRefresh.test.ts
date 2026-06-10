import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dispatchPastSimRecalc = vi.fn();

const prisma: any = {
  usageSimulatorScenario: { findFirst: vi.fn() },
  usageSimulatorBuild: { findUnique: vi.fn(), findFirst: vi.fn() },
  houseAddress: { findFirst: vi.fn() },
};

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/flags", () => ({
  getFlag: vi.fn().mockResolvedValue(""),
  setFlag: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/validationSelection", () => ({
  selectValidationDayKeys: vi.fn((args: any) => ({
    selectedDateKeys: (args.candidateDateKeys ?? []).slice(0, args.targetCount ?? 14),
    diagnostics: { modeUsed: args.mode },
  })),
  normalizeValidationSelectionMode: (mode: unknown) => String(mode ?? ""),
}));

vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: unknown[]) => dispatchPastSimRecalc(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: vi.fn().mockResolvedValue({ dataset: null }),
}));

describe("sourceCopyValidationPolicyRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.usageSimulatorScenario.findFirst.mockResolvedValue({ id: "past-s1" });
    prisma.houseAddress.findFirst.mockResolvedValue({ id: "h1", esiid: "E1" });
    prisma.usageSimulatorBuild.findFirst.mockResolvedValue({ buildInputs: { travelRanges: [] } });
  });

  it("skips refresh when source policy stamps and keys already match", async () => {
    const {
      computeValidationDayPolicyHash,
      resolveActiveValidationDayPolicyLive,
    } = await import("@/lib/usage/validationDayPolicy");
    const { PAST_VALIDATION_POLICY_REVISION } = await import("@/lib/usage/pastValidationPolicy");
    const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "user_site" });
    const policyHash = computeValidationDayPolicyHash(activePolicy);
    prisma.usageSimulatorBuild.findUnique.mockResolvedValue({
      buildInputs: {
        validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
        validationDayPolicyHash: policyHash,
        validationOnlyDateKeysLocal: ["2025-04-11", "2025-04-12"],
      },
    });
    const { ensureSourceCopyValidationPolicyFresh } = await import(
      "@/lib/usage/sourceCopyValidationPolicyRefresh"
    );
    const out = await ensureSourceCopyValidationPolicyFresh({
      sourceUserId: "u1",
      sourceHouseId: "h1",
      sourceEsiid: "E1",
      sourceTravelRanges: [],
      window: { startDate: "2025-03-01", endDate: "2026-02-28" },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.refreshDiagnostics).toBeNull();
    }
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("dispatches source refresh under active global policy when stamps are stale", async () => {
    const {
      computeValidationDayPolicyHash,
      resolveActiveValidationDayPolicyLive,
    } = await import("@/lib/usage/validationDayPolicy");
    const { PAST_VALIDATION_POLICY_REVISION } = await import("@/lib/usage/pastValidationPolicy");
    const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "user_site" });
    const policyHash = computeValidationDayPolicyHash(activePolicy);
    prisma.usageSimulatorBuild.findUnique
      .mockResolvedValueOnce({
        buildInputs: {
          validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
          validationDayPolicyHash: "stale-hash",
          validationOnlyDateKeysLocal: ["2025-04-11"],
        },
      })
      .mockResolvedValueOnce({
        buildInputs: {
          validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
          validationDayPolicyHash: policyHash,
          validationOnlyDateKeysLocal: ["2025-04-11", "2025-04-12"],
          effectiveValidationSelectionMode: "stratified_weather_balanced",
        },
      });
    dispatchPastSimRecalc.mockResolvedValue({
      executionMode: "inline",
      correlationId: "cid-1",
      result: { ok: true, buildInputsHash: "hash-1" },
    });
    const { ensureSourceCopyValidationPolicyFresh, SOURCE_COPY_POLICY_REFRESH_CALLER_LABEL } =
      await import("@/lib/usage/sourceCopyValidationPolicyRefresh");
    const out = await ensureSourceCopyValidationPolicyFresh({
      sourceUserId: "u1",
      sourceHouseId: "h1",
      sourceEsiid: "E1",
      sourceTravelRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
      window: { startDate: "2025-03-01", endDate: "2026-02-28" },
    });
    expect(out.ok).toBe(true);
    expect(dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        validationDaySelectionMode: expect.any(String),
        validationDayCount: expect.any(Number),
        runContext: expect.objectContaining({
          callerLabel: SOURCE_COPY_POLICY_REFRESH_CALLER_LABEL,
        }),
      })
    );
    expect(dispatchPastSimRecalc.mock.calls[0]?.[0]?.adminLabTreatmentMode).toBeUndefined();
    if (out.ok) {
      expect(out.refreshDiagnostics?.sourcePolicyRefreshSucceeded).toBe(true);
    }
  });
});
