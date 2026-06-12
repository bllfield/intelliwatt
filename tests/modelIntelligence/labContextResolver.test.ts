import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOnePathTestHomeState = vi.fn();
const lookupAdminHousesByEmail = vi.fn();
const resolveAdminHouseSelection = vi.fn();
const resolveManualGapfillSmtSourceContext = vi.fn();
const findFirstHouse = vi.fn();

vi.mock("@/modules/onePathSim/testHomeState", () => ({
  resolveOnePathTestHomeState: (...args: unknown[]) => resolveOnePathTestHomeState(...args),
}));

vi.mock("@/lib/admin/adminHouseLookup", () => ({
  lookupAdminHousesByEmail: (...args: unknown[]) => lookupAdminHousesByEmail(...args),
  resolveAdminHouseSelection: (...args: unknown[]) => resolveAdminHouseSelection(...args),
}));

vi.mock("@/modules/manualUsage/manualGapfillSourceContext", () => ({
  resolveManualGapfillSmtSourceContext: (...args: unknown[]) => resolveManualGapfillSmtSourceContext(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => findFirstHouse(...args),
    },
  },
}));

describe("resolveModelIntelligenceLabContext pin state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "brian@intellipath-solutions.com",
      userId: "customer-user",
      houses: [{ id: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8", label: "Brian", esiid: "E1" }],
    });
    resolveAdminHouseSelection.mockResolvedValue({
      id: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      label: "Brian",
      esiid: "E1",
    });
    resolveManualGapfillSmtSourceContext.mockResolvedValue({
      status: "available",
      actualSourceKind: "SMT",
      committedUsageSource: "SMT",
      onePathUpstream: { actualContextHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8" },
      coverage: { intervalCount: 35040, dailyCount: 365, coverageStart: "2025-04-15", coverageEnd: "2026-04-14" },
      actualData: { annualTotal: 14448.98 },
      fingerprints: { intervalFingerprint: "fp-1" },
      alternatives: { smt: { intervalsCount: 35040 }, greenButton: { intervalsCount: 0 } },
      diagnostics: { warnings: [] },
    });
    findFirstHouse.mockResolvedValue({
      addressLine1: "123 Main",
      addressCity: "Austin",
      addressState: "TX",
      esiid: "E1",
    });
  });

  it("uses One Path effective pin state when direct link lookup has no linkedSourceHouseId", async () => {
    resolveOnePathTestHomeState.mockResolvedValue({
      ownerUserId: "admin-owner",
      testHomeHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      testHomeHouse: { id: "29a3d820-2593-4673-9dd6-cd161bbd7f6f", label: "Lab", esiid: null },
      linkedSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      linkedSourceUserId: "customer-user",
      status: "ready",
      statusMessage: "Using request-scoped One Path test-home binding.",
      lastReplacedAt: null,
      isPinned: true,
      needsReplace: false,
    });

    const { resolveModelIntelligenceLabContext } = await import("@/modules/modelIntelligence/labContextResolver");
    const resolved = await resolveModelIntelligenceLabContext({
      email: "brian@intellipath-solutions.com",
      houseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      ownerUserId: "admin-owner",
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolveOnePathTestHomeState).toHaveBeenCalledWith({
      ownerUserId: "admin-owner",
      selectedSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      selectedSourceUserId: "customer-user",
      fallbackSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
    });
    expect(resolved.context.labTestHome).toEqual({
      testHomeHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      linkedSourceHouseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
      isPinnedToSource: true,
      status: "ready",
      statusMessage: "Using request-scoped One Path test-home binding.",
      needsReplace: false,
    });
    expect(resolved.context.actualContextHouseId).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
    expect(resolved.context.annualTotalKwh).toBe(14448.98);
  });
});
