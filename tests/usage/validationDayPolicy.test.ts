import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHouse = vi.fn();
const findFirstBuild = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const getFlag = vi.fn();

vi.mock("@/lib/flags", () => ({
  getFlag: (...args: unknown[]) => getFlag(...args),
  setFlag: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => findFirstHouse(...args),
    },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
    },
  },
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: unknown[]) => getActualUsageDatasetForHouse(...args),
}));

describe("validationDayPolicy", () => {
  const originalEnv = process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON;

  beforeEach(() => {
    vi.clearAllMocks();
    getFlag.mockResolvedValue("");
    delete process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON;
    findFirstBuild.mockResolvedValue(null);
    findFirstHouse.mockResolvedValue({ id: "house-1", esiid: "E1" });
    getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        daily: Array.from({ length: 120 }, (_, index) => ({
          date: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
          kwh: 90,
        })),
      },
    });
  });

  afterEach(() => {
    process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON = originalEnv;
  });

  it("returns stable policy revision and hash for code defaults", async () => {
    const { getValidationDayPolicySnapshotLive, computeValidationDayPolicyHash, resolveActiveValidationDayPolicy } =
      await import("@/lib/usage/validationDayPolicy");
    const snapshot = await getValidationDayPolicySnapshotLive();
    const policy = resolveActiveValidationDayPolicy({ overrideSource: "code_defaults" });
    expect(snapshot.policyRevision).toBe("unified_past_validation_stratified_14_v4");
    expect(snapshot.policyHash).toBe(computeValidationDayPolicyHash(policy));
    expect(snapshot.modeCatalog.length).toBeGreaterThan(0);
    expect(snapshot.guardrails.length).toBeGreaterThan(0);
  });

  it("produces the same selected keys for the same inputs", async () => {
    const { previewGlobalValidationDaySelection } = await import("@/lib/usage/validationDayPolicy");
    const args = {
      houseId: "house-1",
      userId: "user-1",
      window: { startDate: "2025-06-08", endDate: "2026-06-07" },
    };
    const first = await previewGlobalValidationDaySelection(args);
    const second = await previewGlobalValidationDaySelection(args);
    expect(first.selectedValidationDateKeys).toEqual(second.selectedValidationDateKeys);
    expect(first.policyHash).toBe(second.policyHash);
  });

  it("changes policy hash when effective config changes", async () => {
    const { computeValidationDayPolicyHash, resolveActiveValidationDayPolicy } = await import(
      "@/lib/usage/validationDayPolicy"
    );
    const baseline = computeValidationDayPolicyHash(
      resolveActiveValidationDayPolicy({ overrideSource: "code_defaults" })
    );
    const changed = computeValidationDayPolicyHash(
      resolveActiveValidationDayPolicy({
        overrideSource: "request_preview",
        validationDayCount: 9,
        validationSelectionMode: "customer_style_seasonal_mix",
      })
    );
    expect(changed).not.toBe(baseline);
  });

  it("resolveGlobalValidationDayKeysForPastSim bounds selected keys to canonical window", async () => {
    const validationSelection = await import("@/modules/usageSimulator/validationSelection");
    const spy = vi.spyOn(validationSelection, "selectValidationDayKeys").mockReturnValue({
      selectedDateKeys: ["2025-06-10", "2099-12-31"],
      diagnostics: { mode: "stratified_weather_balanced" } as any,
    });
    try {
      const { resolveGlobalValidationDayKeysForPastSim } = await import("@/lib/usage/validationDayPolicy");
      const out = await resolveGlobalValidationDayKeysForPastSim({
        houseId: "house-1",
        userId: "user-1",
        window: { startDate: "2025-06-08", endDate: "2026-06-07" },
      });
      expect(out.validationOnlyDateKeysLocal).toEqual(["2025-06-10"]);
      expect(out.warnings.some((warning) => warning.includes("outside canonical coverage window"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("preview uses shared selectValidationDayKeys and never marks local GapFill selector", async () => {
    const { previewGlobalValidationDaySelection } = await import("@/lib/usage/validationDayPolicy");
    const out = await previewGlobalValidationDaySelection({
      houseId: "house-1",
      userId: "user-1",
      window: { startDate: "2025-06-08", endDate: "2026-06-07" },
    });
    expect(out.selectedValidationDateKeys.length).toBeGreaterThan(0);
    expect(out.diagnostics.localGapFillSelectorUsed).toBe(false);
    expect(out.diagnostics.sharedPolicySelectorOwner).toBe("selectValidationDayKeys");
    expect(out.selectionMode).toBe("stratified_weather_balanced");
  });

  describe("gateSourceCopyValidationPolicyMatch", () => {
    it("allows source-copy when source build policy hash/revision match active policy", async () => {
      const { computeValidationDayPolicyHash, gateSourceCopyValidationPolicyMatch, resolveActiveValidationDayPolicyLive } =
        await import("@/lib/usage/validationDayPolicy");
      const { PAST_VALIDATION_POLICY_REVISION } = await import("@/lib/usage/pastValidationPolicy");
      const activePolicy = await resolveActiveValidationDayPolicyLive({ surface: "user_site" });
      const policyHash = computeValidationDayPolicyHash(activePolicy);
      const gate = await gateSourceCopyValidationPolicyMatch({
        sourceHouseId: "source-1",
        sourceBuildInputs: {
          validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
          validationDayPolicyHash: policyHash,
          validationOnlyDateKeysLocal: ["2025-04-11", "2025-04-12"],
        },
        surface: "user_site",
      });
      expect(gate.ok).toBe(true);
      if (gate.ok) {
        expect(gate.policyHash).toBe(policyHash);
      }
    });

    it("blocks source-copy when source policy hash is stale", async () => {
      const { gateSourceCopyValidationPolicyMatch, SOURCE_VALIDATION_POLICY_STALE_INSTRUCTION } =
        await import("@/lib/usage/validationDayPolicy");
      const { PAST_VALIDATION_POLICY_REVISION } = await import("@/lib/usage/pastValidationPolicy");
      const gate = await gateSourceCopyValidationPolicyMatch({
        sourceHouseId: "source-1",
        sourceBuildInputs: {
          validationDayPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
          validationDayPolicyHash: "stale-hash",
          validationOnlyDateKeysLocal: ["2025-04-11"],
        },
        surface: "user_site",
      });
      expect(gate.ok).toBe(false);
      if (!gate.ok) {
        expect(gate.stale.error).toBe("source_validation_policy_stale");
        expect(gate.stale.sourcePolicyHash).toBe("stale-hash");
        expect(gate.stale.sourceHouseId).toBe("source-1");
        expect(gate.stale.instruction).toBe(SOURCE_VALIDATION_POLICY_STALE_INSTRUCTION);
        expect(gate.stale.currentPolicyHash).toEqual(expect.any(String));
      }
    });

    it("blocks source-copy when source policy hash/revision are missing", async () => {
      const { gateSourceCopyValidationPolicyMatch } = await import("@/lib/usage/validationDayPolicy");
      const gate = await gateSourceCopyValidationPolicyMatch({
        sourceHouseId: "source-1",
        sourceBuildInputs: {
          validationOnlyDateKeysLocal: ["2025-04-11"],
        },
        surface: "user_site",
      });
      expect(gate.ok).toBe(false);
      if (!gate.ok) {
        expect(gate.stale.error).toBe("source_validation_policy_stale");
        expect(gate.stale.sourcePolicyHash).toBeNull();
        expect(gate.stale.sourcePolicyRevision).toBeNull();
      }
    });
  });
});
