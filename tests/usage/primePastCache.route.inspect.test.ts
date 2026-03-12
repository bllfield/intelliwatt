import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const normalizeEmailSafe = vi.fn();
const prismaUserFindFirst = vi.fn();
const prismaHouseFindMany = vi.fn();
const buildAndSavePastForGapfillLab = vi.fn();
const inspectPastCacheArtifacts = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmailSafe: (...args: any[]) => normalizeEmailSafe(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: (...args: any[]) => prismaUserFindFirst(...args) },
    houseAddress: { findMany: (...args: any[]) => prismaHouseFindMany(...args) },
  },
}));

vi.mock("@/lib/admin/gapfillLabPrime", () => ({
  buildAndSavePastForGapfillLab: (...args: any[]) => buildAndSavePastForGapfillLab(...args),
  inspectPastCacheArtifacts: (...args: any[]) => inspectPastCacheArtifacts(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: vi.fn(),
}));

import { POST } from "@/app/api/admin/tools/prime-past-cache/route";

describe("prime-past-cache inspect mode", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    normalizeEmailSafe.mockReset();
    prismaUserFindFirst.mockReset();
    prismaHouseFindMany.mockReset();
    buildAndSavePastForGapfillLab.mockReset();
    inspectPastCacheArtifacts.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    normalizeEmailSafe.mockImplementation((v: string) => String(v).toLowerCase().trim());
    prismaUserFindFirst.mockResolvedValue({ id: "u1" });
    prismaHouseFindMany.mockResolvedValue([{ id: "h1" }]);
    inspectPastCacheArtifacts.mockResolvedValue({ count: 1, latestUpdatedAt: "2026-03-11T00:00:00.000Z" });
  });

  it("returns artifact-only inspect metadata and does not rebuild", async () => {
    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        action: "inspect",
        rangesToMask: [{ startDate: "2026-02-01", endDate: "2026-02-03" }],
      }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("artifact_only");
    expect(body.rebuilt).toBe(false);
    expect(buildAndSavePastForGapfillLab).not.toHaveBeenCalled();
    expect(inspectPastCacheArtifacts).toHaveBeenCalledWith({ houseId: "h1", scenarioId: "gapfill_lab" });
  });
});

