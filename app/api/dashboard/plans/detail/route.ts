import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { usagePrisma } from "@/lib/db/usageClient";
import { bucketDefsFromBucketKeys, canonicalizeMonthlyBucketKey } from "@/lib/plan-engine/usageBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import crypto from "node:crypto";
import {
  calculatePlanCostForUsage,
  extractFixedRepEnergyCentsPerKwh,
  extractRepFixedMonthlyChargeDollars,
} from "@/lib/plan-engine/calculatePlanCostForUsage";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { getCachedPlanEstimate, putCachedPlanEstimate, sha256Hex as sha256HexCache } from "@/lib/plan-engine/planEstimateCache";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { extractDeterministicTierSchedule, computeRepEnergyCostForMonthlyKwhTiered } from "@/lib/plan-engine/tieredPricing";
import { extractDeterministicBillCredits, applyBillCreditsToMonth } from "@/lib/plan-engine/billCredits";
import { extractDeterministicMinimumRules, applyMinimumRulesToMonth } from "@/lib/plan-engine/minimumRules";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v4";

function hashUsageInputs(args: {
  yearMonths: string[];
  bucketKeys: string[];
  usageBucketsByMonth: Record<string, Record<string, number>>;
}): string {
  const h = crypto.createHash("sha256");
  const yearMonths = Array.isArray(args.yearMonths) ? args.yearMonths : [];
  const keys = Array.isArray(args.bucketKeys) ? args.bucketKeys.map(String).filter(Boolean).sort() : [];

  h.update("ym:");
  h.update(yearMonths.join(","));
  h.update("|keys:");
  h.update(keys.join(","));
  h.update("|vals:");
  for (const ym of yearMonths) {
    h.update(ym);
    h.update("{");
    const m = args.usageBucketsByMonth?.[ym] ?? {};
    for (const k of keys) {
      const v = (m as any)[k];
      const n = typeof v === "number" && Number.isFinite(v) ? v : null;
      h.update(k);
      h.update("=");
      h.update(n == null ? "null" : n.toFixed(6));
      h.update(";");
    }
    h.update("}");
  }
  return h.digest("hex");
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundCents(n: number): number {
  return Math.round(n);
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function monthKwh(m: Record<string, number> | null | undefined, key: string): number | null {
  if (!m) return null;
  const v = (m as any)[key];
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
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

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function numOrNull(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function chicagoYearMonthParts(now: Date): { year: number; month: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
    return { year: y, month: m };
  } catch {
    return null;
  }
}

function lastNYearMonthsChicagoFrom(date: Date, n: number): string[] {
  const base = chicagoYearMonthParts(date);
  if (!base) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = base.month - i;
    const y = idx >= 1 ? base.year : base.year - Math.ceil((1 - idx) / 12);
    const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
  }
  return out;
}

function prevYearMonth(ym: string): string | null {
  const s = String(ym ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m?.[1] || !m?.[2]) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  const py = mo === 1 ? y - 1 : y;
  const pm = mo === 1 ? 12 : mo - 1;
  return `${String(py)}-${String(pm).padStart(2, "0")}`;
}

function chicagoYearMonthFromDate(d: Date): string | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = get("year");
    const m = get("month");
    if (!y || !m) return null;
    return `${y}-${m}`;
  } catch {
    return null;
  }
}

function chicagoParts(ts: Date): {
  yearMonth: string;
  year: number;
  day: number;
  month: number;
  weekdayIndex: number; // 0=Sun..6=Sat
  minutesOfDay: number;
  isWeekend: boolean;
} | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    const hh = Number(get("hour"));
    const mm = Number(get("minute"));
    const wd = get("weekday");
    if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    if (weekdayIndex < 0) return null;
    const minutesOfDay = hh * 60 + mm;
    const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
    return {
      yearMonth: `${String(y)}-${String(m).padStart(2, "0")}`,
      year: y,
      day: d,
      month: m,
      weekdayIndex,
      minutesOfDay,
      isWeekend,
    };
  } catch {
    return null;
  }
}

function daysInMonth(year: number, month1: number): number {
  // month1: 1-12
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return 31;
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function lastCompleteChicagoDay(ts: Date, opts?: { minMinutesOfDay?: number; maxStepDays?: number }): {
  year: number;
  month: number;
  yearMonth: string;
  day: number;
} | null {
  const minMinutesOfDay = typeof opts?.minMinutesOfDay === "number" ? opts!.minMinutesOfDay : 23 * 60 + 45; // 23:45
  const maxStepDays = typeof opts?.maxStepDays === "number" ? opts!.maxStepDays : 2; // allow "pull 2 days back" if SMT is late

  const p0 = chicagoParts(ts);
  if (!p0) return null;

  // If the latest timestamp has reached the end-of-day threshold (Chicago-local),
  // then that Chicago calendar day is "complete".
  if (p0.minutesOfDay >= minMinutesOfDay) {
    return { year: p0.year, month: p0.month, yearMonth: p0.yearMonth, day: p0.day };
  }

  // Otherwise the "complete day" is the previous *calendar day in Chicago*.
  // IMPORTANT: do not do p0.day - 1, because that can underflow on the 1st and
  // accidentally skip an extra day when we step across a month boundary.
  //
  // Use a UTC noon-ish anchor for the Chicago day, then step back whole days.
  // 18:00Z is always safely inside the America/Chicago local day (no midnight/DST edge).
  const chicagoNoonAnchorUtc = (year: number, month1: number, day1: number) =>
    new Date(Date.UTC(year, month1 - 1, day1, 18, 0, 0));

  const anchor = chicagoNoonAnchorUtc(p0.year, p0.month, p0.day);
  for (let step = 1; step <= Math.max(1, maxStepDays); step++) {
    const prev = new Date(anchor.getTime() - step * 24 * 60 * 60 * 1000);
    const p = chicagoParts(prev);
    if (!p) continue;
    return { year: p.year, month: p.month, yearMonth: p.yearMonth, day: p.day };
  }

  return null;
}

function hhmmToMinutes(hhmm: string): number | null {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh === 24 && mm === 0) return 1440;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function evalRule(rule: any, interval: { month: number; weekdayIndex: number; isWeekend: boolean; minutesOfDay: number }): boolean {
  if (!rule || rule.v !== 1 || rule.tz !== "America/Chicago") return false;

  // Month filter (ACTUAL month; we do not shift month for START_DAY dayType attribution)
  if (Array.isArray(rule.months) && rule.months.length) {
    if (!rule.months.includes(interval.month)) return false;
  }

  const startMin = hhmmToMinutes(rule?.window?.startHHMM);
  const endMin = hhmmToMinutes(rule?.window?.endHHMM);
  if (startMin == null || endMin == null) return false;
  const isOvernight = endMin < startMin;

  // Day attribution (START_DAY only affects day filters in overnight buckets for post-midnight hours)
  let weekdayIndex = interval.weekdayIndex;
  let isWeekend = interval.isWeekend;
  if (isOvernight && rule.overnightAttribution === "START_DAY" && interval.minutesOfDay < endMin) {
    weekdayIndex = (weekdayIndex + 6) % 7;
    isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
  }

  if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length) {
    if (!rule.daysOfWeek.includes(weekdayIndex)) return false;
  } else if (rule.dayType === "WEEKDAY") {
    if (isWeekend) return false;
  } else if (rule.dayType === "WEEKEND") {
    if (!isWeekend) return false;
  }

  // Window
  const t = interval.minutesOfDay;
  if (endMin === startMin) return false;
  if (!isOvernight) return t >= startMin && t < endMin;
  return t >= startMin || t < endMin;
}

function usageDefToRule(def: any): any | null {
  // Prefer stored ruleJson when present and compatible.
  const rj = def?.ruleJson ?? null;
  if (rj && typeof rj === "object" && (rj as any).v === 1 && (rj as any).tz === "America/Chicago") return rj;

  const dayType = typeof def?.dayType === "string" ? def.dayType : null;
  const tz = typeof def?.tz === "string" ? def.tz : null;
  const startHHMM = typeof def?.startHHMM === "string" ? def.startHHMM : null;
  const endHHMM = typeof def?.endHHMM === "string" ? def.endHHMM : null;
  if (!dayType || !tz || !startHHMM || !endHHMM) return null;

  return {
    v: 1,
    tz,
    dayType: dayType === "ALL" || dayType === "WEEKDAY" || dayType === "WEEKEND" ? dayType : undefined,
    window: { startHHMM: startHHMM, endHHMM: endHHMM },
    ...(def?.overnightAttribution ? { overnightAttribution: def.overnightAttribution } : {}),
  };
}

async function fetchSmtUsageWindow(esiid: string): Promise<{ latest: Date; cutoff: Date } | null> {
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!latest?.ts) return null;
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);
  return { latest: latest.ts, cutoff };
}

async function fetchGreenButtonUsageWindow(houseId: string): Promise<{ latest: Date; cutoff: Date; rawId: string } | null> {
  const usageClient = usagePrisma as any;
  const latestRaw = await usageClient.rawGreenButton.findFirst({
    where: { homeId: houseId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latestRaw?.id) return null;

  const latest = await usageClient.greenButtonInterval.findFirst({
    where: { homeId: houseId, rawId: latestRaw.id },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  if (!latest?.timestamp) return null;
  const cutoff = new Date(latest.timestamp.getTime() - 365 * DAY_MS);
  return { latest: latest.timestamp, cutoff, rawId: latestRaw.id };
}

function isRateStructurePresent(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "object" && (v as any)?.toJSON?.() === null) return false;
  if (typeof v !== "object") return false;
  try {
    return Object.keys(v).length > 0;
  } catch {
    return false;
  }
}

function isComputableOverride(planCalcStatus: string | null | undefined, planCalcReasonCode: string | null | undefined) {
  return (
    String(planCalcStatus ?? "").trim() === "COMPUTABLE" &&
    String(planCalcReasonCode ?? "").trim() === "ADMIN_OVERRIDE_COMPUTABLE"
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const offerId = String(url.searchParams.get("offerId") ?? "").trim();
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "missing_offerId" }, { status: 400 });
    }

    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
      },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
          esiid: true,
          tdspSlug: true,
          utilityName: true,
        },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    }

    // Align usage snapshot & calculations to the SAME logic as /api/user/usage:
    // strict last 365 days ending at the latest interval timestamp, choosing SMT vs Green Button by latest timestamp.
    const smtWindow = house.esiid ? await fetchSmtUsageWindow(house.esiid).catch(() => null) : null;
    const gbWindow = await fetchGreenButtonUsageWindow(house.id).catch(() => null);
    const smtLatestMs = smtWindow?.latest ? smtWindow.latest.getTime() : 0;
    const gbLatestMs = gbWindow?.latest ? gbWindow.latest.getTime() : 0;
    const usageSource: "SMT" | "GREEN_BUTTON" | null =
      smtLatestMs === 0 && gbLatestMs === 0 ? null : smtLatestMs >= gbLatestMs ? "SMT" : "GREEN_BUTTON";

    const window = usageSource === "SMT" ? smtWindow : usageSource === "GREEN_BUTTON" ? gbWindow : null;
    if (!usageSource || !window) {
      return NextResponse.json({ ok: false, error: "no_usage_window" }, { status: 400 });
    }

    let annualKwh: number | null = null;
    let intervalsCount = 0;
    let windowStart: Date | null = null;
    let windowEnd: Date | null = null;

    if (usageSource === "SMT") {
      const esiid = house.esiid!;
      const aggregates = await prisma.smtInterval.aggregate({
        where: { esiid, ts: { gte: window.cutoff } },
        _count: { _all: true },
        _sum: { kwh: true },
        _min: { ts: true },
        _max: { ts: true },
      });
      intervalsCount = aggregates._count?._all ?? 0;
      annualKwh = decimalToNumber(aggregates._sum?.kwh ?? 0);
      windowStart = aggregates._min?.ts ?? null;
      windowEnd = aggregates._max?.ts ?? null;
    } else {
      const usageClient = usagePrisma as any;
      const rawId = (window as any).rawId;
      const aggregates = await usageClient.greenButtonInterval.aggregate({
        where: { homeId: house.id, rawId, timestamp: { gte: window.cutoff } },
        _count: { _all: true },
        _sum: { consumptionKwh: true },
        _min: { timestamp: true },
        _max: { timestamp: true },
      });
      intervalsCount = aggregates._count?._all ?? 0;
      annualKwh = decimalToNumber(aggregates._sum?.consumptionKwh ?? 0);
      windowStart = aggregates._min?.timestamp ?? null;
      windowEnd = aggregates._max?.timestamp ?? null;
    }

    const avgMonthlyKwh = typeof annualKwh === "number" && Number.isFinite(annualKwh) ? annualKwh / 12 : null;

    // Fetch live offers and pick the one.
    const raw = await wattbuy.offers({
      address: house.addressLine1,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
      isRenter,
    });
    const normalized = normalizeOffers(raw ?? {});
    const offers = Array.isArray((normalized as any)?.offers) ? (normalized as any).offers : [];
    const offer = offers.find((o: any) => String(o?.offer_id ?? "") === offerId) ?? null;
    if (!offer) {
      return NextResponse.json({ ok: false, error: "offer_not_found", offerId }, { status: 404 });
    }

    // Mapping offerId -> RatePlan template
    const map = await (prisma as any).offerIdRatePlanMap.findUnique({
      where: { offerId },
      select: { offerId: true, ratePlanId: true },
    });
    const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;

    const ratePlanRow = ratePlanId
      ? await (prisma as any).ratePlan.findUnique({
          where: { id: ratePlanId },
          select: {
            id: true,
            planName: true,
            supplier: true,
            termMonths: true,
            repPuctCertificate: true,
            eflVersionCode: true,
            eflUrl: true,
            rateStructure: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
            planCalcDerivedAt: true,
          },
        })
      : null;

    const rateStructure = ratePlanRow?.rateStructure ?? null;
    const rsPresent = isRateStructurePresent(rateStructure);

    // TDSP rates
    const tdspSlug = String(offer?.tdsp ?? house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;

    // Plan calc requirements + computability
    const derivedReq = derivePlanCalcRequirementsFromTemplate({ rateStructure: rsPresent ? rateStructure : null });
    const planCalcStatus =
      typeof ratePlanRow?.planCalcStatus === "string" ? String(ratePlanRow.planCalcStatus) : derivedReq.planCalcStatus;
    const planCalcReasonCode =
      typeof ratePlanRow?.planCalcReasonCode === "string"
        ? String(ratePlanRow.planCalcReasonCode)
        : derivedReq.planCalcReasonCode;
    const requiredBucketKeys = Array.isArray(ratePlanRow?.requiredBucketKeys) && ratePlanRow.requiredBucketKeys.length
      ? (ratePlanRow.requiredBucketKeys as any[]).map(String)
      : derivedReq.requiredBucketKeys;

    const planComputability = canComputePlanFromBuckets({
      offerId,
      ratePlanId,
      templateAvailable: Boolean(ratePlanId && rsPresent),
      template: ratePlanId && rsPresent ? { rateStructure } : null,
    });

    // Canonical: build the exact same stitched 12-month buckets used across the site.
    const bucketBuild = await buildUsageBucketsForEstimate({
      homeId: house.id,
      usageSource,
      esiid: usageSource === "SMT" ? (house.esiid ?? null) : null,
      rawId: usageSource === "GREEN_BUTTON" ? ((window as any)?.rawId ?? null) : null,
      windowEnd: windowEnd ?? new Date(),
      cutoff: window.cutoff,
      requiredBucketKeys: requiredBucketKeys ?? [],
      monthsCount: 12,
      maxStepDays: 2,
    });

    const yearMonths = bucketBuild.yearMonths;
    const keysToLoad = bucketBuild.keysToLoad;
    const usageBucketsByMonthForCalc = bucketBuild.usageBucketsByMonth;
    const bucketDefsForResponse = bucketDefsFromBucketKeys(keysToLoad).map((b) => ({ key: b.key, label: b.label }));

    const bucketTable = yearMonths.map((ym) => {
      const m = usageBucketsByMonthForCalc[ym] ?? {};
      const row: any = { yearMonth: ym };
      for (const k of keysToLoad) {
        row[k] = typeof (m as any)[k] === "number" ? (m as any)[k] : null;
      }
      return row;
    });

    // Prefer annual kWh from the same stitched 12 months used for the monthly table.
    if (typeof bucketBuild.annualKwh === "number" && Number.isFinite(bucketBuild.annualKwh) && bucketBuild.annualKwh > 0) {
      annualKwh = bucketBuild.annualKwh;
    }

    // Calc inputs / variables
    const repEnergyCentsPerKwh = rsPresent ? extractFixedRepEnergyCentsPerKwh(rateStructure) : null;
    const repFixedMonthlyChargeDollars = rsPresent ? extractRepFixedMonthlyChargeDollars(rateStructure) : null;
    const tdspApplied = tdspRates
      ? {
          perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
          monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
          effectiveDate: tdspRates?.effectiveDate ?? null,
        }
      : null;

    // Dynamic variable list for UI (future-proof as plan features expand).
    const variablesList: Array<{ key: string; label: string; value: string }> = [];
    if (rsPresent) {
      const creditsMaybe = extractDeterministicBillCredits(rateStructure);
      const minimumMaybe = extractDeterministicMinimumRules({ rateStructure });
      const tieredMaybe = extractDeterministicTierSchedule(rateStructure);
      const touMaybe = extractDeterministicTouSchedule(rateStructure);

      if (touMaybe?.schedule?.periods?.length) {
        variablesList.push({
          key: "rep.tou_periods",
          label: "REP time-of-use periods",
          value: String(touMaybe.schedule.periods.length),
        });
      } else if (tieredMaybe?.ok) {
        variablesList.push({ key: "rep.tiered", label: "REP tiered pricing", value: "Yes" });
      } else if (typeof repEnergyCentsPerKwh === "number" && Number.isFinite(repEnergyCentsPerKwh)) {
        variablesList.push({
          key: "rep.energy",
          label: "REP energy",
          value: `${repEnergyCentsPerKwh.toFixed(4)}¢/kWh`,
        });
      } else {
        variablesList.push({ key: "rep.energy", label: "REP energy", value: "—" });
      }

      variablesList.push({
        key: "rep.fixed",
        label: "REP fixed",
        value:
          typeof repFixedMonthlyChargeDollars === "number" && Number.isFinite(repFixedMonthlyChargeDollars)
            ? `$${repFixedMonthlyChargeDollars.toFixed(2)}/mo`
            : "—/mo",
      });

      if (creditsMaybe?.ok && Array.isArray((creditsMaybe as any).credits) && (creditsMaybe as any).credits.length > 0) {
        variablesList.push({
          key: "rep.credits",
          label: "Bill credits",
          value: `${(creditsMaybe as any).credits.length} rule(s)`,
        });
      }
      if (minimumMaybe?.ok) {
        variablesList.push({ key: "rep.minimums", label: "Minimum bill rules", value: "Yes" });
      }
    }

    if (tdspApplied) {
      variablesList.push({
        key: "tdsp.delivery",
        label: "TDSP delivery",
        value: `${Number(tdspApplied.perKwhDeliveryChargeCents).toFixed(4)}¢/kWh`,
      });
      variablesList.push({
        key: "tdsp.customer",
        label: "TDSP customer",
        value: `$${Number(tdspApplied.monthlyCustomerChargeDollars).toFixed(2)}/mo`,
      });
      if (tdspApplied.effectiveDate) {
        variablesList.push({
          key: "tdsp.effective",
          label: "TDSP effective",
          value: String(tdspApplied.effectiveDate).slice(0, 10),
        });
      }
    }

    // True-cost estimate (if computable + inputs present)
    const overriddenComputable = isComputableOverride(planCalcStatus, planCalcReasonCode);
    const trueCostEstimate = await (async () => {
      if (!annualKwh || !rsPresent || !tdspApplied) return { status: "NOT_IMPLEMENTED", reason: "Missing inputs or plan not computable" };
      if (!overriddenComputable && planComputability?.status === "NOT_COMPUTABLE") {
        return { status: "NOT_COMPUTABLE", reason: planComputability?.reason ?? "Plan not computable" };
      }

      const monthsCount = 12;
      const tdspPer = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const tdspEff = tdspApplied.effectiveDate ?? null;
      const rsSha = sha256HexCache(JSON.stringify(rateStructure ?? null));
      const usageSha = hashUsageInputs({
        yearMonths,
        bucketKeys: Array.from(new Set(["kwh.m.all.total", ...(requiredBucketKeys ?? [])])),
        usageBucketsByMonth: usageBucketsByMonthForCalc,
      });
      const estimateMode =
        String(planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
          ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
          : ("DEFAULT" as const);

      const inputsSha256 = sha256HexCache(
        JSON.stringify({
          v: PLAN_ENGINE_ESTIMATE_VERSION,
          monthsCount,
          annualKwh: Number(annualKwh.toFixed(6)),
          tdsp: { per: tdspPer, monthly: tdspMonthly, effectiveDate: tdspEff },
          rsSha,
          usageSha,
          estimateMode,
        }),
      );

      const cacheRatePlanId = ratePlanId ?? "";
      const cached = await getCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: cacheRatePlanId,
        inputsSha256,
        monthsCount,
      });
      if (cached) return cached;

      const est = estimateTrueCost({
        annualKwh, // 12 months total used by this endpoint
        monthsCount,
        tdspRates: { perKwhDeliveryChargeCents: tdspPer, monthlyCustomerChargeDollars: tdspMonthly, effectiveDate: tdspEff },
        rateStructure,
        usageBucketsByMonth: usageBucketsByMonthForCalc,
        estimateMode,
      });

      await putCachedPlanEstimate({
        houseAddressId: house.id,
        ratePlanId: cacheRatePlanId,
        esiid: usageSource === "SMT" ? (house.esiid ?? null) : null,
        inputsSha256,
        monthsCount,
        payloadJson: est,
      });

      return est;
    })();

    const effectiveCentsPerKwh =
      (((trueCostEstimate as any)?.status === "OK") || ((trueCostEstimate as any)?.status === "APPROXIMATE")) &&
      typeof (trueCostEstimate as any)?.annualCostDollars === "number" &&
      annualKwh &&
      annualKwh > 0
        ? (((trueCostEstimate as any).annualCostDollars as number) / annualKwh) * 100
        : null;

    const math = {
      status: String((trueCostEstimate as any)?.status ?? ""),
      reason: (trueCostEstimate as any)?.reason ?? null,
      requiredBucketKeys,
      componentsV2: (trueCostEstimate as any)?.componentsV2 ?? null,
      components: (trueCostEstimate as any)?.components ?? null,
    };

    // Monthly breakdown table (for Plan Details UI).
    // This is a transparent rendering of the same engine math, but expanded by month so totals sum to annual.
    const monthlyBreakdown = (() => {
      if (!rsPresent || !tdspApplied) return null;
      if (String((trueCostEstimate as any)?.status ?? "") !== "OK") return null;
      const byMonth = usageBucketsByMonthForCalc ?? {};
      const monthsAll = Object.keys(byMonth).sort();
      if (monthsAll.length === 0) return null;
      const months = monthsAll.slice(-12);

      const tdspPerKwhCents = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(rateStructure) ?? 0;

      const creditsMaybe = extractDeterministicBillCredits(rateStructure);
      const minimumMaybe = extractDeterministicMinimumRules({ rateStructure });
      const tieredMaybe = extractDeterministicTierSchedule(rateStructure);
      const touMaybe = extractDeterministicTouSchedule(rateStructure);
      const repFixedEnergyCents = extractFixedRepEnergyCentsPerKwh(rateStructure);

      // Determine REP bucket columns (for TOU schedule, we show each period; otherwise just total).
      const repBuckets: Array<{ bucketKey: string; label: string }> = (() => {
        if (touMaybe?.schedule?.periods?.length) {
          const uniq = new Map<string, { bucketKey: string; label: string }>();
          for (const p of touMaybe.schedule.periods) {
            const dayType = String((p as any)?.dayType ?? "").trim();
            const startHHMM = String((p as any)?.startHHMM ?? "").trim();
            const endHHMM = String((p as any)?.endHHMM ?? "").trim();
            if (!dayType || !startHHMM || !endHHMM) continue;
            const bucketKey =
              startHHMM === "0000" && endHHMM === "2400"
                ? `kwh.m.${dayType}.total`
                : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
            const labelRaw = (p as any)?.label ?? null;
            const label =
              typeof labelRaw === "string" && labelRaw.trim()
                ? labelRaw.trim()
                : `${dayType.toUpperCase()} ${startHHMM}-${endHHMM}`;
            if (!uniq.has(bucketKey)) uniq.set(bucketKey, { bucketKey, label });
          }
          return Array.from(uniq.values());
        }
        return [{ bucketKey: "kwh.m.all.total", label: "ALL 00:00-24:00" }];
      })();

      const rows = months.map((ym) => {
        const m = byMonth[ym] ?? null;
        const totalKwh = monthKwh(m, "kwh.m.all.total");
        const repFixedCents = repFixedMonthly * 100;
        const tdspFixedCents = tdspMonthly * 100;
        const tdspDeliveryCents = totalKwh != null ? totalKwh * tdspPerKwhCents : null;

        // REP energy by bucket
        const repBucketLines = repBuckets.map((b) => {
          const kwh = monthKwh(m, b.bucketKey);
          let repCentsPerKwh: number | null = null;
          let repCostCents: number | null = null;
          let repCostDollars: number | null = null;
          let notes: string[] = [];

          if (kwh != null) {
            if (touMaybe?.schedule?.periods?.length) {
              const p = touMaybe.schedule.periods.find((pp: any) => {
                const dayType = String(pp?.dayType ?? "").trim();
                const startHHMM = String(pp?.startHHMM ?? "").trim();
                const endHHMM = String(pp?.endHHMM ?? "").trim();
                const key =
                  startHHMM === "0000" && endHHMM === "2400"
                    ? `kwh.m.${dayType}.total`
                    : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
                return key === b.bucketKey;
              });
              repCentsPerKwh =
                p && typeof (p as any)?.repEnergyCentsPerKwh === "number" ? (p as any).repEnergyCentsPerKwh : null;
              if (repCentsPerKwh != null) {
                repCostCents = kwh * repCentsPerKwh;
              }
            } else if (tieredMaybe?.ok && totalKwh != null) {
              // Tiered: no single cents/kWh. We show an effective cents/kWh for the month.
              const tiered = computeRepEnergyCostForMonthlyKwhTiered({
                monthlyKwh: totalKwh,
                schedule: tieredMaybe.schedule,
              });
              repCostCents = tiered.repEnergyCentsTotal;
              repCentsPerKwh = totalKwh > 0 ? repCostCents / totalKwh : null;
              notes = ["tiered"];
            } else if (typeof repFixedEnergyCents === "number") {
              repCentsPerKwh = repFixedEnergyCents;
              repCostCents = kwh * repFixedEnergyCents;
            }
          }

          if (repCostCents != null) repCostDollars = round2(repCostCents / 100);

          return {
            bucketKey: b.bucketKey,
            label: b.label,
            kwh,
            repCentsPerKwh,
            repCostDollars,
            notes: notes.length ? notes : null,
          };
        });

        const repEnergyCents = repBucketLines.reduce((acc, x: any) => acc + (typeof x?.repCostDollars === "number" ? x.repCostDollars * 100 : 0), 0);

        // Credits (negative cents)
        const creditsApplied =
          creditsMaybe?.ok && totalKwh != null ? applyBillCreditsToMonth({ monthlyKwh: totalKwh, credits: creditsMaybe.credits }) : null;
        const creditsCents = creditsApplied ? creditsApplied.creditCentsTotal : 0;

        const subtotalCentsRaw =
          (repEnergyCents || 0) +
          repFixedCents +
          tdspFixedCents +
          (tdspDeliveryCents ?? 0) +
          creditsCents;

        let minUsageFeeCents = 0;
        let minBillTopUpCents = 0;
        let finalCents = clampNonNegative(roundCents(subtotalCentsRaw));
        if (minimumMaybe?.ok && totalKwh != null) {
          const appliedMin = applyMinimumRulesToMonth({
            monthlyKwh: totalKwh,
            minimum: minimumMaybe.minimum,
            subtotalCents: roundCents(subtotalCentsRaw),
          });
          minUsageFeeCents = appliedMin.minUsageFeeCents;
          minBillTopUpCents = appliedMin.minimumBillTopUpCents;
          finalCents = appliedMin.totalCentsAfter;
        }

        return {
          yearMonth: ym,
          bucketTotalKwh: totalKwh,
          repBuckets: repBucketLines,
          tdsp: {
            perKwhDeliveryChargeCents: tdspPerKwhCents,
            deliveryDollars: tdspDeliveryCents != null ? round2(tdspDeliveryCents / 100) : null,
            monthlyCustomerChargeDollars: round2(tdspMonthly),
          },
          repFixedMonthlyChargeDollars: round2(repFixedMonthly),
          creditsDollars: creditsApplied ? round2(creditsCents / 100) : null,
          minimumUsageFeeDollars: minimumMaybe?.ok ? round2(minUsageFeeCents / 100) : null,
          minimumBillTopUpDollars: minimumMaybe?.ok ? round2(minBillTopUpCents / 100) : null,
          totalDollars: round2(finalCents / 100),
        };
      });

      const totals = (() => {
        const annualCents = rows.reduce((acc: number, r: any) => acc + (typeof r?.totalDollars === "number" ? roundCents(r.totalDollars * 100) : 0), 0);
        const annualFromRows = round2(annualCents / 100);
        const expectedAnnual = typeof (trueCostEstimate as any)?.annualCostDollars === "number" ? (trueCostEstimate as any).annualCostDollars : null;
        const expectedAnnualCents =
          typeof expectedAnnual === "number" && Number.isFinite(expectedAnnual) ? roundCents(expectedAnnual * 100) : null;
        const deltaCents =
          expectedAnnualCents != null ? (annualCents - expectedAnnualCents) : null;
        return { annualFromRows, expectedAnnual, deltaCents };
      })();

      return {
        monthsCount: rows.length,
        repBuckets,
        rows,
        totals,
      };
    })();

    return NextResponse.json(
      {
        ok: true,
        offerId,
        isRenter,
        plan: {
          supplierName: offer?.supplier_name ?? null,
          planName: offer?.plan_name ?? null,
          termMonths: typeof offer?.term_months === "number" ? offer.term_months : null,
          rateType: offer?.rate_type ?? null,
          renewablePercent: numOrNull(offer?.green_percentage),
          eflUrl: offer?.docs?.efl ?? null,
          utilityName: offer?.distributor_name ?? house.utilityName ?? null,
          tdspSlug: tdspSlug || null,
        },
        template: ratePlanRow
          ? {
              ratePlanId: ratePlanRow.id,
              repPuctCertificate: ratePlanRow.repPuctCertificate ?? null,
              eflVersionCode: ratePlanRow.eflVersionCode ?? null,
              planCalcStatus,
              planCalcReasonCode,
              requiredBucketKeys,
            }
          : null,
        usage: {
          source: usageSource,
          intervalsCount,
          windowStart: windowStart ? windowStart.toISOString() : null,
          windowEnd: windowEnd ? windowEnd.toISOString() : null,
          cutoff: window.cutoff.toISOString(),
          bucketsMode: "required",
          yearMonths,
          avgMonthlyKwh,
          annualKwh, // 12 full months total (sum of kwh.m.all.total over yearMonths)
          stitchedMonth: bucketBuild.stitchedMonth,
          bucketDefs: bucketDefsForResponse,
          bucketTable,
        },
        variables: {
          tdsp: tdspApplied,
          rep: {
            energyCentsPerKwh: repEnergyCentsPerKwh,
            fixedMonthlyChargeDollars: repFixedMonthlyChargeDollars,
          },
        },
        variablesList,
        monthlyBreakdown,
        math,
        outputs: {
          trueCostEstimate,
          effectiveCentsPerKwh,
        },
        notes: [
          "This page uses a stitched 12-month window (America/Chicago): prior 11 full months + current month filled using prior-year tail days, so monthly fixed fees are counted exactly 12 times.",
          "Bucket totals are loaded from the usage DB (homeMonthlyUsageBucket) in America/Chicago local time.",
          "Missing required buckets are auto-created and computed on-demand (best-effort) for this plan.",
        ],
      },
      {
        status: 200,
        headers: {
          // User-specific (cookie auth). This reduces repeat loads/back-navigation delays without
          // affecting the canonical plan-engine output cache (which lives in the WattBuy Offers DB).
          "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

