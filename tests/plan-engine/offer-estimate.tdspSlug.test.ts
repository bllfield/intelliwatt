import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaUserFindUnique = vi.fn();
const prismaHouseFindFirst = vi.fn();

const computeAnnualKwhForEsiid = vi.fn();
const getTdspApplied = vi.fn();
const estimateOfferFromOfferId = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "intelliwatt_user" ? { value: "user@example.com" } : undefined),
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => prismaUserFindUnique(...args) },
    houseAddress: { findFirst: (...args: any[]) => prismaHouseFindFirst(...args) },
  },
}));

vi.mock("@/app/api/plan-engine/_shared/estimate", () => ({
  computeAnnualKwhForEsiid: (...args: any[]) => computeAnnualKwhForEsiid(...args),
  getTdspApplied: (...args: any[]) => getTdspApplied(...args),
  estimateOfferFromOfferId: (...args: any[]) => estimateOfferFromOfferId(...args),
}));

import { GET } from "@/app/api/plan-engine/offer-estimate/route";

beforeEach(() => {
  prismaUserFindUnique.mockReset();
  prismaHouseFindFirst.mockReset();
  computeAnnualKwhForEsiid.mockReset();
  getTdspApplied.mockReset();
  estimateOfferFromOfferId.mockReset();

  prismaUserFindUnique.mockResolvedValue({ id: "u1" });
  prismaHouseFindFirst.mockResolvedValue({ id: "h1", esiid: "10443720000000001", tdspSlug: "  OnCoR " });
  computeAnnualKwhForEsiid.mockResolvedValue(10000);
  getTdspApplied.mockResolvedValue({ perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 });
  estimateOfferFromOfferId.mockResolvedValue({
    offerId: "o1",
    ok: true,
    ratePlan: { id: "rp1", supplier: "X", planName: "Test" },
    monthsCount: 12,
    monthsIncluded: [],
    annualKwh: 10000,
    usageBucketsByMonthIncluded: false,
    detected: { freeWeekends: false, dayNightTou: false },
    backfill: { requested: false, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
    estimate: { ok: true },
  });
});

describe("GET /api/plan-engine/offer-estimate", () => {
  it("returns tdspSlug normalized (trim + lowercase)", async () => {
    const req = { url: "http://localhost/api/plan-engine/offer-estimate?offerId=o1" } as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tdspSlug).toBe("oncor");
    expect(getTdspApplied).toHaveBeenCalledWith("oncor");
    expect(estimateOfferFromOfferId).toHaveBeenCalled();
    expect(estimateOfferFromOfferId.mock.calls[0][0].tdspSlug).toBe("oncor");
  });
});

