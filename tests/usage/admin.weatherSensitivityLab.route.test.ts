import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const userFindUnique = vi.fn();
const houseAddressFindMany = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => userFindUnique(...args),
    },
    houseAddress: {
      findMany: (...args: any[]) => houseAddressFindMany(...args),
    },
  },
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: vi.fn().mockResolvedValue({ payload: null }),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: vi.fn().mockReturnValue(null),
}));

vi.mock("@/modules/weatherSensitivity/shared", () => ({
  resolveSharedWeatherSensitivityEnvelope: vi.fn().mockResolvedValue({ score: null, derivedInput: null }),
}));

import { GET } from "@/app/api/admin/tools/weather-sensitivity-lab/route";

describe("admin weather sensitivity lab route", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    userFindUnique.mockReset();
    houseAddressFindMany.mockReset();

    requireAdmin.mockReturnValue({ ok: false, status: 401, body: { error: "Unauthorized" } });
    userFindUnique.mockResolvedValue(null);
    houseAddressFindMany.mockResolvedValue([]);
  });

  it("allows browser admin session cookie without requiring x-admin-token", async () => {
    const req = {
      url: "https://example.com/api/admin/tools/weather-sensitivity-lab",
      cookies: {
        get: (name: string) =>
          name === "intelliwatt_admin" ? { value: "brian@intellipath-solutions.com" } : undefined,
      },
      headers: {
        get: () => null,
      },
    } as any;

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(requireAdmin).not.toHaveBeenCalled();
  });
});
