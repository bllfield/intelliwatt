import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveManualGapfillSeedFromSourceContext = vi.fn();

vi.mock("@/app/api/admin/tools/manual-gapfill/_helpers", () => ({
  gateManualGapfillAdmin: vi.fn(() => null),
}));

vi.mock("@/modules/manualUsage/manualGapfillSeed", () => ({
  resolveManualGapfillSeedFromSourceContext: (...args: unknown[]) =>
    resolveManualGapfillSeedFromSourceContext(...args),
}));

import { POST } from "@/app/api/admin/tools/manual-gapfill/prepare-seed/route";

const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";

describe("/api/admin/tools/manual-gapfill/prepare-seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveManualGapfillSeedFromSourceContext.mockResolvedValue({
      ok: true,
      status: "ready",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      sourceContext: {
        sourceHouseId: SOURCE_HOUSE_ID,
        actualSourceKind: "SMT",
        coverageStart: "2025-06-08",
        coverageEnd: "2026-06-07",
        intervalFingerprint: "fp-1",
        dailyFingerprint: "fp-2",
        monthlyFingerprint: "fp-3",
        annualTotalKwh: 34590,
        validationDayPolicyRevision: "unified_past_validation_stratified_14_v4",
        validationDayPolicyHash: "policy-hash-1",
      },
      labContext: {
        labHouseId: LAB_HOUSE_ID,
        wroteManualPayload: false,
        writeTarget: "none",
      },
      seed: {
        manualUsageMode: "manual_monthly",
        anchorEndDate: "2026-06-07",
        totalKwh: 34590,
      },
      diagnostics: {
        usedSourceActualTruth: true,
        usedTestHomeAsTruth: false,
        sourceCoverageSufficient: true,
        localGapFillSelectorUsed: false,
        globalValidationPolicyUsed: true,
        pastSimRecalcDispatched: false,
        compareRun: false,
        persistRequested: false,
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        sourceIntervalFingerprint: "fp-1",
        globalValidationPolicyHash: "policy-hash-1",
        seedPayloadHash: "seed-hash-1",
        warnings: [],
      },
    });
  });

  it("POST dry-run delegates to seed resolver with persistToLabHome false by default", async () => {
    const res = await POST({
      json: async () => ({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      }),
      cookies: { get: () => undefined },
      headers: new Headers(),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.status).toBe("ready");
    expect(resolveManualGapfillSeedFromSourceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        mode: "MONTHLY_FROM_SOURCE_INTERVALS",
        persistToLabHome: false,
      })
    );
  });

  it("POST passes persistToLabHome when requested", async () => {
    resolveManualGapfillSeedFromSourceContext.mockResolvedValueOnce({
      ok: true,
      status: "persisted",
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
      labContext: { labHouseId: LAB_HOUSE_ID, wroteManualPayload: true, writeTarget: "lab_home_only" },
      diagnostics: { pastSimRecalcDispatched: false, compareRun: false },
    });
    const res = await POST({
      json: async () => ({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        mode: "ANNUAL_FROM_SOURCE_INTERVALS",
        persistToLabHome: true,
      }),
      cookies: { get: () => undefined },
      headers: new Headers(),
    } as any);
    expect(res.status).toBe(200);
    expect(resolveManualGapfillSeedFromSourceContext).toHaveBeenCalledWith(
      expect.objectContaining({ persistToLabHome: true })
    );
  });

  it("POST rejects invalid mode", async () => {
    const res = await POST({
      json: async () => ({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        mode: "INVALID",
      }),
      cookies: { get: () => undefined },
      headers: new Headers(),
    } as any);
    expect(res.status).toBe(400);
    expect(resolveManualGapfillSeedFromSourceContext).not.toHaveBeenCalled();
  });
});
