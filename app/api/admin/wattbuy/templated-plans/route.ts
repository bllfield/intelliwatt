import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { sha256Hex as sha256HexCache } from "@/lib/plan-engine/planEstimateCache";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PLAN_ENGINE_ESTIMATE_VERSION = "estimateTrueCost_v4";
const PLAN_ENGINE_ESTIMATE_ENDPOINTS = ["PLAN_ENGINE_ESTIMATE_V1", "PLAN_ENGINE_ESTIMATE_V2"];
const PLAN_ENGINE_ESTIMATE_MONTHS = 12;
const BUCKET_GATING_REASON_CODES = new Set<string>([
  "BILL_CREDITS_REQUIRES_USAGE_BUCKETS",
  "MINIMUM_RULES_REQUIRES_USAGE_BUCKETS",
  "TIERED_REQUIRES_USAGE_BUCKETS",
  "TIERED_PLUS_CREDITS_REQUIRES_USAGE_BUCKETS",
  "TOU_REQUIRES_USAGE_BUCKETS_PHASE2",
  "TOU_PLUS_CREDITS_REQUIRES_USAGE_BUCKETS",
  "TOU_REQUIRES_USAGE_BUCKETS",
]);

type TdspDelivery = { monthlyFeeCents: number; deliveryCentsPerKwh: number };
type TdspSnapshotMeta = TdspDelivery & { tdspCode: string; snapshotAt: string };

function normalizeTdspSlug(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  // Accept either slug or code-style values.
  if (s === "oncor") return "oncor";
  if (s === "centerpoint" || s === "center_point") return "centerpoint";
  if (s === "aep_north" || s === "aepnorth" || s === "aep-north") return "aep_north";
  if (s === "aep_central" || s === "aepcentral" || s === "aep-central") return "aep_central";
  if (s === "tnmp") return "tnmp";
  return s;
}

function safePositiveNum(v: string | null | undefined): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildSimUsageByMonth(args: { yearMonths: string[]; annualKwh: number; bucketKeys: string[] }): Record<string, Record<string, number>> {
  const byMonth: Record<string, Record<string, number>> = {};
  const months = Math.max(1, args.yearMonths.length);
  const monthlyTotal = args.annualKwh / months;
  const bucketKeys = Array.from(new Set(args.bucketKeys.map((k) => String(k ?? "").trim()).filter(Boolean)));
  for (const ym of args.yearMonths) {
    const row: Record<string, number> = {};
    row["kwh.m.all.total"] = Number(monthlyTotal.toFixed(6));

    const extras = bucketKeys.filter((k) => k !== "kwh.m.all.total");
    if (extras.length > 0) {
      const hasWeekday = extras.includes("kwh.m.weekday.total");
      const hasWeekend = extras.includes("kwh.m.weekend.total");
      if (hasWeekday && hasWeekend) {
        row["kwh.m.weekday.total"] = Number((monthlyTotal * (5 / 7)).toFixed(6));
        row["kwh.m.weekend.total"] = Number((monthlyTotal * (2 / 7)).toFixed(6));
        for (const k of extras) {
          if (k === "kwh.m.weekday.total" || k === "kwh.m.weekend.total") continue;
          row[k] = 0;
        }
      } else {
        const per = monthlyTotal / extras.length;
        for (const k of extras) row[k] = Number(per.toFixed(6));
      }
    }
    byMonth[ym] = row;
  }
  return byMonth;
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
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" });
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

function isPassStrength(v: any): v is "STRONG" | "WEAK" | "INVALID" {
  return v === "STRONG" || v === "WEAK" || v === "INVALID";
}

function isValidationStatus(v: any): v is "PASS" | "FAIL" | "SKIP" {
  return v === "PASS" || v === "FAIL" || v === "SKIP";
}

/**
 * Prefer persisted embedded evidence (rateStructure.__eflAvgPriceEvidence.passStrength).
 * For older templates that predate evidence embedding, use a conservative fallback:
 * - If validation is PASS and the stored template shape is a simple FIXED flat plan, treat as STRONG.
 * - Otherwise return null (unknown).
 */
function inferPassStrengthFallback(args: {
  rateStructure: any | null;
  modeledValidationCol: any | null;
}): "STRONG" | "WEAK" | "INVALID" | null {
  const rsObj: any =
    args.rateStructure && typeof args.rateStructure === "object"
      ? args.rateStructure
      : null;

  const embedded = rsObj?.__eflAvgPriceEvidence?.passStrength ?? null;
  if (isPassStrength(embedded)) return embedded;

  const vCol = args.modeledValidationCol && typeof args.modeledValidationCol === "object"
    ? args.modeledValidationCol
    : null;
  const status = (vCol as any)?.status ?? null;
  if (!isValidationStatus(status) || status !== "PASS") return null;

  const rateType = String(rsObj?.type ?? "").toUpperCase();
  const hasCredits =
    Boolean(rsObj?.billCredits?.hasBillCredit) ||
    (Array.isArray(rsObj?.billCredits?.rules) && rsObj.billCredits.rules.length > 0);
  const hasUsageTiers = Array.isArray(rsObj?.usageTiers) && rsObj.usageTiers.length > 0;
  const hasTouTiers = Array.isArray(rsObj?.timeOfUsePeriods) || Array.isArray(rsObj?.tiers);

  const isSimpleFlat =
    rateType === "FIXED" && !hasCredits && !hasUsageTiers && !hasTouTiers;

  return isSimpleFlat ? "STRONG" : null;
}

function mapUtilityIdToTdspCode(utilityId: string | null | undefined): string | null {
  const u = String(utilityId ?? "").trim();
  if (!u) return null;
  const upper = u.toUpperCase();
  // Already normalized TdspCode (manual loader tends to write these).
  if (["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"].includes(upper)) return upper;
  // WattBuy utilityIDs (EIDs) we see in practice.
  const byWattbuyId: Record<string, string> = {
    "44372": "ONCOR",
    "8901": "CENTERPOINT",
    "20404": "AEP_NORTH",
    "3278": "AEP_CENTRAL",
    "40051": "TNMP",
  };
  return byWattbuyId[u] ?? null;
}

function inferTermMonths(planName: string | null | undefined): number | null {
  if (!planName) return null;
  const s = String(planName);
  // Strongest: explicit "mo/month" tokens
  const m1 = s.match(/\b(\d{1,2})\s*(?:mo|mos|month|months)\b/i);
  if (m1) {
    const n = Number(m1[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: trailing number (e.g., "Solarize 15")
  const m2 = s.match(/\b(\d{1,2})\b\s*$/);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  // Next: "-12" suffix pattern (avoid big IDs by limiting to 1-2 digits)
  const m3 = s.match(/-(\d{1,2})\b/);
  if (m3) {
    const n = Number(m3[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
  }

  return null;
}

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function hashUsageInputs(args: {
  yearMonths: string[];
  bucketKeys: string[];
  usageBucketsByMonth: Record<string, Record<string, number>>;
}): string {
  // Must be stable across callers (pipeline + dashboard). Mirrors lib/plan-engine/runPlanPipelineForHome.ts.
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

function computeAvgCentsPerKwhFromRateStructure(
  rateStructure: any,
  usageKwh: number,
): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  if (!Number.isFinite(usageKwh) || usageKwh <= 0) return null;

  const type = String(rateStructure.type ?? "").toUpperCase();
  const baseFee = toNum(rateStructure.baseMonthlyFeeCents) ?? 0;

  const usageTiers: any[] | null = Array.isArray(rateStructure.usageTiers)
    ? rateStructure.usageTiers
    : null;

  const computeTieredEnergyCents = (): number | null => {
    if (!usageTiers || usageTiers.length === 0) return null;
    const tiers = usageTiers
      .map((t) => ({
        // Support multiple historical tier field variants.
        // Canonical: { minKWh, maxKWh, centsPerKWh }
        // Legacy/admin: { minimumUsageKWh, maximumUsageKwh, energyChargeCentsPerkWh }
        minKWh:
          toNum(
            (t as any).minKWh ??
              (t as any).minKwh ??
              (t as any).minimumUsageKWh ??
              (t as any).minimumUsageKwh ??
              (t as any).tierMinKWh ??
              (t as any).tierMinKwh ??
              0,
          ) ?? 0,
        maxKWh: toNum(
          (t as any).maxKWh ??
            (t as any).maxKwh ??
            (t as any).maximumUsageKWh ??
            (t as any).maximumUsageKwh ??
            (t as any).tierMaxKWh ??
            (t as any).tierMaxKwh ??
            null,
        ),
        centsPerKWh: toNum(
          (t as any).centsPerKWh ??
            (t as any).priceCents ??
            (t as any).rateCentsPerKwh ??
            (t as any).energyChargeCentsPerkWh ??
            (t as any).energyChargeCentsPerKwh,
        ),
      }))
      .filter((t) => Number.isFinite(t.minKWh) && typeof t.centsPerKWh === "number")
      .sort((a, b) => a.minKWh - b.minKWh);

    if (tiers.length === 0) return null;

    let remaining = usageKwh;
    let energyCents = 0;

    for (let i = 0; i < tiers.length && remaining > 0; i++) {
      const t = tiers[i];
      const nextMin = tiers[i + 1]?.minKWh ?? null;
      const upper =
        typeof t.maxKWh === "number"
          ? t.maxKWh
          : typeof nextMin === "number"
            ? nextMin
            : null;
      const span = upper != null ? Math.max(0, upper - t.minKWh) : remaining;
      const kwhInTier = Math.min(remaining, span);
      if (kwhInTier <= 0) continue;
      energyCents += kwhInTier * (t.centsPerKWh as number);
      remaining -= kwhInTier;
    }

    // If there is remaining usage beyond the last tier, bill it at the last tier's rate.
    if (remaining > 0) {
      const last = tiers[tiers.length - 1];
      if (typeof last?.centsPerKWh === "number") {
        energyCents += remaining * last.centsPerKWh;
      }
    }

    return energyCents;
  };

  const computeFlatEnergyCents = (centsPerKwh: number | null): number | null => {
    if (typeof centsPerKwh !== "number") return null;
    return usageKwh * centsPerKwh;
  };

  let energyCents: number | null = null;
  if (usageTiers && usageTiers.length > 0) {
    energyCents = computeTieredEnergyCents();
  }

  if (energyCents == null) {
    if (type === "FIXED") {
      // Some stored shapes use defaultRateCentsPerKwh rather than energyRateCents.
      energyCents = computeFlatEnergyCents(
        toNum(rateStructure.energyRateCents) ?? toNum(rateStructure.defaultRateCentsPerKwh),
      );
    } else if (type === "VARIABLE") {
      energyCents = computeFlatEnergyCents(toNum(rateStructure.currentBillEnergyRateCents));
    } else {
      // TIME_OF_USE requires usage distribution; we don't guess.
      return null;
    }
  }

  const credits = rateStructure.billCredits;
  let billCreditCents = 0;
  if (credits && credits.hasBillCredit && Array.isArray(credits.rules)) {
    for (const r of credits.rules) {
      const credit = toNum((r as any).creditAmountCents);
      const min = toNum((r as any).minUsageKWh) ?? 0;
      const max = toNum((r as any).maxUsageKWh ?? null);
      if (typeof credit !== "number" || credit <= 0) continue;
      const okMin = usageKwh >= min;
      const okMax = max == null ? true : usageKwh <= max;
      if (okMin && okMax) {
        billCreditCents += credit;
      }
    }
  }

  const totalCents = (energyCents ?? 0) + baseFee - billCreditCents;
  return totalCents / usageKwh;
}

function computeAllInAvgCentsPerKwhFromRateStructure(
  rateStructure: any,
  usageKwh: number,
  tdsp: TdspDelivery | null,
): number | null {
  const supplyAvg = computeAvgCentsPerKwhFromRateStructure(rateStructure, usageKwh);
  if (supplyAvg == null) return null;
  // If the REP rate already includes TDSP delivery, do NOT add utility delivery charges.
  if (rateStructure?.tdspDeliveryIncludedInEnergyCharge === true) return supplyAvg;
  // "All-in model" requires a known TDSP tariff snapshot; otherwise we don't show a misleading value.
  if (!tdsp) return null;
  const tdspMonthly = toNum(tdsp.monthlyFeeCents) ?? 0;
  const tdspPerKwh = toNum(tdsp.deliveryCentsPerKwh) ?? 0;
  const totalCents = supplyAvg * usageKwh + tdspMonthly + tdspPerKwh * usageKwh;
  return totalCents / usageKwh;
}

type Row = {
  id: string;
  offerId?: string | null;
  utilityId: string;
  state: string;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  planCalcStatus?: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN" | null;
  planCalcReasonCode?: string | null;
  requiredBucketKeys?: string[] | null;
  queued?: boolean;
  queuedReason?: string | null;
  rate500: number | null;
  rate1000: number | null;
  rate2000: number | null;
  modeledRate500: number | null;
  modeledRate1000: number | null;
  modeledRate2000: number | null;
  modeledTdspCode: string | null;
  modeledTdspSnapshotAt: string | null;
  modeledSource?: "DB_VALIDATION" | "COMPUTED_TDSP_SNAPSHOT" | "NONE";
  validationStatus?: "PASS" | "FAIL" | "SKIP" | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  cancelFee: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflRequiresManualReview: boolean;
  updatedAt: string;
  lastSeenAt: string;
  rateStructure: unknown;
  usagePreview?: {
    months: number;
    annualKwh: number | null;
    avgMonthlyKwhByKey: Record<string, number>;
    missingKeys: string[];
  } | null;
  usageEstimate?: any | null;
};

type Ok = {
  ok: true;
  count: number;
  totalCount: number;
  limit: number;
  rows: Row[];
  offerCount?: number;
  mappedOfferCount?: number;
  usageContext?: {
    homeId: string;
    homeIdSource?: "EXPLICIT" | "AUTO" | null;
    monthsRequested: number;
    monthsFound: number;
    avgMonthlyKwh: number | null;
    annualKwh: number | null;
    bucketKeysUsed: string[];
  } | null;
};

type Err = { ok: false; error: string; details?: unknown };

function jsonError(status: number, error: string, details?: unknown) {
  const body: Err = { ok: false, error, ...(details ? { details } : {}) };
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 200));

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const includeLegacy = req.nextUrl.searchParams.get("includeLegacy") === "1";
    const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
    const city = (req.nextUrl.searchParams.get("city") ?? "").trim();
    const state = (req.nextUrl.searchParams.get("state") ?? "").trim();
    const zip = (req.nextUrl.searchParams.get("zip") ?? "").trim();
    const homeId = (req.nextUrl.searchParams.get("homeId") ?? "").trim();
    const useDefaultHome = req.nextUrl.searchParams.get("useDefaultHome") === "1";
    const usageMonthsRaw = Number(req.nextUrl.searchParams.get("usageMonths") ?? "12");
    const usageMonths = Math.max(1, Math.min(12, Number.isFinite(usageMonthsRaw) ? Math.floor(usageMonthsRaw) : 12));

    const simulateTdspSlug = normalizeTdspSlug(req.nextUrl.searchParams.get("simulateTdspSlug"));
    const simulateAvgMonthlyKwh = safePositiveNum(req.nextUrl.searchParams.get("simulateAvgMonthlyKwh"));
    const simulateAnnualKwh = safePositiveNum(req.nextUrl.searchParams.get("simulateAnnualKwh"));

    const hasAddressFilter = Boolean(address && city && state && zip);

    const normalizedQ = (() => {
      const s = String(q ?? "").trim();
      if (!s) return { raw: "", key: "" };
      const key = s
        .toLowerCase()
        .replace(/[\s\-]+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
      return { raw: s, key };
    })();

    const utilityIdHintsForQ = (key: string): string[] => {
      const byKey: Record<string, string[]> = {
        oncor: ["ONCOR", "44372"],
        centerpoint: ["CENTERPOINT", "8901"],
        aep_north: ["AEP_NORTH", "20404"],
        aepnorth: ["AEP_NORTH", "20404"],
        aep_central: ["AEP_CENTRAL", "3278"],
        aepcentral: ["AEP_CENTRAL", "3278"],
        tnmp: ["TNMP", "40051"],
      };
      return byKey[key] ?? [];
    };

    const utilityIdHints = normalizedQ.key ? utilityIdHintsForQ(normalizedQ.key) : [];

    const where: any = {
      // “Templated” means we already have a usable engine structure persisted.
      rateStructure: { not: null },
      eflRequiresManualReview: false,
      isUtilityTariff: false,
      // Default to “new system only”: requires canonical modeled validation proof
      // so legacy templates don't pollute the admin templates list.
      ...(includeLegacy ? {} : { modeledEflAvgPriceValidation: { not: null } }),
      ...(q
        ? {
            OR: [
              // Common admin expectation: search by utility/territory (ONCOR, TNMP, etc.)
              ...(utilityIdHints.length ? [{ utilityId: { in: utilityIdHints } }] : []),
              { utilityId: { contains: q, mode: "insensitive" } },
              { supplier: { contains: q, mode: "insensitive" } },
              { planName: { contains: q, mode: "insensitive" } },
              { eflVersionCode: { contains: q, mode: "insensitive" } },
              { repPuctCertificate: { contains: q, mode: "insensitive" } },
              { eflPdfSha256: { contains: q, mode: "insensitive" } },
              { eflUrl: { contains: q, mode: "insensitive" } },
              { eflSourceUrl: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    let offerCount: number | undefined = undefined;
    let mappedOfferCount: number | undefined = undefined;

    if (hasAddressFilter) {
      // Filter templates to only those linked to offers currently available for the requested home.
      // This uses OfferIdRatePlanMap (canonical offer_id → RatePlan.id mapping).
      const rawOffers = await wattbuy.offers({ address, city, state, zip });
      const normalized = normalizeOffers(rawOffers ?? {});
      const offerIds = normalized.offers.map((o) => o.offer_id).filter(Boolean);
      offerCount = offerIds.length;

      if (offerIds.length === 0) {
        const body: Ok = { ok: true, count: 0, totalCount: 0, limit, rows: [], offerCount: 0, mappedOfferCount: 0 };
        return NextResponse.json(body);
      }

      const maps = await (prisma as any).offerIdRatePlanMap.findMany({
        where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
        select: { offerId: true, ratePlanId: true },
      });

      const ratePlanIds = Array.from(
        new Set(
          (maps as Array<{ ratePlanId: string | null }>).map((m) => m.ratePlanId).filter(Boolean) as string[],
        ),
      );
      mappedOfferCount = ratePlanIds.length;

      // If WattBuy offers exist but none are mapped to templates yet, return empty.
      if (ratePlanIds.length === 0) {
        const body: Ok = {
          ok: true,
          count: 0,
          totalCount: 0,
          limit,
          rows: [],
          offerCount,
          mappedOfferCount: 0,
        };
        return NextResponse.json(body);
      }

      where.id = { in: ratePlanIds };
    }

    const plans = await (prisma as any).ratePlan.findMany({
      where,
      select: {
        id: true,
        utilityId: true,
        state: true,
        supplier: true,
        planName: true,
        termMonths: true,
        planCalcStatus: true,
        planCalcReasonCode: true,
        requiredBucketKeys: true,
        rate500: true,
        rate1000: true,
        rate2000: true,
        modeledRate500: true,
        modeledRate1000: true,
        modeledRate2000: true,
        modeledEflAvgPriceValidation: true,
        modeledComputedAt: true,
        cancelFee: true,
        eflUrl: true,
        eflPdfSha256: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflRequiresManualReview: true,
        isUtilityTariff: true,
        updatedAt: true,
        lastSeenAt: true,
        rateStructure: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });

    const totalCount = await (prisma as any).ratePlan.count({ where });

    // Attach offerId (so admin UI can deep-link to /admin/plans/[offerId]).
    // Note: multiple offers can map to the same ratePlanId; we pick the newest link by lastLinkedAt.
    const planIds = Array.isArray(plans)
      ? (plans as any[]).map((p) => String(p?.id ?? "")).filter(Boolean)
      : [];
    const offerIdByPlanId = new Map<string, string>();
    if (planIds.length > 0) {
      const links = await (prisma as any).offerIdRatePlanMap.findMany({
        where: { ratePlanId: { in: planIds } },
        select: { offerId: true, ratePlanId: true, lastLinkedAt: true },
        orderBy: { lastLinkedAt: "desc" },
        take: Math.min(10_000, planIds.length * 5),
      });
      for (const l of Array.isArray(links) ? (links as any[]) : []) {
        const pid = String(l?.ratePlanId ?? "").trim();
        const oid = String(l?.offerId ?? "").trim();
        if (!pid || !oid) continue;
        if (!offerIdByPlanId.has(pid)) offerIdByPlanId.set(pid, oid);
      }
    }

    const tdspCache = new Map<string, Promise<TdspSnapshotMeta | null>>();
    const getTdsp = async (utilId: string): Promise<TdspSnapshotMeta | null> => {
      const code = mapUtilityIdToTdspCode(utilId);
      if (!code) return null;
      const cached = tdspCache.get(code);
      if (cached) return cached;
      const p = (async () => {
        const at = new Date();
        const row =
          (await (prisma as any).tdspRateSnapshot.findFirst({
            where: { tdsp: code, effectiveAt: { lte: at } },
            orderBy: { effectiveAt: "desc" },
          })) ||
          (await (prisma as any).tdspRateSnapshot.findFirst({
            where: { tdsp: code },
            orderBy: { createdAt: "desc" },
          }));
        if (!row) return null;
        const payload: any = row.payload ?? {};
        const snapAt = (row.effectiveAt ?? row.createdAt) as Date;
        return {
          tdspCode: code,
          snapshotAt: new Date(snapAt).toISOString(),
          monthlyFeeCents: Number(payload?.monthlyFeeCents || 0),
          deliveryCentsPerKwh: Number(payload?.deliveryCentsPerKwh || 0),
        } satisfies TdspSnapshotMeta;
      })();
      tdspCache.set(code, p);
      return p;
    };

    // Optional: attach usage-based monthly estimates for a specific homeId.
    let usageByMonth: Record<string, Record<string, number>> | null = null;
    let usageEnv:
      | {
          homeId: string;
          monthsRequested: number;
          monthsFound: number;
          annualKwh: number | null;
          avgMonthlyKwh: number | null;
          bucketKeysUsed: string[];
          byMonth: Record<string, Record<string, number>>;
          yearMonths: string[];
        }
      | null = null;

    // Precompute plan-calc derivations so we can decide which bucket keys to load.
    const planMeta = (plans as any[]).map((p) => {
      const storedStatusRaw = typeof p?.planCalcStatus === "string" ? String(p.planCalcStatus) : null;
      const storedReasonRaw = typeof p?.planCalcReasonCode === "string" ? String(p.planCalcReasonCode) : null;
      const derivedCalc =
        storedStatusRaw === "COMPUTABLE" || storedStatusRaw === "NOT_COMPUTABLE" || storedStatusRaw === "UNKNOWN"
          ? {
              planCalcStatus: storedStatusRaw as "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN",
              planCalcReasonCode: storedReasonRaw ?? "UNKNOWN",
              requiredBucketKeys: Array.isArray(p?.requiredBucketKeys) ? (p.requiredBucketKeys as string[]) : null,
            }
          : derivePlanCalcRequirementsFromTemplate({ rateStructure: p.rateStructure ?? null });
      const pcStatus = (derivedCalc as any)?.planCalcStatus ?? null;
      const pcReason = String((derivedCalc as any)?.planCalcReasonCode ?? "UNKNOWN");
      const queued = pcStatus !== "COMPUTABLE";
      const requiredBucketKeys =
        Array.isArray((derivedCalc as any)?.requiredBucketKeys)
          ? ((derivedCalc as any).requiredBucketKeys as string[])
          : Array.isArray(p?.requiredBucketKeys)
            ? ((p.requiredBucketKeys as string[]) ?? [])
            : [];
      return { p, derivedCalc, pcStatus, pcReason, queued, requiredBucketKeys };
    });

    const resolvedHomeId = homeId.trim() ? homeId.trim() : null;
    let autoHomeId: string | null = null;
    let resolvedHomeIdSource: "EXPLICIT" | "AUTO" | null = resolvedHomeId ? "EXPLICIT" : null;

    if (!resolvedHomeId && useDefaultHome && !simulateTdspSlug) {
      // Pick a "best available" homeId for usage-based previews:
      // newest home with any kwh.m.all.total monthly bucket. Admin-only convenience.
      try {
        const newest = await (usagePrisma as any).homeMonthlyUsageBucket.findFirst({
          where: { bucketKey: "kwh.m.all.total" },
          orderBy: [{ yearMonth: "desc" }],
          select: { homeId: true, yearMonth: true },
        });
        const candidate = String((newest as any)?.homeId ?? "").trim();
        if (candidate) {
          const house = await prisma.houseAddress.findUnique({
            where: { id: candidate } as any,
            select: { id: true, archivedAt: true },
          });
          if (house && !(house as any).archivedAt) {
            autoHomeId = candidate;
            resolvedHomeIdSource = "AUTO";
          }
        }
      } catch {
        // ignore: default home is best-effort only
      }
    }

    const effectiveHomeId = resolvedHomeId ?? autoHomeId;
    let homeTdspSlug: string | null = null;

    if (simulateTdspSlug) {
      homeTdspSlug = simulateTdspSlug;
      const yearMonths = lastNYearMonthsChicago(usageMonths);
      const keys = new Set<string>(["kwh.m.all.total"]);
      for (const m of planMeta) {
        for (const k of m.requiredBucketKeys ?? []) {
          const kk = String(k ?? "").trim();
          if (kk) keys.add(kk);
        }
      }
      const bucketKeysUsed = Array.from(keys);
      const annualKwh =
        simulateAnnualKwh ??
        (simulateAvgMonthlyKwh != null ? simulateAvgMonthlyKwh * yearMonths.length : null);
      const byMonth =
        annualKwh != null
          ? buildSimUsageByMonth({ yearMonths, annualKwh, bucketKeys: bucketKeysUsed })
          : {};
      usageByMonth = byMonth;
      usageEnv = {
        homeId: "SIMULATED",
        monthsRequested: usageMonths,
        monthsFound: annualKwh != null ? yearMonths.length : 0,
        annualKwh: annualKwh != null ? Number(annualKwh.toFixed(3)) : null,
        avgMonthlyKwh: annualKwh != null ? Number((annualKwh / yearMonths.length).toFixed(3)) : null,
        bucketKeysUsed,
        byMonth,
        yearMonths,
      };
    } else if (effectiveHomeId) {
      const house = await prisma.houseAddress.findUnique({
        where: { id: effectiveHomeId } as any,
        select: { id: true, archivedAt: true, tdspSlug: true },
      });
      if (!house) return jsonError(404, "home_not_found", { homeId: effectiveHomeId });
      if ((house as any)?.archivedAt) return jsonError(404, "home_archived", { homeId: effectiveHomeId });
      homeTdspSlug = String((house as any)?.tdspSlug ?? "").trim().toLowerCase() || null;

      const yearMonths = lastNYearMonthsChicago(usageMonths);
      const keys = new Set<string>(["kwh.m.all.total"]);
      for (const m of planMeta) {
        for (const k of m.requiredBucketKeys ?? []) {
          const kk = String(k ?? "").trim();
          if (kk) keys.add(kk);
        }
      }
      const bucketKeysUsed = Array.from(keys);

      const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
        where: { homeId: effectiveHomeId, yearMonth: { in: yearMonths }, bucketKey: { in: bucketKeysUsed } },
        select: { yearMonth: true, bucketKey: true, kwhTotal: true },
      });

      const byMonth: Record<string, Record<string, number>> = {};
      for (const r of rows ?? []) {
        const ym = String((r as any)?.yearMonth ?? "").trim();
        const key = String((r as any)?.bucketKey ?? "").trim();
        const kwh = decimalToNumber((r as any)?.kwhTotal);
        if (!ym || !key || kwh == null) continue;
        if (!byMonth[ym]) byMonth[ym] = {};
        byMonth[ym][key] = kwh;
      }
      usageByMonth = byMonth;

      const allVals: number[] = [];
      for (const ym of yearMonths) {
        const v = byMonth?.[ym]?.["kwh.m.all.total"];
        if (typeof v === "number" && Number.isFinite(v)) allVals.push(v);
      }
      const monthsFound = allVals.length;
      const annualKwh = monthsFound ? allVals.reduce((a, b) => a + b, 0) : null;
      const avgMonthlyKwh = monthsFound && annualKwh != null ? annualKwh / monthsFound : null;

      usageEnv = {
        homeId: effectiveHomeId,
        monthsRequested: usageMonths,
        monthsFound,
        annualKwh: annualKwh != null ? Number(annualKwh.toFixed(3)) : null,
        avgMonthlyKwh: avgMonthlyKwh != null ? Number(avgMonthlyKwh.toFixed(3)) : null,
        bucketKeysUsed,
        byMonth,
        yearMonths,
      };
    }

    // Align admin "Queued" with the *site* queued state when a home context is provided:
    // - Template computability (planCalcStatus != COMPUTABLE) => queued
    // - Otherwise, queued if the plan-engine estimate cache does not yet have the computed estimate for this home
    //   (same inputs as the plan pipeline uses).
    let estimateCacheByInputsSha: Map<string, any> | null = null;
    let estimateUsageSha: string | null = null;
    let estimateTdsp: { per: number; monthly: number; effectiveDate: string | null } | null = null;

    if (effectiveHomeId && usageEnv && usageByMonth && typeof usageEnv.annualKwh === "number" && homeTdspSlug) {
      try {
        estimateUsageSha = hashUsageInputs({
          yearMonths: usageEnv.yearMonths,
          bucketKeys: usageEnv.bucketKeysUsed,
          usageBucketsByMonth: usageByMonth,
        });

        const tdspRates = await getTdspDeliveryRates({ tdspSlug: homeTdspSlug, asOf: new Date() }).catch(() => null);
        estimateTdsp = tdspRates
          ? {
              per: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
              monthly: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
              effectiveDate: (tdspRates?.effectiveDate ?? null) as any,
            }
          : null;

        const snapRows = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findMany({
          where: {
            endpoint: { in: PLAN_ENGINE_ESTIMATE_ENDPOINTS },
            houseAddressId: effectiveHomeId,
            requestKey: { contains: `|months=${PLAN_ENGINE_ESTIMATE_MONTHS}` },
          },
          orderBy: { createdAt: "desc" },
          take: 10_000,
          select: { payloadSha256: true, payloadJson: true },
        });
        const m = new Map<string, any>();
        for (const r of snapRows ?? []) {
          const sha = String((r as any)?.payloadSha256 ?? "").trim();
          if (!sha) continue;
          if (!m.has(sha)) m.set(sha, (r as any)?.payloadJson ?? null);
        }
        estimateCacheByInputsSha = m;
      } catch {
        estimateCacheByInputsSha = null;
        estimateUsageSha = null;
        estimateTdsp = null;
      }
    }

    const rows: Row[] = await Promise.all(
      planMeta.map(async (m) => {
        const p = m.p;
        const derivedCalc = m.derivedCalc;

        const rsObj: any = p.rateStructure && typeof p.rateStructure === "object" ? p.rateStructure : null;
        const v = rsObj?.__eflAvgPriceValidation ?? null;
        const embeddedStrength = (rsObj?.__eflAvgPriceEvidence?.passStrength as any) ?? null;
        const embeddedStatus = (v?.status as any) ?? null;
        const points: any[] = Array.isArray(v?.points) ? v.points : [];
        const modeledFromDb = (kwh: number): number | null => {
          const hit = points.find(
            (x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh,
          );
          const n = Number(
            hit?.modeledAvgCentsPerKwh ??
              hit?.modeledAvgPriceCentsPerKwh ??
              hit?.modeledCentsPerKwh,
          );
          return Number.isFinite(n) ? n : null;
        };
        const modeledDb500 = modeledFromDb(500);
        const modeledDb1000 = modeledFromDb(1000);
        const modeledDb2000 = modeledFromDb(2000);

        // Prefer the explicit modeled columns (evidence at persistence/backfill time),
        // but fall back to embedded RateStructure proof for older rows.
        const modeledCol500 = typeof p.modeledRate500 === "number" ? p.modeledRate500 : null;
        const modeledCol1000 = typeof p.modeledRate1000 === "number" ? p.modeledRate1000 : null;
        const modeledCol2000 = typeof p.modeledRate2000 === "number" ? p.modeledRate2000 : null;

        const effectiveDb500 = modeledCol500 ?? modeledDb500;
        const effectiveDb1000 = modeledCol1000 ?? modeledDb1000;
        const effectiveDb2000 = modeledCol2000 ?? modeledDb2000;

        const tdsp = await getTdsp(p.utilityId);
        const modeledSource: Row["modeledSource"] =
          typeof effectiveDb500 === "number" || typeof effectiveDb1000 === "number" || typeof effectiveDb2000 === "number"
            ? "DB_VALIDATION"
            : tdsp
              ? "COMPUTED_TDSP_SNAPSHOT"
              : "NONE";

        const pcStatus = (derivedCalc as any)?.planCalcStatus ?? null;
        const pcReason = String((derivedCalc as any)?.planCalcReasonCode ?? "UNKNOWN");
        const queuedByCalc = pcStatus !== "COMPUTABLE";
        const bucketGated = queuedByCalc && BUCKET_GATING_REASON_CODES.has(pcReason);

        // Optional: usage-based monthly estimate (for admin ranking / preview)
        let usagePreview: Row["usagePreview"] = null;
        let usageEstimate: Row["usageEstimate"] = null;
        let missingBucketKeys: string[] = [];
        const requiredKeys =
          Array.isArray((derivedCalc as any)?.requiredBucketKeys)
            ? ((derivedCalc as any).requiredBucketKeys as string[])
            : Array.isArray(p?.requiredBucketKeys)
              ? ((p.requiredBucketKeys as string[]) ?? [])
              : [];
        if (usageEnv) {
          const keysForRow = requiredKeys.length ? requiredKeys : ["kwh.m.all.total"];
          const missingKeys: string[] = [];
          const avgMonthlyKwhByKey: Record<string, number> = {};
          for (const k of keysForRow) {
            const kk = String(k ?? "").trim();
            if (!kk) continue;
            const vals: number[] = [];
            for (const ym of usageEnv.yearMonths) {
              const v0 = usageEnv.byMonth?.[ym]?.[kk];
              if (typeof v0 === "number" && Number.isFinite(v0)) vals.push(v0);
            }
            if (vals.length === 0) missingKeys.push(kk);
            else avgMonthlyKwhByKey[kk] = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
          }
          missingBucketKeys = missingKeys.slice();
          usagePreview = {
            months: usageEnv.monthsFound,
            annualKwh: usageEnv.annualKwh,
            avgMonthlyKwhByKey,
            missingKeys,
          };

          try {
            if (!usageEnv.annualKwh || usageEnv.monthsFound <= 0) {
              usageEstimate = { status: "NOT_IMPLEMENTED", reason: "Missing usage buckets (kwh.m.all.total)" };
            } else if (!p.rateStructure) {
              usageEstimate = { status: "NOT_IMPLEMENTED", reason: "Missing rateStructure" };
            } else if (!tdsp) {
              usageEstimate = { status: "NOT_IMPLEMENTED", reason: "Missing TDSP snapshot for utility" };
            } else {
              const estimateMode =
                String(p?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
                  ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
                  : ("DEFAULT" as const);
              usageEstimate = calculatePlanCostForUsage({
                annualKwh: usageEnv.annualKwh,
                monthsCount: usageEnv.monthsFound,
                tdsp: {
                  perKwhDeliveryChargeCents: Number(tdsp.deliveryCentsPerKwh ?? 0) || 0,
                  monthlyCustomerChargeDollars: Number(((tdsp.monthlyFeeCents ?? 0) / 100).toFixed(2)),
                  effectiveDate: tdsp.snapshotAt,
                },
                rateStructure: p.rateStructure,
                usageBucketsByMonth: usageByMonth ?? undefined,
                estimateMode,
              });
            }
          } catch (e: any) {
            usageEstimate = { status: "ERROR", reason: e?.message ?? String(e) };
          }
        }

        // Single source of truth for queued (must match what the site surfaces):
        // - If plan isn't computable from the template => queued
        // - Else if we have a home context, queued until the plan-engine estimate cache has a computed estimate
        //   for this home+plan+inputs.
        // If template is only "queued" because it needs usage buckets, and we have those buckets for this home,
        // treat it as computable for this home (then defer to estimate-cache state).
        const bucketGateSatisfied = bucketGated && usageEnv && missingBucketKeys.length === 0;

        let queued = queuedByCalc && !bucketGateSatisfied;
        let queuedReason: string | null = queued ? pcReason : null;

        if (
          !queued &&
          effectiveHomeId &&
          usageEnv &&
          typeof usageEnv.annualKwh === "number" &&
          estimateCacheByInputsSha &&
          estimateUsageSha &&
          estimateTdsp
        ) {
          try {
            const estimateMode =
              String((p as any)?.planCalcReasonCode ?? "").trim() === "INDEXED_APPROXIMATE_OK"
                ? ("INDEXED_EFL_ANCHOR_APPROX" as const)
                : ("DEFAULT" as const);
            const rsSha = sha256HexCache(JSON.stringify(p.rateStructure ?? null));
            const inputsSha256 = sha256HexCache(
              JSON.stringify({
                v: PLAN_ENGINE_ESTIMATE_VERSION,
                monthsCount: PLAN_ENGINE_ESTIMATE_MONTHS,
                annualKwh: Number(Number(usageEnv.annualKwh).toFixed(6)),
                tdsp: { per: estimateTdsp.per, monthly: estimateTdsp.monthly, effectiveDate: estimateTdsp.effectiveDate },
                rsSha,
                usageSha: estimateUsageSha,
                estimateMode,
              }),
            );

            const cached = estimateCacheByInputsSha.get(inputsSha256) ?? null;
            if (!cached) {
              queued = true;
              queuedReason = "estimate_cache_miss";
            } else {
              const st = String((cached as any)?.status ?? "").trim().toUpperCase();
              if (st && st !== "OK" && st !== "APPROXIMATE") {
                queued = true;
                queuedReason = String((cached as any)?.reason ?? st ?? "QUEUED");
              } else {
                queued = false;
                queuedReason = null;
              }
            }
          } catch {
            // best-effort only
          }
        }

        return {
          id: p.id,
          offerId: offerIdByPlanId.get(String(p.id)) ?? null,
          utilityId: p.utilityId,
          state: p.state,
          supplier: p.supplier ?? null,
          planName: p.planName ?? null,
          termMonths:
            typeof p.termMonths === "number"
              ? p.termMonths
              : inferTermMonths(p.planName ?? null),
          planCalcStatus: pcStatus,
          planCalcReasonCode: pcReason,
          requiredBucketKeys: requiredKeys.length ? requiredKeys : null,
          queued,
          queuedReason,
          rate500:
            typeof p.rate500 === "number"
              ? p.rate500
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 500),
          rate1000:
            typeof p.rate1000 === "number"
              ? p.rate1000
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 1000),
          rate2000:
            typeof p.rate2000 === "number"
              ? p.rate2000
              : computeAvgCentsPerKwhFromRateStructure(p.rateStructure, 2000),
          modeledRate500:
            typeof effectiveDb500 === "number"
              ? effectiveDb500
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 500, tdsp),
          modeledRate1000:
            typeof effectiveDb1000 === "number"
              ? effectiveDb1000
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 1000, tdsp),
          modeledRate2000:
            typeof effectiveDb2000 === "number"
              ? effectiveDb2000
              : computeAllInAvgCentsPerKwhFromRateStructure(p.rateStructure, 2000, tdsp),
          modeledTdspCode: tdsp?.tdspCode ?? null,
          modeledTdspSnapshotAt: tdsp?.snapshotAt ?? null,
          modeledSource,
          validationStatus:
            embeddedStatus === "PASS" || embeddedStatus === "FAIL" || embeddedStatus === "SKIP"
              ? embeddedStatus
              : null,
          passStrength:
            isPassStrength(embeddedStrength)
              ? embeddedStrength
              : inferPassStrengthFallback({
                  rateStructure: p.rateStructure ?? null,
                  modeledValidationCol: p.modeledEflAvgPriceValidation ?? null,
                }),
          cancelFee: p.cancelFee ?? null,
          eflUrl: p.eflUrl ?? null,
          eflPdfSha256: p.eflPdfSha256 ?? null,
          repPuctCertificate: p.repPuctCertificate ?? null,
          eflVersionCode: p.eflVersionCode ?? null,
          eflRequiresManualReview: Boolean(p.eflRequiresManualReview),
          updatedAt: new Date(p.updatedAt).toISOString(),
          lastSeenAt: new Date(p.lastSeenAt).toISOString(),
          rateStructure: p.rateStructure ?? null,
          usagePreview,
          usageEstimate,
        };
      }),
    );

    const body: Ok = {
      ok: true,
      count: rows.length,
      totalCount,
      limit,
      rows,
      offerCount,
      mappedOfferCount,
      usageContext: usageEnv
        ? {
            homeId: usageEnv.homeId,
            homeIdSource: resolvedHomeIdSource,
            monthsRequested: usageEnv.monthsRequested,
            monthsFound: usageEnv.monthsFound,
            avgMonthlyKwh: usageEnv.avgMonthlyKwh,
            annualKwh: usageEnv.annualKwh,
            bucketKeysUsed: usageEnv.bucketKeysUsed,
          }
        : null,
    };
    return NextResponse.json(body);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_TEMPLATED_PLANS] error:", err);
    return jsonError(500, "Internal error while listing templated plans", err?.message);
  }
}


