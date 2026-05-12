import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchEflSourceFromUrl = vi.fn();
const runEflPipeline = vi.fn();
const adminUsageAuditForHome = vi.fn();
const adminPersistCurrentPlanFromEflPipeline = vi.fn();
const autoResolveCurrentPlanQueue = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/efl/fetchEflPdf", () => ({
  fetchEflSourceFromUrl: (...args: any[]) => fetchEflSourceFromUrl(...args),
}));

vi.mock("@/lib/plan-engine-next/efl/runEflPipeline", () => ({
  runEflPipeline: (...args: any[]) => runEflPipeline(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    eflParseReviewQueue: {
      updateMany: (...args: any[]) => updateMany(...args),
    },
  },
}));

vi.mock("@/lib/usage/adminUsageAudit", () => ({
  adminUsageAuditForHome: (...args: any[]) => adminUsageAuditForHome(...args),
}));

vi.mock("@/lib/current-plan/adminPersistCurrentPlanFromEflPipeline", () => ({
  adminPersistCurrentPlanFromEflPipeline: (...args: any[]) =>
    adminPersistCurrentPlanFromEflPipeline(...args),
}));

vi.mock("@/lib/current-plan/autoResolveCurrentPlanQueue", () => ({
  autoResolveCurrentPlanQueue: (...args: any[]) => autoResolveCurrentPlanQueue(...args),
}));

import { POST } from "@/app/api/admin/efl/manual-url/route";

describe("POST /api/admin/efl/manual-url", () => {
  beforeEach(() => {
    fetchEflSourceFromUrl.mockReset();
    runEflPipeline.mockReset();
    adminUsageAuditForHome.mockReset();
    adminPersistCurrentPlanFromEflPipeline.mockReset();
    autoResolveCurrentPlanQueue.mockReset();
    updateMany.mockReset();

    fetchEflSourceFromUrl.mockResolvedValue({
      ok: true,
      kind: "pdf",
      pdfBytes: new Uint8Array([1, 2, 3]),
    });
    runEflPipeline.mockResolvedValue({
      queued: false,
      ratePlanId: "rp_constellation",
      requiredBucketKeys: ["kwh.m.all.total"],
      rateStructure: { type: "FIXED" },
      rawTextPreview: "Constellation",
      planCalcStatus: "COMPUTABLE",
      planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
      eflPdfSha256: "sha",
      repPuctCertificate: "10014",
      eflVersionCode: "VER-1",
    });
    updateMany.mockResolvedValue({ count: 0 });
    adminUsageAuditForHome.mockResolvedValue(null);
    adminPersistCurrentPlanFromEflPipeline.mockResolvedValue(null);
    autoResolveCurrentPlanQueue.mockResolvedValue({ count: 0 });
    process.env.ADMIN_TOKEN = "secret";
  });

  it("keeps offer runs read-only when persistence was not requested", async () => {
    const req = {
      json: async () => ({
        eflUrl: "https://example.com/constellation.pdf",
        target: "offers",
        persistTemplate: false,
      }),
      headers: { get: () => null },
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(runEflPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        offerId: null,
      }),
    );
  });

  it("uses the shared pipeline persistence path for authorized live offer writes", async () => {
    const req = {
      json: async () => ({
        eflUrl: "https://example.com/constellation.pdf",
        target: "offers",
        offerId: "offer_constellation_12",
        persistTemplate: true,
      }),
      headers: { get: (name: string) => (name === "x-admin-token" ? "secret" : null) },
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(runEflPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        offerId: "offer_constellation_12",
      }),
    );
  });
});
