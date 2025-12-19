import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { bucketRuleFromParsedKey, parseMonthlyBucketKey, type UsageBucketDef } from "@/lib/plan-engine/usageBuckets";

export type TdspApplied = {
  perKwhDeliveryChargeCents: number;
  monthlyCustomerChargeDollars: number;
  effectiveDate?: string;
};

export type OfferEstimateInput = {
  offerId: string;
  monthsCount: number;
  backfill: boolean;
};

export type OfferEstimateContext = {
  homeId: string;
  esiid: string | null;
  tdspSlug: string | null;
  tdsp: TdspApplied;
  annualKwh: number;
};

export type OfferEstimateResult = {
  offerId: string;
  ok: boolean;
  error?: string;
  httpStatus?: number;
  ratePlan?: { id: string; supplier: string | null; planName: string | null };
  monthsCount: number;
  monthsIncluded: string[];
  annualKwh: number;
  usageBucketsByMonthIncluded: boolean;
  detected: { freeWeekends: boolean; dayNightTou: boolean };
  backfill: { requested: boolean; attempted: boolean; ok: boolean; missingKeysBefore: number; missingKeysAfter: number };
  estimate?: any;
};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function decimalishToNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function daysAgo(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

function detectFreeWeekends(rateStructure: any): boolean {
  if (!rateStructure || !isObject(rateStructure)) return false;
  const rs: any = rateStructure;
  const periods: any[] = Array.isArray(rs?.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs?.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];
  if (!Array.isArray(periods) || periods.length === 0) return false;

  const hasWeekdayAllDay = periods.some((p) => {
    const startHour = numOrNull(p?.startHour);
    const endHour = numOrNull(p?.endHour);
    const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
    return (
      startHour === 0 &&
      endHour === 24 &&
      Array.isArray(days) &&
      days.length === 5 &&
      days.every((d) => d === 1 || d === 2 || d === 3 || d === 4 || d === 5)
    );
  });
  const hasWeekendAllDay = periods.some((p) => {
    const startHour = numOrNull(p?.startHour);
    const endHour = numOrNull(p?.endHour);
    const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
    return startHour === 0 && endHour === 24 && Array.isArray(days) && days.length === 2 && days.includes(0) && days.includes(6);
  });

  return hasWeekdayAllDay && hasWeekendAllDay;
}

function detectDayNightTou(rateStructure: any): boolean {
  if (!rateStructure || !isObject(rateStructure)) return false;
  const rs: any = rateStructure;
  const periods: any[] = Array.isArray(rs?.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs?.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];
  if (!Array.isArray(periods) || periods.length === 0) return false;

  const hasNight = periods.some((p) => numOrNull(p?.startHour) === 20 && numOrNull(p?.endHour) === 7);
  const hasDay = periods.some((p) => numOrNull(p?.startHour) === 7 && numOrNull(p?.endHour) === 20);
  return hasNight && hasDay;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveAliasedMonthlyBucket(args: {
  monthBuckets: Record<string, number>;
  preferKey: string;
  aliasKeys: readonly string[];
}): { dbKeyUsed: string; kwh: number } | null {
  const month = args.monthBuckets ?? {};
  const present = args.aliasKeys.filter((k) => isFiniteNumber(month[k]));
  if (present.length <= 0) return null;

  // If both exist, we prefer preferKey but fail-closed on mismatched values.
  if (present.length > 1) {
    const v0 = month[present[0]]!;
    for (const k of present.slice(1)) {
      const v = month[k]!;
      if (Math.abs(v - v0) > 1e-6) return null;
    }
  }

  const preferred = isFiniteNumber(month[args.preferKey]) ? args.preferKey : present[0]!;
  return { dbKeyUsed: preferred, kwh: month[preferred]! };
}

function parseYearMonth(ym: string): { year: number; month: number } | null {
  const s = String(ym ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m?.[1] || !m?.[2]) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function firstInstantOfMonthUtc(year: number, month1: number): Date {
  return new Date(Date.UTC(year, month1 - 1, 1, 0, 0, 0, 0));
}

function lastInstantOfMonthUtc(year: number, month1: number): Date {
  // month1 is 1..12. Date.UTC month is 0..11; day=0 yields last day of previous month.
  return new Date(Date.UTC(year, month1, 0, 23, 59, 59, 999));
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs)),
  ]);
}

function makeBucketDefsFromKeys(keys: string[]): UsageBucketDef[] {
  const out: UsageBucketDef[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const k = String(key ?? "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const parsed = parseMonthlyBucketKey(k);
    if (!parsed) continue;
    out.push({
      key: k,
      label: `Monthly kWh (${k})`,
      rule: bucketRuleFromParsedKey(parsed),
    });
  }
  return out;
}

const ALL_ALLDAY_KEYS = ["kwh.m.all.total", "kwh.m.all.0000-2400", "kwh.m.ALL.total", "kwh.m.ALL.0000-2400"] as const;
const WEEKDAY_ALLDAY_KEYS = ["kwh.m.weekday.total", "kwh.m.weekday.0000-2400", "kwh.m.WEEKDAY.total", "kwh.m.WEEKDAY.0000-2400"] as const;
const WEEKEND_ALLDAY_KEYS = ["kwh.m.weekend.total", "kwh.m.weekend.0000-2400", "kwh.m.WEEKEND.total", "kwh.m.WEEKEND.0000-2400"] as const;
const ALL_DAY_KEYS = ["kwh.m.all.0700-2000", "kwh.m.ALL.0700-2000"] as const;
const ALL_NIGHT_KEYS = ["kwh.m.all.2000-0700", "kwh.m.ALL.2000-0700"] as const;

function makeUsageBucketsByMonth(args: {
  months: string[];
  byMonth: Record<string, Record<string, number>>;
  wantsFreeWeekends: boolean;
  requiredCanonicalKeys: readonly string[];
}): { usageBucketsByMonth: Record<string, Record<string, number>> | null; missingSlots: number } {
  const months = args.months;
  const byMonth = args.byMonth;

  let missingSlots = 0;
  if (months.length <= 0) return { usageBucketsByMonth: null, missingSlots: 0 };

  const out: Record<string, Record<string, number>> = {};
  let allDbKeyUsed: string | null = null;
  let weekdayDbKeyUsed: string | null = null;
  let weekendDbKeyUsed: string | null = null;
  let dayDbKeyUsed: string | null = null;
  let nightDbKeyUsed: string | null = null;

  for (const ym of months) {
    const m = byMonth[ym] ?? {};

    const all = resolveAliasedMonthlyBucket({ monthBuckets: m, preferKey: "kwh.m.all.total", aliasKeys: ALL_ALLDAY_KEYS });
    if (!all) {
      missingSlots += 1;
      continue;
    }
    allDbKeyUsed = allDbKeyUsed ?? all.dbKeyUsed;
    if (allDbKeyUsed !== all.dbKeyUsed) {
      missingSlots += args.requiredCanonicalKeys.length;
      continue;
    }

    if (args.wantsFreeWeekends) {
      const wk = resolveAliasedMonthlyBucket({ monthBuckets: m, preferKey: "kwh.m.weekday.total", aliasKeys: WEEKDAY_ALLDAY_KEYS });
      const we = resolveAliasedMonthlyBucket({ monthBuckets: m, preferKey: "kwh.m.weekend.total", aliasKeys: WEEKEND_ALLDAY_KEYS });
      if (!wk) missingSlots += 1;
      if (!we) missingSlots += 1;
      if (!wk || !we) continue;

      weekdayDbKeyUsed = weekdayDbKeyUsed ?? wk.dbKeyUsed;
      weekendDbKeyUsed = weekendDbKeyUsed ?? we.dbKeyUsed;
      if (weekdayDbKeyUsed !== wk.dbKeyUsed || weekendDbKeyUsed !== we.dbKeyUsed) {
        missingSlots += args.requiredCanonicalKeys.length;
        continue;
      }

      out[ym] = { "kwh.m.all.total": all.kwh, "kwh.m.weekday.total": wk.kwh, "kwh.m.weekend.total": we.kwh };
      continue;
    }

    const day = resolveAliasedMonthlyBucket({ monthBuckets: m, preferKey: "kwh.m.all.0700-2000", aliasKeys: ALL_DAY_KEYS });
    const night = resolveAliasedMonthlyBucket({ monthBuckets: m, preferKey: "kwh.m.all.2000-0700", aliasKeys: ALL_NIGHT_KEYS });
    if (!day) missingSlots += 1;
    if (!night) missingSlots += 1;
    if (!day || !night) continue;

    dayDbKeyUsed = dayDbKeyUsed ?? day.dbKeyUsed;
    nightDbKeyUsed = nightDbKeyUsed ?? night.dbKeyUsed;
    if (dayDbKeyUsed !== day.dbKeyUsed || nightDbKeyUsed !== night.dbKeyUsed) {
      missingSlots += args.requiredCanonicalKeys.length;
      continue;
    }

    out[ym] = { "kwh.m.all.total": all.kwh, "kwh.m.all.0700-2000": day.kwh, "kwh.m.all.2000-0700": night.kwh };
  }

  if (Object.keys(out).length !== months.length) return { usageBucketsByMonth: null, missingSlots };
  return { usageBucketsByMonth: out, missingSlots };
}

export async function computeAnnualKwhForEsiid(esiid: string | null): Promise<number | null> {
  const e = esiid ? String(esiid).trim() : "";
  if (!e) return null;

  const latest = await prisma.smtInterval.findFirst({
    where: { esiid: e },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!(latest?.ts instanceof Date) || Number.isNaN(latest.ts.getTime())) return null;

  const windowEnd = latest.ts;
  const windowStart = daysAgo(windowEnd, 365);
  const agg = await prisma.smtInterval.aggregate({
    where: { esiid: e, ts: { gt: windowStart, lte: windowEnd } },
    _sum: { kwh: true },
  });
  const annualKwh = decimalishToNumber((agg as any)?._sum?.kwh);
  return annualKwh && Number.isFinite(annualKwh) && annualKwh > 0 ? annualKwh : null;
}

export async function getTdspApplied(tdspSlug: string | null): Promise<TdspApplied> {
  const slug = tdspSlug ? String(tdspSlug).trim().toLowerCase() : "";
  const tdspRates = slug ? await getTdspDeliveryRates({ tdspSlug: slug, asOf: new Date() }).catch(() => null) : null;
  return {
    perKwhDeliveryChargeCents: numOrNull(tdspRates?.perKwhDeliveryChargeCents) ?? 0,
    monthlyCustomerChargeDollars: numOrNull(tdspRates?.monthlyCustomerChargeDollars) ?? 0,
    effectiveDate: tdspRates?.effectiveDate ?? undefined,
  };
}

export async function estimateOfferFromOfferId(args: OfferEstimateInput & OfferEstimateContext): Promise<OfferEstimateResult> {
  const offerId = String(args.offerId ?? "").trim();
  const monthsCount = Math.max(1, Math.min(12, Math.floor(Number(args.monthsCount ?? 12))));
  const backfillRequested = Boolean(args.backfill);

  if (!offerId) return { offerId, ok: false, error: "missing_offerId", httpStatus: 400, monthsCount, monthsIncluded: [], annualKwh: args.annualKwh, usageBucketsByMonthIncluded: false, detected: { freeWeekends: false, dayNightTou: false }, backfill: { requested: backfillRequested, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 } };

  // Resolve template mapping (offerId -> RatePlan)
  const map = await (prisma as any).offerIdRatePlanMap.findUnique({
    where: { offerId },
    select: { offerId: true, ratePlanId: true },
  });
  const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;
  if (!ratePlanId) {
    return {
      offerId,
      ok: false,
      error: "template_unavailable",
      httpStatus: 404,
      monthsCount,
      monthsIncluded: [],
      annualKwh: args.annualKwh,
      usageBucketsByMonthIncluded: false,
      detected: { freeWeekends: false, dayNightTou: false },
      backfill: { requested: backfillRequested, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
    };
  }

  const ratePlan = await (prisma as any).ratePlan.findUnique({
    where: { id: ratePlanId },
    select: { id: true, planName: true, supplier: true, rateStructure: true },
  });
  const rateStructure = ratePlan?.rateStructure ?? null;
  if (!rateStructure || typeof rateStructure !== "object") {
    return {
      offerId,
      ok: false,
      error: "missing_rate_structure",
      httpStatus: 404,
      ratePlan: { id: ratePlanId, supplier: ratePlan?.supplier ?? null, planName: ratePlan?.planName ?? null },
      monthsCount,
      monthsIncluded: [],
      annualKwh: args.annualKwh,
      usageBucketsByMonthIncluded: false,
      detected: { freeWeekends: false, dayNightTou: false },
      backfill: { requested: backfillRequested, attempted: false, ok: false, missingKeysBefore: 0, missingKeysAfter: 0 },
    };
  }

  const wantsFreeWeekends = detectFreeWeekends(rateStructure);
  const wantsDayNight = !wantsFreeWeekends && detectDayNightTou(rateStructure);

  const canonicalRequiredKeys = wantsFreeWeekends
    ? (["kwh.m.all.total", "kwh.m.weekday.total", "kwh.m.weekend.total"] as const)
    : wantsDayNight
      ? (["kwh.m.all.total", "kwh.m.all.2000-0700", "kwh.m.all.0700-2000"] as const)
      : (["kwh.m.all.total", "kwh.m.all.2000-0700", "kwh.m.all.0700-2000"] as const);

  const dbQueryKeys: string[] = wantsFreeWeekends
    ? Array.from(new Set<string>([...ALL_ALLDAY_KEYS, ...WEEKDAY_ALLDAY_KEYS, ...WEEKEND_ALLDAY_KEYS]))
    : Array.from(new Set<string>([...ALL_ALLDAY_KEYS, ...ALL_DAY_KEYS, ...ALL_NIGHT_KEYS]));

  // Define the month window as the latest N months present for this homeId (regardless of key shape).
  const recentMonthsRows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
    where: { homeId: args.homeId },
    distinct: ["yearMonth"],
    select: { yearMonth: true },
    orderBy: { yearMonth: "desc" },
    take: monthsCount,
  });
  const months = (recentMonthsRows ?? [])
    .map((r: any) => String(r?.yearMonth ?? "").trim())
    .filter(Boolean)
    .reverse();

  const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
    where: { homeId: args.homeId, yearMonth: { in: months as any }, bucketKey: { in: dbQueryKeys as any } },
    select: { yearMonth: true, bucketKey: true, kwhTotal: true },
    orderBy: { yearMonth: "desc" },
  });

  const byMonth: Record<string, Record<string, number>> = {};
  for (const r of rows ?? []) {
    const ym = String(r?.yearMonth ?? "").trim();
    const key = String(r?.bucketKey ?? "").trim();
    const kwh = decimalishToNumber(r?.kwhTotal);
    if (!ym || !key || kwh == null) continue;
    if (!byMonth[ym]) byMonth[ym] = {};
    byMonth[ym][key] = kwh;
  }

  let backfillAttempted = false;
  let backfillOk = false;
  let missingKeysBefore = 0;
  let missingKeysAfter = 0;

  let { usageBucketsByMonth, missingSlots } = makeUsageBucketsByMonth({
    months,
    byMonth,
    wantsFreeWeekends,
    requiredCanonicalKeys: canonicalRequiredKeys,
  });
  missingKeysBefore = missingSlots;
  missingKeysAfter = missingKeysBefore;

  // Optional on-demand backfill (bounded): only when explicitly requested and missing.
  if (!usageBucketsByMonth && backfillRequested && months.length === monthsCount && monthsCount <= 12) {
    backfillAttempted = true;
    const startParsed = parseYearMonth(months[0]);
    const endParsed = parseYearMonth(months[months.length - 1]);
    if (startParsed && endParsed) {
      const rangeStart = firstInstantOfMonthUtc(startParsed.year, startParsed.month);
      const rangeEnd = lastInstantOfMonthUtc(endParsed.year, endParsed.month);

      const bucketDefs = makeBucketDefsFromKeys([...canonicalRequiredKeys]);
      const intervalSource = args.esiid ? ("SMT" as const) : ("GREENBUTTON" as const);
      const source = intervalSource === "SMT" ? ("SMT" as const) : ("GREENBUTTON" as const);

      try {
        await withTimeout(
          ensureCoreMonthlyBuckets({
            homeId: args.homeId,
            esiid: intervalSource === "SMT" ? args.esiid : null,
            rangeStart,
            rangeEnd,
            source,
            intervalSource,
            bucketDefs,
          }),
          60000,
          "bucket_backfill",
        );
      } catch {
        // Fail closed: re-check coverage below.
      }

      const rows2 = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
        where: { homeId: args.homeId, yearMonth: { in: months as any }, bucketKey: { in: dbQueryKeys as any } },
        select: { yearMonth: true, bucketKey: true, kwhTotal: true },
        orderBy: { yearMonth: "desc" },
      });
      const byMonth2: Record<string, Record<string, number>> = {};
      for (const r of rows2 ?? []) {
        const ym = String(r?.yearMonth ?? "").trim();
        const key = String(r?.bucketKey ?? "").trim();
        const kwh = decimalishToNumber(r?.kwhTotal);
        if (!ym || !key || kwh == null) continue;
        if (!byMonth2[ym]) byMonth2[ym] = {};
        byMonth2[ym][key] = kwh;
      }

      const after = makeUsageBucketsByMonth({
        months,
        byMonth: byMonth2,
        wantsFreeWeekends,
        requiredCanonicalKeys: canonicalRequiredKeys,
      });
      usageBucketsByMonth = after.usageBucketsByMonth;
      missingKeysAfter = after.missingSlots;
      backfillOk = Boolean(usageBucketsByMonth);
    }
  }

  const estimate = calculatePlanCostForUsage({
    annualKwh: args.annualKwh,
    monthsCount,
    tdsp: args.tdsp,
    rateStructure,
    ...(usageBucketsByMonth ? { usageBucketsByMonth } : {}),
  });

  return {
    offerId,
    ok: true,
    ratePlan: { id: ratePlanId, supplier: ratePlan?.supplier ?? null, planName: ratePlan?.planName ?? null },
    monthsCount,
    monthsIncluded: months,
    annualKwh: args.annualKwh,
    usageBucketsByMonthIncluded: Boolean(usageBucketsByMonth),
    detected: { freeWeekends: wantsFreeWeekends, dayNightTou: wantsDayNight },
    backfill: {
      requested: backfillRequested,
      attempted: backfillAttempted,
      ok: backfillOk,
      missingKeysBefore,
      missingKeysAfter,
    },
    estimate,
  };
}

