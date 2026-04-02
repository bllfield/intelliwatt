import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveManualMonthlyLabHome: vi.fn(),
  validateHomeProfile: vi.fn(),
  validateApplianceProfile: vi.fn(),
  normalizeStoredApplianceProfile: vi.fn(),
  homeDetailsPrisma: {
    homeProfileSimulated: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  } as any,
  appliancesPrisma: {
    applianceProfileSimulated: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  } as any,
}));

vi.mock("@/app/api/admin/tools/manual-monthly/_helpers", () => ({
  resolveManualMonthlyLabHome: (...args: any[]) => mocks.resolveManualMonthlyLabHome(...args),
}));
vi.mock("@/lib/db/homeDetailsClient", () => ({
  homeDetailsPrisma: mocks.homeDetailsPrisma,
}));
vi.mock("@/lib/db/appliancesClient", () => ({
  appliancesPrisma: mocks.appliancesPrisma,
}));
vi.mock("@/modules/homeProfile/validation", () => ({
  validateHomeProfile: (...args: any[]) => mocks.validateHomeProfile(...args),
}));
vi.mock("@/modules/applianceProfile/validation", () => ({
  validateApplianceProfile: (...args: any[]) => mocks.validateApplianceProfile(...args),
  normalizeStoredApplianceProfile: (...args: any[]) => mocks.normalizeStoredApplianceProfile(...args),
}));

function buildRequest(url: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${url}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("manual monthly test-home editor routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolveManualMonthlyLabHome.mockResolvedValue({
      ok: true,
      ownerUserId: "admin-owner-1",
      testHomeHouseId: "lab-home-1",
    });
    mocks.validateHomeProfile.mockReturnValue({ ok: true, value: { squareFeet: 2200, hvacType: "central" } });
    mocks.validateApplianceProfile.mockReturnValue({
      ok: true,
      value: { fuelConfiguration: "all_electric", appliances: [] },
    });
    mocks.normalizeStoredApplianceProfile.mockImplementation((value: any) => value ?? { fuelConfiguration: "", appliances: [] });
    mocks.homeDetailsPrisma.homeProfileSimulated.findUnique.mockResolvedValue(null);
    mocks.homeDetailsPrisma.homeProfileSimulated.upsert.mockResolvedValue({
      updatedAt: new Date("2025-05-01T00:00:00.000Z"),
    });
    mocks.appliancesPrisma.applianceProfileSimulated.findUnique.mockResolvedValue(null);
    mocks.appliancesPrisma.applianceProfileSimulated.upsert.mockResolvedValue({
      updatedAt: new Date("2025-05-01T00:00:00.000Z"),
    });
  });

  it("home-profile saves only to the isolated lab home", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/test-home/home-profile/route");
    const res = await POST(
      buildRequest("/api/admin/tools/manual-monthly/test-home/home-profile", {
        profile: { squareFeet: 2200, hvacType: "central" },
      })
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.homeDetailsPrisma.homeProfileSimulated.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_houseId: {
            userId: "admin-owner-1",
            houseId: "lab-home-1",
          },
        },
      })
    );
  });

  it("appliances saves only to the isolated lab home", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/test-home/appliances/route");
    const res = await POST(
      buildRequest("/api/admin/tools/manual-monthly/test-home/appliances", {
        profile: { fuelConfiguration: "all_electric", appliances: [] },
      })
    );
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.appliancesPrisma.applianceProfileSimulated.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_houseId: {
            userId: "admin-owner-1",
            houseId: "lab-home-1",
          },
        },
      })
    );
  });
});
