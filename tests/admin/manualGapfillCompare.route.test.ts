import { beforeEach, describe, expect, it, vi } from "vitest";

const compareManualGapfillSourceActualToLabSim = vi.fn();

vi.mock("@/app/api/admin/tools/manual-gapfill/_helpers", () => ({
  gateManualGapfillAdmin: vi.fn(() => null),
}));

vi.mock("@/modules/manualUsage/manualGapfillCompare", () => ({
  compareManualGapfillSourceActualToLabSim: (...args: unknown[]) =>
    compareManualGapfillSourceActualToLabSim(...args),
}));

import { POST } from "@/app/api/admin/tools/manual-gapfill/compare/route";

const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";

describe("/api/admin/tools/manual-gapfill/compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compareManualGapfillSourceActualToLabSim.mockResolvedValue({
      ok: true,
      status: "ready",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      compare: { compareScope: "source_actual_vs_lab_simulated", status: "pass" },
      diagnostics: { compareRun: true, pastSimRecalcDispatched: false },
    });
  });

  it("POST delegates to compare module with includeDiagnostics default true", async () => {
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
    expect(body.result.compare.compareScope).toBe("source_actual_vs_lab_simulated");
    expect(compareManualGapfillSourceActualToLabSim).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sourceHouseId: SOURCE_HOUSE_ID,
        labHouseId: LAB_HOUSE_ID,
        includeDiagnostics: true,
        includeDailyRows: false,
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
    expect(compareManualGapfillSourceActualToLabSim).not.toHaveBeenCalled();
  });
});
