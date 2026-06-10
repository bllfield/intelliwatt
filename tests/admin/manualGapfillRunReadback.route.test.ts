import { beforeEach, describe, expect, it, vi } from "vitest";

const buildManualGapfillRunReadbackResult = vi.fn();

vi.mock("@/app/api/admin/tools/manual-gapfill/_helpers", () => ({
  gateManualGapfillAdmin: vi.fn(() => null),
}));

vi.mock("@/modules/manualUsage/manualGapfillRunReadback", () => ({
  buildManualGapfillRunReadbackResult: (...args: unknown[]) => buildManualGapfillRunReadbackResult(...args),
}));

import { POST } from "@/app/api/admin/tools/manual-gapfill/run-readback/route";

const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";

describe("/api/admin/tools/manual-gapfill/run-readback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildManualGapfillRunReadbackResult.mockResolvedValue({
      ok: true,
      status: "ready",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      sourceContext: { sourceHouseId: SOURCE_HOUSE_ID, validationDayPolicyHash: "policy-1" },
      labContext: {
        labHouseId: LAB_HOUSE_ID,
        manualSeedFound: true,
        manualSeedHash: "seed-1",
        actualContextHouseId: SOURCE_HOUSE_ID,
      },
      run: {
        dispatched: true,
        scenarioId: "past-1",
        simulatorMode: "MANUAL_TOTALS",
        inputType: "MANUAL_MONTHLY",
        persisted: true,
      },
      readback: { source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" },
      diagnostics: {
        pastSimRecalcDispatched: true,
        compareRun: false,
        labManualPayloadWritten: false,
        sourceHouseWritten: false,
      },
    });
  });

  it("POST delegates to run/readback builder with persistRequested true by default", async () => {
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
    expect(buildManualGapfillRunReadbackResult).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        persistRequested: true,
      })
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
    expect(buildManualGapfillRunReadbackResult).not.toHaveBeenCalled();
  });
});
