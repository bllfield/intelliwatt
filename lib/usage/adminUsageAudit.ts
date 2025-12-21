import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import { bucketDefsFromBucketKeys } from "@/lib/plan-engine/usageBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";

function normalizeEmailLoose(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lastNYearMonthsChicago(n: number): string[] {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year0 = Number(get("year"));
    const month0 = Number(get("month"));
    if (!Number.isFinite(year0) || !Number.isFinite(month0) || month0 < 1 || month0 > 12) return [];

    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const idx = month0 - i;
      const y = idx >= 1 ? year0 : year0 - Math.ceil((1 - idx) / 12);
      const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
      out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
    }
    return out;
  } catch {
    return [];
  }
}

export type AdminUsageAuditResult = {
  ok: boolean;
  usageContext: {
    email: string;
    homeId: string | null;
    esiid: string | null;
    months: number;
    bucketKeys: string[];
    computed: any | null;
    errors: string[];
    tdspSlugUsed?: string | null;
  };
  usagePreview: {
    months: number;
    annualKwh: number | null;
    avgMonthlyKwhByKey: Record<string, number>;
    latestMonthKwhByKey: Record<string, number>;
    missingKeys: string[];
  } | null;
  usageEstimate: any | null;
};

export async function adminUsageAuditForHome(args: {
  usageEmail: string;
  usageMonths?: number;
  requiredBucketKeys?: string[];
  rateStructure?: any;
  tdspSlug?: string | null;
  rawTextForTdspInference?: string | null;
}): Promise<AdminUsageAuditResult> {
  const usageEmail = normalizeEmailLoose(args.usageEmail);
  const usageMonths = Math.max(1, Math.min(24, Number(args.usageMonths ?? 12) || 12));
  const requiredBucketKeys = Array.isArray(args.requiredBucketKeys)
    ? args.requiredBucketKeys.map((k) => String(k ?? "").trim()).filter(Boolean)
    : [];

  const usageContext: AdminUsageAuditResult["usageContext"] = {
    email: usageEmail,
    homeId: null,
    esiid: null,
    months: usageMonths,
    bucketKeys: [],
    computed: null,
    errors: [],
  };

  try {
    if (!usageEmail) {
      usageContext.errors.push("missing_usageEmail");
      return { ok: false, usageContext, usagePreview: null, usageEstimate: null };
    }

    const user = await prisma.user.findUnique({
      where: { email: usageEmail },
      select: { id: true },
    });
    if (!user) {
      usageContext.errors.push("user_not_found");
      return { ok: false, usageContext, usagePreview: null, usageEstimate: null };
    }

    const house =
      (await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, esiid: true },
      })) ||
      (await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, esiid: true },
      }));

    usageContext.homeId = house?.id ? String(house.id) : null;
    usageContext.esiid = house?.esiid ? String(house.esiid) : null;

    if (!usageContext.homeId) {
      usageContext.errors.push("missing_homeId");
      return { ok: false, usageContext, usagePreview: null, usageEstimate: null };
    }
    if (!usageContext.esiid) {
      usageContext.errors.push("missing_esiid");
      return { ok: false, usageContext, usagePreview: null, usageEstimate: null };
    }

    const unionKeys = Array.from(new Set(["kwh.m.all.total", ...requiredBucketKeys]));
    usageContext.bucketKeys = unionKeys;

    const cappedKeys = unionKeys.slice(0, 50);
    if (unionKeys.length > cappedKeys.length) {
      usageContext.errors.push(`bucketKey_cap_applied:${unionKeys.length}->${cappedKeys.length}`);
    }

    const bucketDefs = bucketDefsFromBucketKeys(cappedKeys);
    const now = new Date();
    const rangeEnd = now;
    const rangeStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const computed = await ensureCoreMonthlyBuckets({
      homeId: usageContext.homeId,
      esiid: usageContext.esiid,
      rangeStart,
      rangeEnd,
      source: "SMT",
      intervalSource: "SMT",
      bucketDefs,
    });
    usageContext.computed = computed;

    const yearMonths = lastNYearMonthsChicago(usageMonths);
    const bucketRows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
      where: {
        homeId: usageContext.homeId,
        yearMonth: { in: yearMonths },
        bucketKey: { in: cappedKeys },
      },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true },
    });

    const byMonth: Record<string, Record<string, number>> = {};
    for (const r of bucketRows ?? []) {
      const ym = String((r as any)?.yearMonth ?? "");
      const key = String((r as any)?.bucketKey ?? "");
      const kwh = decimalToNumber((r as any)?.kwhTotal);
      if (!ym || !key || kwh == null) continue;
      if (!byMonth[ym]) byMonth[ym] = {};
      byMonth[ym][key] = kwh;
    }

    const latestYm = yearMonths[0] ?? null;
    const avgMonthlyKwhByKey: Record<string, number> = {};
    const latestMonthKwhByKey: Record<string, number> = {};
    const missingKeys: string[] = [];

    for (const key of cappedKeys) {
      const vals: number[] = [];
      for (const ym of yearMonths) {
        const v = byMonth?.[ym]?.[key];
        if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
      }
      if (vals.length === 0) missingKeys.push(key);
      else {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        avgMonthlyKwhByKey[key] = Number(avg.toFixed(3));
      }
      if (latestYm && typeof byMonth?.[latestYm]?.[key] === "number") {
        latestMonthKwhByKey[key] = Number(byMonth[latestYm][key].toFixed(3));
      }
    }

    const annualKwh = (() => {
      const vals: number[] = [];
      for (const ym of yearMonths) {
        const v = byMonth?.[ym]?.["kwh.m.all.total"];
        if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
      }
      if (vals.length === 0) return null;
      return Number(vals.reduce((a, b) => a + b, 0).toFixed(3));
    })();

    const usagePreview: AdminUsageAuditResult["usagePreview"] = {
      months: yearMonths.length,
      annualKwh,
      avgMonthlyKwhByKey,
      latestMonthKwhByKey,
      missingKeys,
    };

    // Optional: compute a cost estimate if we have tdspSlug + rateStructure.
    let usageEstimate: any | null = null;
    try {
      const inferred =
        args.tdspSlug ??
        (String(args.rawTextForTdspInference ?? "").trim()
          ? inferTdspTerritoryFromEflText(String(args.rawTextForTdspInference ?? ""))
          : null);
      const tdspSlug = String(inferred ?? "").trim().toLowerCase();
      const rateStructure = args.rateStructure ?? null;
      usageContext.tdspSlugUsed = tdspSlug || null;

      if (tdspSlug && annualKwh && rateStructure) {
        const tdspRates = await getTdspDeliveryRates({ tdspSlug, asOf: new Date() });
        if (tdspRates) {
          usageEstimate = calculatePlanCostForUsage({
            annualKwh,
            monthsCount: yearMonths.length || usageMonths,
            tdsp: {
              perKwhDeliveryChargeCents: Number(tdspRates.perKwhDeliveryChargeCents ?? 0) || 0,
              monthlyCustomerChargeDollars: Number(tdspRates.monthlyCustomerChargeDollars ?? 0) || 0,
              effectiveDate: tdspRates.effectiveDate ?? undefined,
            },
            rateStructure,
            usageBucketsByMonth: byMonth,
          });
        } else {
          usageContext.errors.push("missing_tdsp_rates");
          usageEstimate = { status: "NOT_IMPLEMENTED", reason: "Missing TDSP rates (tariff lookup failed)" };
        }
      } else {
        if (!tdspSlug) usageContext.errors.push("missing_tdsp_slug");
        if (!annualKwh) usageContext.errors.push("missing_annual_kwh");
        if (!rateStructure) usageContext.errors.push("missing_rateStructure");
        usageEstimate = {
          status: "NOT_COMPUTABLE",
          reason: "Missing inputs for usage estimate",
          notes: [
            !tdspSlug ? "missing_tdsp_slug" : null,
            !annualKwh ? "missing_annual_kwh" : null,
            !rateStructure ? "missing_rateStructure" : null,
          ].filter(Boolean),
        };
      }
    } catch (e: any) {
      usageContext.errors.push("usage_estimate_error");
      usageEstimate = { status: "ERROR", reason: e?.message ?? String(e) };
    }

    return { ok: true, usageContext, usagePreview, usageEstimate };
  } catch (e: any) {
    usageContext.errors.push(e?.message ?? String(e));
    return { ok: false, usageContext, usagePreview: null, usageEstimate: null };
  }
}

