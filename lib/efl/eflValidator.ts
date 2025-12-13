import type { PlanRules, RateStructure } from "./planEngine";
import { computePlanCost } from "@/lib/planAnalyzer/planCostEngine";
import type {
  IntervalUsagePoint,
  RatePlanRef,
} from "@/lib/planAnalyzer/planTypes";

export type EflAvgPriceValidationStatus = "PASS" | "FAIL" | "SKIP";

export type EflAvgPricePoint = {
  kwh: 500 | 1000 | 2000;
  eflAvgCentsPerKwh: number;
};

export type EflTdspCharges = {
  /**
   * TDSP delivery charge in ¢/kWh as printed in the EFL, kept as a float
   * (e.g. 6.0009 for "6.0009 ¢ per kWh"). Never rounded to an int.
   */
  perKwhCents: number | null;
  /**
   * Fixed TDSP delivery charge in integer cents per month / billing cycle
   * (e.g. 490 for "$4.90 per billing cycle").
   */
  monthlyCents: number | null;
  snippet: string | null;
  confidence: "HIGH" | "MED" | "LOW";
};

export type ModeledComponents = {
  repEnergyDollars: number;
  repBaseDollars: number;
  tdspDollars: number;
  creditsDollars: number;
  totalDollars: number;
  avgCentsPerKwh: number;
  /**
   * REP-only total (energy + base - credits), excluding TDSP.
   * Null when we cannot reliably separate supply from TDSP.
   */
  supplyOnlyDollars: number | null;
};

export interface EflAvgPriceValidation {
  status: EflAvgPriceValidationStatus;
  toleranceCentsPerKwh: number;
  points: Array<{
    usageKwh: number;
    expectedAvgCentsPerKwh: number;
    modeledAvgCentsPerKwh: number | null;
    diffCentsPerKwh: number | null;
    ok: boolean;
    modeled?: {
      repEnergyDollars: number;
      repBaseDollars: number;
      tdspDollars: number;
      creditsDollars: number;
      totalDollars: number;
      /** REP-only total (energy + base - credits) in cents, if available. */
      supplyOnlyTotalCents?: number | null;
      /** TDSP dollars used for this point, in cents. */
      tdspTotalCentsUsed?: number | null;
      /** Total dollars used for this point, in cents. */
      totalCentsUsed?: number | null;
      /** Average ¢/kWh used for this point (mirrors modeledAvgCentsPerKwh). */
      avgCentsPerKwh?: number | null;
    } | null;
  }>;
  assumptionsUsed: {
    nightUsagePercent?: number;
    nightStartHour?: number;
    nightEndHour?: number;
    tdspIncludedInEnergyCharge?: boolean;
    tdspFromEfl?: {
      perKwhCents: number | null;
      monthlyCents: number | null;
      confidence: "HIGH" | "MED" | "LOW";
      snippet: string | null;
    };
    usedEngineTdspFallback?: boolean;
    tdspAppliedMode?:
      | "INCLUDED_IN_RATE"
      | "ADDED_FROM_EFL"
      | "ENGINE_DEFAULT"
      | "NONE";
  };
  fail: boolean;
  queueReason?: string;
  notes?: string[];
  avgTableFound: boolean;
  avgTableRows?: Array<{ kwh: number; avgPriceCentsPerKwh: number }>;
  avgTableSnippet?: string;
}

const DEFAULT_TOLERANCE_CENTS_PER_KWH = 0.25;
const VALIDATION_TZ = "America/Chicago";

// -------------------- Assumption-based detection --------------------

export function isAssumptionBasedAvgPriceTable(rawText: string): {
  isAssumptionBased: boolean;
  reason?: string;
} {
  const t = rawText.toLowerCase();

  const patterns = [
    /this price disclosure is based on .*estimated/i,
    /we have assumed/i,
    /assumed .*%/i,
    /estimated .*%/i,
    /consumption during night hours/i,
    /night hours\s*=\s*\d{1,2}:\d{2}\s*(am|pm)\s*[–-]\s*\d{1,2}:\d{2}\s*(am|pm)/i,
  ];

  for (const p of patterns) {
    if (p.test(rawText)) {
      return {
        isAssumptionBased: true,
        reason:
          "EFL average price table appears assumption-based (e.g., estimated night-hours split).",
      };
    }
  }

  if (
    t.includes("example based on average prices") &&
    (t.includes("night hours") || t.includes("free"))
  ) {
    return {
      isAssumptionBased: true,
      reason:
        "EFL average price table is an example and references free/night hours; skipping strict validation.",
    };
  }

  return { isAssumptionBased: false };
}

// -------------------- TDSP helpers (validator-only) --------------------

function cents(num: number): number {
  return Math.round(num * 100) / 100;
}

function toCentsInt(dollars: number): number {
  return Math.round(dollars * 100);
}

function parseMoneyDollars(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  const m = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// TDSP-specific parsers (line-based)
function parseCentsPerKwhFromLine(line: string): number | null {
  const m = line
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*¢\s*(?:\/\s*kWh|per\s*kWh)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseMonthlyDollarsFromLine(line: string): number | null {
  const m = line
    .replace(/,/g, "")
    .match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*per\s*(?:month|billing\s*cycle)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseCentsPerKwhToken(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  const m = cleaned.match(
    /(\d+(?:\.\d+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/i,
  );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickBestTdspPerKwhLine(
  lines: string[],
): { value: number | null; line: string | null } {
  const best = lines.find(
    (l) =>
      /(TDU|TDSP)/i.test(l) &&
      /Delivery/i.test(l) &&
      /(¢\s*(?:\/\s*kWh|per\s*kWh))/i.test(l),
  );
  if (best) return { value: parseCentsPerKwhFromLine(best), line: best };

  const next = lines.find(
    (l) =>
      /Delivery/i.test(l) && /(¢\s*(?:\/\s*kWh|per\s*kWh))/i.test(l),
  );
  if (next) return { value: parseCentsPerKwhFromLine(next), line: next };

  const any = lines.find((l) =>
    /(¢\s*(?:\/\s*kWh|per\s*kWh))/i.test(l),
  );
  if (any) return { value: parseCentsPerKwhFromLine(any), line: any };

  return { value: null, line: null };
}

function pickBestTdspMonthlyLine(
  lines: string[],
): { dollars: number | null; line: string | null } {
  const best = lines.find(
    (l) =>
      /(TDU|TDSP)/i.test(l) &&
      /Delivery/i.test(l) &&
      /\$\s*[0-9]+(?:\.[0-9]+)?\s*per\s*(?:month|billing\s*cycle)/i.test(l),
  );
  if (best)
    return { dollars: parseMonthlyDollarsFromLine(best), line: best };

  const next = lines.find(
    (l) =>
      /Delivery/i.test(l) &&
      /\$\s*[0-9]+(?:\.[0-9]+)?\s*per\s*(?:month|billing\s*cycle)/i.test(l),
  );
  if (next)
    return { dollars: parseMonthlyDollarsFromLine(next), line: next };

  const any = lines.find((l) =>
    /\$\s*[0-9]+(?:\.[0-9]+)?\s*per\s*(?:month|billing\s*cycle)/i.test(l),
  );
  if (any) return { dollars: parseMonthlyDollarsFromLine(any), line: any };

  return { dollars: null, line: null };
}

export function extractEflTdspCharges(rawText: string): EflTdspCharges {
  const lines = (rawText || "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const candidateLines = lines.filter((l) =>
    /(TDU|TDSP|Delivery)/i.test(l),
  );

  const searchLines =
    candidateLines.length > 0 ? candidateLines : lines;

  const perPick = pickBestTdspPerKwhLine(searchLines);
  const moPick = pickBestTdspMonthlyLine(searchLines);

  const perKwhCents = perPick.value;
  const monthlyDollars = moPick.dollars;
  const monthlyCents =
    monthlyDollars == null ? null : Math.round(monthlyDollars * 100);

  const snippetLines = [moPick.line, perPick.line].filter(
    (x): x is string => !!x,
  );
  const snippet = snippetLines.length ? snippetLines.join("\n") : null;

  let confidence: EflTdspCharges["confidence"] = "LOW";
  if (perKwhCents != null && monthlyCents != null) confidence = "HIGH";
  else if (perKwhCents != null || monthlyCents != null) confidence = "MED";

  return { perKwhCents, monthlyCents, snippet, confidence };
}

function safeNumber(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function buildModeledComponentsFromEngineResult(args: {
  engineResult: any;
  monthlyKwh: number;
  eflTdsp: EflTdspCharges;
  tdspIncludedInEnergyCharge: boolean | null | undefined;
}): { components: ModeledComponents | null; usedEngineTdspFallback: boolean } {
  const { engineResult, monthlyKwh, eflTdsp, tdspIncludedInEnergyCharge } =
    args;

  if (!engineResult || !Number.isFinite(monthlyKwh) || monthlyKwh <= 0) {
    return { components: null, usedEngineTdspFallback: false };
  }

  const monthlySummaries: any[] = Array.isArray(
    engineResult.monthlySummaries,
  )
    ? engineResult.monthlySummaries
    : [];

  const month = monthlySummaries[0];
  const totalCostDollars = safeNumber(engineResult.totalCostDollars, NaN);

  if (!month) {
    if (!Number.isFinite(totalCostDollars)) {
      return { components: null, usedEngineTdspFallback: false };
    }

    // No breakdown available; treat REP components as unknown, but still
    // allow TDSP override for total + avg.
    let tdspDollars = 0;
    let usedEngineTdspFallback = false;

    if (tdspIncludedInEnergyCharge) {
      tdspDollars = 0;
    } else if (
      eflTdsp.perKwhCents != null ||
      eflTdsp.monthlyCents != null
    ) {
      const per =
        eflTdsp.perKwhCents != null ? eflTdsp.perKwhCents / 100 : 0;
      const fixed =
        eflTdsp.monthlyCents != null ? eflTdsp.monthlyCents / 100 : 0;
      tdspDollars = fixed + per * monthlyKwh;
    } else {
      usedEngineTdspFallback = true;
      tdspDollars = 0;
    }

    const total = totalCostDollars + tdspDollars;
    const avgCentsPerKwh = (total / monthlyKwh) * 100;

    return {
      usedEngineTdspFallback,
      components: {
        repEnergyDollars: 0,
        repBaseDollars: 0,
        tdspDollars,
        creditsDollars: 0,
        totalDollars: total,
        avgCentsPerKwh,
        supplyOnlyDollars: null,
      },
    };
  }

  const energyDollars = safeNumber(month.energyChargesDollars, 0);
  const baseDollars = safeNumber(month.baseChargeDollars, 0);
  const billCreditsDollars = safeNumber(month.billCreditsDollars, 0);
  const tdspFromEngine = safeNumber(month.tdspDeliveryDollars, 0);
  const monthTotal = safeNumber(month.totalCostDollars, totalCostDollars);

  const repOnlyTotal = monthTotal - tdspFromEngine;

  let tdspDollars = 0;
  let usedEngineTdspFallback = false;

  if (tdspIncludedInEnergyCharge) {
    tdspDollars = 0;
  } else if (
    eflTdsp.perKwhCents != null ||
    eflTdsp.monthlyCents != null
  ) {
    const per =
      eflTdsp.perKwhCents != null ? eflTdsp.perKwhCents / 100 : 0;
    const fixed =
      eflTdsp.monthlyCents != null ? eflTdsp.monthlyCents / 100 : 0;
    tdspDollars = fixed + per * monthlyKwh;
  } else {
    usedEngineTdspFallback = true;
    tdspDollars = tdspFromEngine;
  }

  const total = repOnlyTotal + tdspDollars;
  const avgCentsPerKwh = (total / monthlyKwh) * 100;

  return {
    usedEngineTdspFallback,
    components: {
      repEnergyDollars: energyDollars,
      repBaseDollars: baseDollars,
      tdspDollars,
      creditsDollars: billCreditsDollars,
      totalDollars: total,
      avgCentsPerKwh,
      supplyOnlyDollars: repOnlyTotal,
    },
  };
}

// -------------------- Validator-only deterministic calculator --------------------

type ValidatorModeledBreakdown = ModeledComponents;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function getEnergyRateCentsForUsage(
  planRules: any,
  rateStructure: any,
  usageKwh: number,
): number | null {
  const tiersA = Array.isArray(planRules?.usageTiers)
    ? planRules.usageTiers
    : null;
  if (tiersA && tiersA.length) {
    const t = tiersA.find(
      (x: any) =>
        usageKwh >= x.minKwh && (x.maxKwh == null || usageKwh < x.maxKwh),
    );
    if (t?.rateCentsPerKwh != null) return Number(t.rateCentsPerKwh);
  }

  // Some admin responses send a tier array rather than the canonical
  // RateStructure contract. Support that shape as a fallback.
  const tiersB = Array.isArray(rateStructure) ? rateStructure : null;
  if (tiersB && tiersB.length) {
    const t = tiersB.find(
      (x: any) =>
        usageKwh >= (x.tierMinKWh ?? 0) &&
        (x.tierMaxKWh == null || usageKwh < x.tierMaxKWh),
    );
    if (t?.energyRateCentsPerKWh != null) {
      return Number(t.energyRateCentsPerKWh);
    }
  }

  const single =
    planRules?.currentBillEnergyRateCents ?? planRules?.defaultRateCentsPerKwh;
  if (single != null) return Number(single);

  return null;
}

function applyThresholdCredits(planRules: any, usageKwh: number): number {
  const credits = Array.isArray(planRules?.billCredits)
    ? planRules.billCredits
    : [];
  let totalCredit = 0;

  for (const c of credits) {
    const dollars = Number(c?.creditDollars);
    if (!Number.isFinite(dollars)) continue;

    const threshold =
      c?.thresholdKwh != null ? Number(c.thresholdKwh) : null;
    const type = String(c?.type ?? "").toUpperCase();

    // Standard "usage >= threshold" bill credits.
    if (type === "THRESHOLD_MIN" || type === "USAGE_THRESHOLD") {
      if (threshold == null || usageKwh >= threshold) totalCredit += dollars;
      continue;
    }

    // Minimum usage fee modeled as negative credit with threshold and
    // "usage < threshold" semantics.
    if (dollars < 0 && threshold != null) {
      if (usageKwh < threshold) totalCredit += dollars;
      continue;
    }

    // No threshold => assume always-on credit.
    if (threshold == null) totalCredit += dollars;
  }

  return totalCredit;
}

function computeValidatorModeledBreakdown(
  planRules: any,
  rateStructure: any,
  usageKwh: number,
  eflTdsp: EflTdspCharges,
  tdspDeliveryIncludedInEnergyCharge: boolean | null | undefined,
): ValidatorModeledBreakdown | null {
  const energyRateCents = getEnergyRateCentsForUsage(
    planRules,
    rateStructure,
    usageKwh,
  );
  if (energyRateCents == null || !Number.isFinite(energyRateCents)) {
    return null;
  }

  const repEnergyDollars = (usageKwh * energyRateCents) / 100;

  const baseCents =
    planRules?.baseChargePerMonthCents != null
      ? Number(planRules.baseChargePerMonthCents)
      : 0;
  const repBaseDollars = Number.isFinite(baseCents) ? baseCents / 100 : 0;

  const creditsDollars = applyThresholdCredits(planRules, usageKwh);

  let tdspDollars = 0;
  if (!tdspDeliveryIncludedInEnergyCharge) {
    const per =
      eflTdsp.perKwhCents != null ? eflTdsp.perKwhCents / 100 : 0;
    const monthly =
      eflTdsp.monthlyCents != null ? eflTdsp.monthlyCents / 100 : 0;
    tdspDollars = monthly + per * usageKwh;
  }

  const totalDollars =
    repEnergyDollars + repBaseDollars + tdspDollars - creditsDollars;
  const avgCentsPerKwh = (totalDollars / usageKwh) * 100;

  return {
    repEnergyDollars: round4(repEnergyDollars),
    repBaseDollars: round4(repBaseDollars),
    tdspDollars: round4(tdspDollars),
    creditsDollars: round4(creditsDollars),
    totalDollars: round4(totalDollars),
    avgCentsPerKwh: round4(avgCentsPerKwh),
    supplyOnlyDollars: round4(
      repEnergyDollars + repBaseDollars - creditsDollars,
    ),
  };
}

// -------------------- Avg price table extraction --------------------

function extractLineAfterLabel(
  rawText: string,
  labelRegex: RegExp,
): string | null {
  const lines = rawText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const cur = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      return (cur + " " + next).trim();
    }
  }
  return null;
}

export function extractEflAvgPricePoints(
  rawText: string,
): EflAvgPricePoint[] | null {
  // Support common encodings like "18.5¢", "18.5 ¢", and "18.5Â¢"
  // by allowing arbitrary non-digit, non-¢ chars between the number
  // and the literal cent sign.
  const centsPattern = /(\d+(?:\.\d+)?)[^\d¢]*¢/g;

  const useLine =
    extractLineAfterLabel(rawText, /Average\s+(monthly\s+)?use/i) ?? "";
  const priceLine =
    extractLineAfterLabel(
      rawText,
      /Average\s+price\s+(per\s+kilowatt-hour|per\s+kwh|per\s+kwh:?|per\s+kilo?watt-hour)/i,
    ) ?? "";

  const uses = Array.from(
    useLine.matchAll(/(\d{1,4}(?:,\d{3})?)\s*kwh/gi),
  ).map((m) => Number(m[1].replace(/,/g, "")));
  const hasRequiredUses =
    uses.includes(500) && uses.includes(1000) && uses.includes(2000);

  const centsTokens = Array.from(priceLine.matchAll(centsPattern)).map((m) =>
    Number(m[1]),
  );
  const has3 = centsTokens.length >= 3;

  if (!hasRequiredUses || !has3) {
    const tableScan = rawText.replace(/\r/g, "");
    const useMatch = tableScan.match(
      /Average\s+(Monthly\s+Use|monthly\s+use)[^\n]*\n?[^\n]*/i,
    );
    const priceMatch = tableScan.match(
      /Average\s+price[^\n]*\n?[^\n]*/i,
    );

    const useText = useMatch?.[0] ?? useLine;
    const priceText = priceMatch?.[0] ?? priceLine;

    const uses2 = Array.from(
      useText.matchAll(/(\d{1,4}(?:,\d{3})?)\s*kwh/gi),
    ).map((m) => Number(m[1].replace(/,/g, "")));
    const cents2 = Array.from(priceText.matchAll(centsPattern)).map((m) =>
      Number(m[1]),
    );

    if (
      !(
        uses2.includes(500) &&
        uses2.includes(1000) &&
        uses2.includes(2000)
      ) ||
      cents2.length < 3
    ) {
      return null;
    }

    return [
      { kwh: 500, eflAvgCentsPerKwh: cents2[0] },
      { kwh: 1000, eflAvgCentsPerKwh: cents2[1] },
      { kwh: 2000, eflAvgCentsPerKwh: cents2[2] },
    ];
  }

  return [
    { kwh: 500, eflAvgCentsPerKwh: centsTokens[0] },
    { kwh: 1000, eflAvgCentsPerKwh: centsTokens[1] },
    { kwh: 2000, eflAvgCentsPerKwh: centsTokens[2] },
  ];
}

// -------------------- Night hours assumption parsing --------------------

export function parseEflNightHoursAssumption(rawText: string): {
  nightStartHour?: number;
  nightEndHour?: number;
  nightUsagePercent?: number;
} | null {
  const percentMatch = rawText.match(
    /estimated\s+(\d{1,3})%\s+consumption\s+during\s+night\s+hours/i,
  );
  const nightUsagePercent =
    percentMatch && percentMatch[1]
      ? Number(percentMatch[1]) / 100
      : undefined;

  const hoursMatch =
    rawText.match(
      /Night\s*Hours\s*=\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ?? null;

  const to24 = (hh: string, mm: string, ap: string): number | null => {
    let h = Number(hh);
    const minute = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(minute)) return null;
    const isPm = ap.toUpperCase() === "PM";
    if (h === 12) {
      h = isPm ? 12 : 0;
    } else {
      h = isPm ? h + 12 : h;
    }
    return h;
  };

  let nightStartHour: number | undefined;
  let nightEndHour: number | undefined;
  if (hoursMatch) {
    const start = to24(hoursMatch[1], hoursMatch[2], hoursMatch[3]);
    const end = to24(hoursMatch[4], hoursMatch[5], hoursMatch[6]);
    if (start != null && end != null) {
      nightStartHour = start;
      nightEndHour = end;
    }
  }

  if (
    nightUsagePercent === undefined &&
    nightStartHour === undefined &&
    nightEndHour === undefined
  ) {
    return null;
  }

  return { nightUsagePercent, nightStartHour, nightEndHour };
}

// -------------------- Canonical calculator adapter --------------------

async function computeModeledComponentsOrNull(args: {
  planRules: PlanRules;
  rateStructure: RateStructure | null;
  kwh: number;
  eflTdsp: EflTdspCharges;
  tdspIncludedInEnergyCharge: boolean | null | undefined;
  nightUsagePercent?: number;
  nightStartHour?: number;
  nightEndHour?: number;
}): Promise<{ components: ModeledComponents | null; usedEngineTdspFallback: boolean }> {
  const { planRules, kwh } = args;

  if (!planRules) return { components: null, usedEngineTdspFallback: false };
  if (kwh <= 0) return { components: null, usedEngineTdspFallback: false };

  const usage: IntervalUsagePoint[] = [];

  const baseDate = "2025-01-15";

  const buildTimestamp = (hour: number): string =>
    `${baseDate}T${String(hour).padStart(2, "0")}:00:00-06:00`;

  const nightPercent = args.nightUsagePercent;
  const hasNightWindow =
    typeof args.nightStartHour === "number" &&
    typeof args.nightEndHour === "number";

  // Simple uniform usage across 24 hours when no explicit night-hours
  // assumption is available or plan is not clearly TOU with free nights.
  const isTouFreeNights =
    Array.isArray((planRules as any).timeOfUsePeriods) &&
    (planRules as any).timeOfUsePeriods.some(
      (p: any) => p && p.isFree === true,
    );

  if (!isTouFreeNights || nightPercent == null || !hasNightWindow) {
    const perHour = kwh / 24;
    for (let h = 0; h < 24; h++) {
      usage.push({
        timestamp: buildTimestamp(h),
        kwhImport: perHour,
        kwhExport: 0,
      });
    }
  } else {
    const nightStart = args.nightStartHour!;
    const nightEnd = args.nightEndHour!;

    const isNight = (h: number): boolean => {
      if (nightStart < nightEnd) {
        return h >= nightStart && h < nightEnd;
      }
      // crosses midnight
      return h >= nightStart || h < nightEnd;
    };

    const nightHours: number[] = [];
    const dayHours: number[] = [];
    for (let h = 0; h < 24; h++) {
      if (isNight(h)) nightHours.push(h);
      else dayHours.push(h);
    }

    if (nightHours.length === 0 || dayHours.length === 0) {
      const perHour = kwh / 24;
      for (let h = 0; h < 24; h++) {
        usage.push({
          timestamp: buildTimestamp(h),
          kwhImport: perHour,
          kwhExport: 0,
        });
      }
    } else {
      const nightKwh = kwh * nightPercent;
      const dayKwh = kwh - nightKwh;
      const perNight = nightKwh / nightHours.length;
      const perDay = dayKwh / dayHours.length;

      for (let h = 0; h < 24; h++) {
        const isN = nightHours.includes(h);
        usage.push({
          timestamp: buildTimestamp(h),
          kwhImport: isN ? perNight : perDay,
          kwhExport: 0,
        });
      }
    }
  }

  const plan: RatePlanRef = {
    id: "efl-validator",
    displayName: "EFL Validator Plan",
    source: "efl_validator",
    tdspCode: null,
  };

  try {
    const result = computePlanCost({
      plan: { plan, rules: planRules },
      usage,
      tz: VALIDATION_TZ,
    });

    return buildModeledComponentsFromEngineResult({
      engineResult: result,
      monthlyKwh: kwh,
      eflTdsp: args.eflTdsp,
      tdspIncludedInEnergyCharge: args.tdspIncludedInEnergyCharge,
    });
  } catch {
    return { components: null, usedEngineTdspFallback: false };
  }
}

// -------------------- Public validator --------------------

export async function validateEflAvgPriceTable(args: {
  rawText: string;
  planRules: PlanRules | any;
  rateStructure: RateStructure | any;
  toleranceCentsPerKwh?: number;
}): Promise<EflAvgPriceValidation> {
  const { rawText } = args;
  const planRules = args.planRules as PlanRules;
  const rateStructure = args.rateStructure as RateStructure | null;
  const tolerance = args.toleranceCentsPerKwh ?? DEFAULT_TOLERANCE_CENTS_PER_KWH;

  const points = extractEflAvgPricePoints(rawText);

  const avgTableFound = Array.isArray(points) && points.length > 0;

  // Build a small snippet around the Average Monthly Use / Average price lines
  // so the admin UI can show exactly what was parsed.
  let avgTableSnippet: string | undefined;
  if (avgTableFound) {
    const lines = rawText.split(/\r?\n/);
    const startIdx = lines.findIndex((l) =>
      /Average\s+(Monthly\s+Use|monthly\s+use)/i.test(l),
    );
    if (startIdx >= 0) {
      const endIdx = Math.min(lines.length, startIdx + 6);
      const block = lines.slice(startIdx, endIdx).join("\n");
      avgTableSnippet = block.slice(0, 800);
    }
  }

  if (!points || points.length === 0) {
    return {
      status: "SKIP",
      toleranceCentsPerKwh: tolerance,
      points: [],
      assumptionsUsed: {},
      fail: false,
      notes: ["EFL Average Price table (500/1000/2000) not found in text."],
      avgTableFound: false,
    };
  }

  // We still detect assumption-based language (e.g., free nights examples)
  // but we do NOT skip validation outright anymore. Instead we pass any
  // parsed night-hours assumptions into the cost engine so the modeled
  // averages line up with the EFL's own methodology.
  const assumption = isAssumptionBasedAvgPriceTable(rawText);
  const nightAssumption = parseEflNightHoursAssumption(rawText) ?? undefined;

  const eflTdsp = extractEflTdspCharges(rawText);

  const tdspIncludedFlag =
    (planRules as any).tdspDeliveryIncludedInEnergyCharge === true ||
    (rateStructure as any)?.tdspDeliveryIncludedInEnergyCharge === true
      ? true
      : undefined;

  const modeledPoints: EflAvgPriceValidation["points"] = [];
  let tdspAppliedMode: EflAvgPriceValidation["assumptionsUsed"]["tdspAppliedMode"] =
    "NONE";

  for (const p of points) {
    // 1) Try canonical engine path.
    const engineResult = await computeModeledComponentsOrNull({
      planRules,
      rateStructure,
      kwh: p.kwh,
      eflTdsp,
      tdspIncludedInEnergyCharge: tdspIncludedFlag,
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
    });

    let components = engineResult.components;

    // 2) If engine path failed, fall back to deterministic validator math
    // from the EFL (energy rate, base charge, credits, TDSP from EFL).
    if (!components || Number.isNaN(components.avgCentsPerKwh)) {
      components = computeValidatorModeledBreakdown(
        planRules,
        rateStructure,
        p.kwh,
        eflTdsp,
        tdspIncludedFlag,
      );
    }

    if (!components || Number.isNaN(components.avgCentsPerKwh)) {
      modeledPoints.push({
        usageKwh: p.kwh,
        expectedAvgCentsPerKwh: p.eflAvgCentsPerKwh,
        modeledAvgCentsPerKwh: null,
        diffCentsPerKwh: null,
        ok: false,
        modeled: null,
      });
      continue;
    }

    const modeledAvg = components.avgCentsPerKwh;
    const diff = modeledAvg - p.eflAvgCentsPerKwh;
    const absDiff = Math.abs(diff);
    modeledPoints.push({
      usageKwh: p.kwh,
      expectedAvgCentsPerKwh: p.eflAvgCentsPerKwh,
      modeledAvgCentsPerKwh: Number(cents(modeledAvg).toFixed(4)),
      diffCentsPerKwh: Number(cents(diff).toFixed(4)),
      ok: absDiff <= tolerance,
      modeled: {
        repEnergyDollars: cents(components.repEnergyDollars),
        repBaseDollars: cents(components.repBaseDollars),
        tdspDollars: cents(components.tdspDollars),
        creditsDollars: cents(components.creditsDollars),
        totalDollars: cents(components.totalDollars),
        supplyOnlyTotalCents:
          components.supplyOnlyDollars != null
            ? Math.round(components.supplyOnlyDollars * 100)
            : null,
        tdspTotalCentsUsed: Math.round(components.tdspDollars * 100),
        totalCentsUsed: Math.round(components.totalDollars * 100),
        avgCentsPerKwh: Number(cents(modeledAvg).toFixed(4)),
      },
    });
  }

  const anyModeled = modeledPoints.some((p) => p.modeledAvgCentsPerKwh != null);
  if (!anyModeled) {
    return {
      status: "SKIP",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        tdspIncludedInEnergyCharge: tdspIncludedFlag,
        tdspFromEfl: {
          perKwhCents: eflTdsp.perKwhCents,
          monthlyCents: eflTdsp.monthlyCents,
          confidence: eflTdsp.confidence,
          snippet: eflTdsp.snippet,
        },
        usedEngineTdspFallback:
          eflTdsp.perKwhCents == null && eflTdsp.monthlyCents == null,
      },
      fail: false,
      notes: [
        "Canonical plan-cost calculator could not be applied for any avg-price point; skipping validation.",
      ],
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  const maxAbsDiff = modeledPoints.reduce((max, p) => {
    if (p.diffCentsPerKwh == null) return max;
    const v = Math.abs(p.diffCentsPerKwh);
    return v > max ? v : max;
  }, 0);

  const allOk =
    modeledPoints.length > 0 &&
    modeledPoints.every(
      (p) => p.modeledAvgCentsPerKwh != null && p.ok === true,
    );

  if (allOk) {
    return {
      status: "PASS",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        tdspIncludedInEnergyCharge: tdspIncludedFlag,
        tdspFromEfl: {
          perKwhCents: eflTdsp.perKwhCents,
          monthlyCents: eflTdsp.monthlyCents,
          confidence: eflTdsp.confidence,
          snippet: eflTdsp.snippet,
        },
        usedEngineTdspFallback:
          eflTdsp.perKwhCents == null && eflTdsp.monthlyCents == null,
        tdspAppliedMode:
          tdspIncludedFlag === true
            ? "INCLUDED_IN_RATE"
            : eflTdsp.perKwhCents != null || eflTdsp.monthlyCents != null
              ? "ADDED_FROM_EFL"
              : "NONE",
      },
      fail: false,
      notes: [],
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  return {
    status: "FAIL",
    toleranceCentsPerKwh: tolerance,
    points: modeledPoints,
    assumptionsUsed: {
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
      tdspIncludedInEnergyCharge: tdspIncludedFlag,
      tdspFromEfl: {
        perKwhCents: eflTdsp.perKwhCents,
        monthlyCents: eflTdsp.monthlyCents,
        confidence: eflTdsp.confidence,
        snippet: eflTdsp.snippet,
      },
      usedEngineTdspFallback:
        eflTdsp.perKwhCents == null && eflTdsp.monthlyCents == null,
      tdspAppliedMode:
        tdspIncludedFlag === true
          ? "INCLUDED_IN_RATE"
          : eflTdsp.perKwhCents != null || eflTdsp.monthlyCents != null
            ? "ADDED_FROM_EFL"
            : "NONE",
    },
    fail: true,
    queueReason:
      "EFL average price table mismatch (modeled vs expected) — manual admin review required.",
    notes: [
      `Modeled avg ¢/kWh differs from EFL avg price table by up to ${maxAbsDiff.toFixed(
        4,
      )} ¢/kWh (tolerance ${tolerance} ¢/kWh).`,
    ],
    avgTableFound,
    avgTableRows: points.map((p) => ({
      kwh: p.kwh,
      avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
    })),
    avgTableSnippet,
  };
}


