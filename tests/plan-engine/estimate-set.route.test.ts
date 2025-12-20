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

import { POST } from "@/app/api/plan-engine/estimate-set/route";

beforeEach(() => {
  prismaUserFindUnique.mockReset();
  prismaHouseFindFirst.mockReset();
  computeAnnualKwhForEsiid.mockReset();
  getTdspApplied.mockReset();
  estimateOfferFromOfferId.mockReset();

  prismaUserFindUnique.mockResolvedValue({ id: "u1" });
  prismaHouseFindFirst.mockResolvedValue({ id: "h1", esiid: "10443720000000001", tdspSlug: "ONCOR" });
  computeAnnualKwhForEsiid.mockResolvedValue(12000);
  getTdspApplied.mockResolvedValue({ perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 });
  estimateOfferFromOfferId.mockImplementation(async (args: any) => ({
    offerId: String(args.offerId),
    ok: true,
    monthsCount: args.monthsCount,
    monthsIncluded: [],
    annualKwh: args.annualKwh,
    usageBucketsByMonthIncluded: false,
    detected: { freeWeekends: false, dayNightTou: false },
    backfill: { requested: Boolean(args.autoEnsureBuckets), attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
    estimate: { ok: true, offerId: String(args.offerId) },
  }));
});

describe("POST /api/plan-engine/estimate-set", () => {
  it("coerces monthsCount > 12 down to 12 and returns contract shape", async () => {
    const req = {
      json: async () => ({ offerIds: ["o1", "o2"], monthsCount: 99, backfill: true }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.monthsCount).toBe(12);
    expect(body.backfillRequested).toBe(true);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(2);

    expect(estimateOfferFromOfferId).toHaveBeenCalledTimes(2);
    expect(estimateOfferFromOfferId.mock.calls[0][0].monthsCount).toBe(12);
  });

  it("rejects more than 25 unique offerIds (400)", async () => {
    const offerIds = Array.from({ length: 26 }, (_, i) => `o${i}`);
    const req = { json: async () => ({ offerIds }) } as any;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("offerIds_too_many");
    expect(body.max).toBe(25);
  });
});

