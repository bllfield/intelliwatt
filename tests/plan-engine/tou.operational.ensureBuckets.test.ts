import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureCoreMonthlyBuckets = vi.fn();
const requiredBucketsForRateStructure = vi.fn();
const calculatePlanCostForUsage = vi.fn();

const prismaOfferIdRatePlanMapFindUnique = vi.fn();
const prismaRatePlanFindUnique = vi.fn();
const prismaSmtIntervalFindFirst = vi.fn();

const usageHomeMonthlyUsageBucketFindMany = vi.fn();
const usageGreenButtonIntervalFindFirst = vi.fn();

vi.mock("@/lib/usage/aggregateMonthlyBuckets", () => ({
  ensureCoreMonthlyBuckets: (...args: any[]) => ensureCoreMonthlyBuckets(...args),
}));

vi.mock("@/lib/plan-engine/requiredBucketsForPlan", () => ({
  requiredBucketsForRateStructure: (...args: any[]) => requiredBucketsForRateStructure(...args),
}));

vi.mock("@/lib/plan-engine/calculatePlanCostForUsage", () => ({
  calculatePlanCostForUsage: (...args: any[]) => calculatePlanCostForUsage(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    offerIdRatePlanMap: { findUnique: (...args: any[]) => prismaOfferIdRatePlanMapFindUnique(...args) },
    ratePlan: { findUnique: (...args: any[]) => prismaRatePlanFindUnique(...args) },
    smtInterval: { findFirst: (...args: any[]) => prismaSmtIntervalFindFirst(...args) },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    homeMonthlyUsageBucket: { findMany: (...args: any[]) => usageHomeMonthlyUsageBucketFindMany(...args) },
    greenButtonInterval: { findFirst: (...args: any[]) => usageGreenButtonIntervalFindFirst(...args) },
  },
}));

import { estimateOfferFromOfferId } from "@/app/api/plan-engine/_shared/estimate";

beforeEach(() => {
  ensureCoreMonthlyBuckets.mockReset();
  requiredBucketsForRateStructure.mockReset();
  calculatePlanCostForUsage.mockReset();

  prismaOfferIdRatePlanMapFindUnique.mockReset();
  prismaRatePlanFindUnique.mockReset();
  prismaSmtIntervalFindFirst.mockReset();

  usageHomeMonthlyUsageBucketFindMany.mockReset();
  usageGreenButtonIntervalFindFirst.mockReset();

  prismaOfferIdRatePlanMapFindUnique.mockResolvedValue({ offerId: "o1", ratePlanId: "rp1" });
  prismaRatePlanFindUnique.mockResolvedValue({ id: "rp1", supplier: "X", planName: "Y", rateStructure: {} });

  requiredBucketsForRateStructure.mockReturnValue([
    { key: "kwh.m.all.total", optional: false },
    { key: "kwh.m.all.0000-1200", optional: false },
  ]);
});

describe("TOU operational completion: auto ensure monthly buckets", () => {
  it("calls ensureCoreMonthlyBuckets when required buckets are missing and autoEnsureBuckets=true", async () => {
    let rowFetchCount = 0;
    usageHomeMonthlyUsageBucketFindMany.mockImplementation(async (args: any) => {
      if (args?.distinct && args?.select?.yearMonth) {
        return [{ yearMonth: "2025-01" }];
      }
      rowFetchCount += 1;
      if (rowFetchCount === 1) return []; // missing buckets before ensure
      return [
        { yearMonth: "2025-01", bucketKey: "kwh.m.all.total", kwhTotal: "1000.0" },
        { yearMonth: "2025-01", bucketKey: "kwh.m.all.0000-1200", kwhTotal: "400.0" },
      ];
    });

    prismaSmtIntervalFindFirst.mockResolvedValue({ ts: new Date("2025-01-31T23:00:00.000Z") });
    ensureCoreMonthlyBuckets.mockResolvedValue({
      monthsProcessed: 1,
      rowsUpserted: 2,
      intervalRowsRead: 10,
      kwhSummed: 1000,
      notes: [],
    });

    calculatePlanCostForUsage.mockReturnValue({ status: "OK" });

    const res = await estimateOfferFromOfferId({
      offerId: "o1",
      monthsCount: 1,
      autoEnsureBuckets: true,
      homeId: "h1",
      esiid: "10443720000000001",
      tdspSlug: "oncor",
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      annualKwh: 12000,
    } as any);

    expect(res.ok).toBe(true);
    expect(ensureCoreMonthlyBuckets).toHaveBeenCalledTimes(1);
    expect(res.backfill.requested).toBe(true);
    expect(res.backfill.attempted).toBe(true);
    expect(res.usageBucketsByMonthIncluded).toBe(true);
  });

  it("returns MISSING_USAGE_INTERVALS when auto-ensure finds no intervals", async () => {
    usageHomeMonthlyUsageBucketFindMany.mockImplementation(async (args: any) => {
      if (args?.distinct && args?.select?.yearMonth) return [{ yearMonth: "2025-01" }];
      return []; // no buckets
    });

    prismaSmtIntervalFindFirst.mockResolvedValue(null); // no intervals at all
    calculatePlanCostForUsage.mockReturnValue({ status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS" });

    const res = await estimateOfferFromOfferId({
      offerId: "o1",
      monthsCount: 1,
      autoEnsureBuckets: true,
      homeId: "h1",
      esiid: "10443720000000001",
      tdspSlug: "oncor",
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      annualKwh: 12000,
    } as any);

    expect((res.estimate as any)?.status).toBe("NOT_COMPUTABLE");
    expect((res.estimate as any)?.reason).toBe("MISSING_USAGE_INTERVALS");
    expect(ensureCoreMonthlyBuckets).toHaveBeenCalledTimes(0);
  });

  it("returns UNSUPPORTED_BUCKET_KEY when a required key is not parseable", async () => {
    requiredBucketsForRateStructure.mockReturnValue([
      { key: "kwh.m.all.total", optional: false },
      { key: "kwh.m.all.NOT_A_KEY", optional: false },
    ]);

    usageHomeMonthlyUsageBucketFindMany.mockImplementation(async (args: any) => {
      if (args?.distinct && args?.select?.yearMonth) return [{ yearMonth: "2025-01" }];
      return [];
    });

    prismaSmtIntervalFindFirst.mockResolvedValue({ ts: new Date("2025-01-31T23:00:00.000Z") });
    calculatePlanCostForUsage.mockReturnValue({ status: "NOT_COMPUTABLE", reason: "MISSING_USAGE_BUCKETS" });

    const res = await estimateOfferFromOfferId({
      offerId: "o1",
      monthsCount: 1,
      autoEnsureBuckets: true,
      homeId: "h1",
      esiid: "10443720000000001",
      tdspSlug: "oncor",
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      annualKwh: 12000,
    } as any);

    expect((res.estimate as any)?.status).toBe("NOT_COMPUTABLE");
    expect((res.estimate as any)?.reason).toBe("UNSUPPORTED_BUCKET_KEY");
    expect(ensureCoreMonthlyBuckets).toHaveBeenCalledTimes(0);
  });
});

