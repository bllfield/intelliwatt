import type { PlanRules, RateStructure } from "./planEngine";
import { computePlanCost } from "@/lib/planAnalyzer/planCostEngine";
import type {
  IntervalUsagePoint,
  RatePlanRef,
} from "@/lib/planAnalyzer/planTypes";
import { lookupTdspCharges } from "@/lib/utility/tdspTariffs";

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
    weekendUsagePercent?: number;
    weekdayUsagePercent?: number;
    tdspIncludedInEnergyCharge?: boolean;
    tdspFromEfl?: {
      perKwhCents: number | null;
      monthlyCents: number | null;
      confidence: "HIGH" | "MED" | "LOW";
      snippet: string | null;
    };
    tdspFromUtilityTable?: {
      tdspCode: string;
      effectiveDateUsed: string;
      perKwhCents: number | null;
      monthlyCents: number | null;
      confidence: "MED" | "LOW";
    };
    usedEngineTdspFallback?: boolean;
    tdspAppliedMode?:
      | "INCLUDED_IN_RATE"
      | "ADDED_FROM_EFL"
      | "ENGINE_DEFAULT"
      | "UTILITY_TABLE"
      | "NONE";
  };
  fail: boolean;
  queueReason?: string;
  notes?: string[];
  avgTableFound: boolean;
  avgTableRows?: Array<{ kwh: number; avgPriceCentsPerKwh: number }>;
  avgTableSnippet?: string;
}

export type EflPassStrength = "STRONG" | "WEAK" | "INVALID";

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

function detectTdspPassThrough(rawText: string): boolean {
  const t = String(rawText ?? "");
  if (!t) return false;
  return (
    /TDSP[\s\S]{0,80}Delivery[\s\S]{0,120}passed\s*through/i.test(t) ||
    /TDU[\s\S]{0,80}Delivery[\s\S]{0,120}passed\s*through/i.test(t) ||
    /passed\s*through[\s\S]{0,60}without\s*mark-?\s*up/i.test(t) ||
    /without\s*mark-?\s*up[\s\S]{0,60}passed\s*through/i.test(t)
  );
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
  const cleaned = line.replace(/,/g, "");
  const matches = Array.from(
    // Handle both "/" and the unicode fraction slash "⁄" that sometimes appears in pdftotext output.
    cleaned.matchAll(/(\d+(?:\.\d+)?)\s*¢\s*(?:[\/⁄]\s*kWh|per\s*kWh)/gi),
  );
  if (matches.length === 0) return null;

  // When a line contains both REP energy charges and TDSP delivery charges
  // (common in side-by-side tables), picking the *last* ¢/kWh token is a
  // pragmatic heuristic that tends to select the delivery column.
  const last = matches[matches.length - 1];
  const v = Number(last?.[1]);
  return Number.isFinite(v) ? v : null;
}

function parseMonthlyDollarsFromLine(line: string): number | null {
  const cleaned = line.replace(/,/g, "");

  // Standard inline pattern: "$4.23 per month" / "$4.23 per billing cycle"
  const m1All = Array.from(
    cleaned.matchAll(
      /\$\s*([0-9]+(?:\.[0-9]+)?)\s*per\s*(?:month|billing\s*cycle)/gi,
    ),
  );
  if (m1All.length > 0) {
    const last = m1All[m1All.length - 1];
    const v = Number(last?.[1]);
    return Number.isFinite(v) ? v : null;
  }

  // Table/header pattern: the "per month" header may be on the same logical
  // row as the $ amount, but not necessarily immediately adjacent.
  if (/per\s*(?:month|billing\s*cycle)/i.test(cleaned)) {
    const m2All = Array.from(
      cleaned.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/gi),
    );
    if (m2All.length > 0) {
      // Prefer the last $ token on the line; in side-by-side tables the TDSP
      // "per month" value tends to appear after base-charge columns.
      const last = m2All[m2All.length - 1];
      const v = Number(last?.[1]);
      return Number.isFinite(v) ? v : null;
    }
  }

  return null;
}

function parseCentsPerKwhToken(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  const m = cleaned.match(
    // Handle both "/" and the unicode fraction slash "⁄" that sometimes appears in pdftotext output.
    /(\d+(?:\.\d+)?)\s*¢\s*(?:[\/⁄]\s*kwh|per\s*kwh)/i,
  );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickBestTdspPerKwhLine(
  lines: string[],
): { value: number | null; line: string | null } {
  const isTdspTokenLine = (l: string): boolean => {
    if (!/(TDU|TDSP)/i.test(l)) return false;
    if (!/Delivery/i.test(l)) return false;
    if (!/(¢\s*(?:[\/⁄]\s*kWh|per\s*kWh))/i.test(l)) return false;

    // Avoid false positives where our joined-line window contains "TDU Delivery Charges"
    // but the only ¢/kWh token is actually the REP "Energy Charge".
    const tokenCount = Array.from(
      l.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*¢\s*(?:[\/⁄]\s*kWh|per\s*kWh)/gi),
    ).length;
    if (/Energy\s*Charge/i.test(l) && tokenCount === 1) return false;
    return true;
  };

  const best = lines.find(isTdspTokenLine);
  if (best) return { value: parseCentsPerKwhFromLine(best), line: best };

  const next = lines.find(
    (l) =>
      /Delivery/i.test(l) &&
      /(¢\s*(?:[\/⁄]\s*kWh|per\s*kWh))/i.test(l) &&
      !(/Energy\s*Charge/i.test(l) &&
        Array.from(
          l.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*¢\s*(?:[\/⁄]\s*kWh|per\s*kWh)/gi),
        ).length === 1),
  );
  if (next) return { value: parseCentsPerKwhFromLine(next), line: next };

  const any = lines.find((l) =>
    /(¢\s*(?:[\/⁄]\s*kWh|per\s*kWh))/i.test(l) &&
    !(/Energy\s*Charge/i.test(l) &&
      Array.from(
        l.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*¢\s*(?:[\/⁄]\s*kWh|per\s*kWh)/gi),
      ).length === 1),
  );
  if (any) return { value: parseCentsPerKwhFromLine(any), line: any };

  return { value: null, line: null };
}

function pickBestTdspMonthlyLine(
  lines: string[],
): { dollars: number | null; line: string | null } {
  const isBadUsageChargeLine = (l: string): boolean =>
    /Usage\s*Charge/i.test(l) || /Energy\s*Charge/i.test(l);

  const best = lines.find(
    (l) =>
      !isBadUsageChargeLine(l) &&
      /(TDU|TDSP)/i.test(l) &&
      /Delivery/i.test(l) &&
      /\$\s*[0-9]+(?:\.[0-9]+)?\s*per\s*(?:month|billing\s*cycle)/i.test(l),
  );
  if (best)
    return { dollars: parseMonthlyDollarsFromLine(best), line: best };

  const next = lines.find(
    (l) =>
      !isBadUsageChargeLine(l) &&
      /Delivery/i.test(l) &&
      /\$\s*[0-9]+(?:\.[0-9]+)?\s*per\s*(?:month|billing\s*cycle)/i.test(l),
  );
  if (next)
    return { dollars: parseMonthlyDollarsFromLine(next), line: next };

  // Table/header fallback: allow "$4.23" on a line that contains "per month"
  // even if the word "Delivery" isn't repeated on that same line.
  const headerLike = lines.find(
    (l) =>
      !isBadUsageChargeLine(l) &&
      /(TDU|TDSP|Delivery)/i.test(l) &&
      /per\s*(?:month|billing\s*cycle)/i.test(l) &&
      /\$\s*[0-9]+(?:\.[0-9]+)?/i.test(l),
  );
  if (headerLike)
    return { dollars: parseMonthlyDollarsFromLine(headerLike), line: headerLike };

  return { dollars: null, line: null };
}

export function extractEflTdspCharges(rawText: string): EflTdspCharges {
  const lines = (rawText || "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Candidate lines often include only the table headers ("Delivery ... per month")
  // while the numeric values may be on adjacent rows. Build a search window that
  // includes keyword lines plus their neighbors.
  const hitIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/(TDU|TDSP|Delivery)/i.test(lines[i] ?? "")) {
      hitIdx.push(i);
    }
  }

  let searchLines: string[] = lines;
  if (hitIdx.length > 0) {
    const set = new Set<string>();
    for (const i of hitIdx) {
      // Expand the window: in many EFL "Electricity Price" side-by-side tables,
      // the word "Delivery" appears several rows above the numeric ¢/kWh value.
      // A wider window avoids missing the delivery-charge row.
      for (let d = -5; d <= 5; d++) {
        const l = lines[i + d];
        if (l) set.add(l);
      }

      // Include simple joined windows so header/context + numeric values can be
      // parsed even when split across lines or columns.
      for (let d = -2; d <= 2; d++) {
        const a = lines[i + d];
        const b = lines[i + d + 1];
        const c = lines[i + d + 2];
        if (a && b) set.add(`${a} ${b}`.trim());
        if (a && b && c) set.add(`${a} ${b} ${c}`.trim());
      }
    }
    searchLines = Array.from(set);
  }

  const perPick = pickBestTdspPerKwhLine(searchLines);
  const moPick = pickBestTdspMonthlyLine(searchLines);

  let perKwhCents = perPick.value;
  let perKwhLine: string | null = perPick.line;
  let monthlyDollars = moPick.dollars;
  let monthlyLine: string | null = moPick.line;

  // Extra robustness: in many EFL tables, "per month" appears on a header line
  // and the "$4.23" value is on the next line (or even a couple lines later),
  // without repeating "per month". If our first pass missed the monthly value,
  // do a small window scan anchored on a "per month" header near delivery/TDSP.
  if (monthlyDollars == null) {
    const perMonthIdx = lines.findIndex(
      (l) =>
        /per\s*month/i.test(l) &&
        (/Delivery/i.test(l) || /TDSP/i.test(l) || /TDU/i.test(l) || /per\s*kwh/i.test(l)),
    );

    if (perMonthIdx >= 0) {
      // Scan forward a few lines for a dollar amount; choose the last $ token
      // on the first line that contains any $ amount (to avoid picking $0.00
      // base charge when present earlier on the same row).
      for (let j = 1; j <= 6; j++) {
        const candidate = lines[perMonthIdx + j];
        if (!candidate) continue;
        if (/Usage\s*Charge/i.test(candidate)) continue;
        if (!/\$/.test(candidate)) continue;

        // If the candidate also contains a ¢/kWh token, it's very likely the
        // delivery-charge row (good).
        const parsed = parseMonthlyDollarsFromLine(
          `per month ${candidate}`,
        );
        if (parsed != null) {
          monthlyDollars = parsed;
          monthlyLine = candidate;
          break;
        }
      }
    }
  }

  // Mirror the monthly scan for the per-kWh delivery charge: in side-by-side tables
  // the "per kWh" header is often separated from the numeric value row.
  if (perKwhCents == null) {
    const perKwhIdx = lines.findIndex(
      (l) =>
        /per\s*kwh/i.test(l) && (/per\s*month/i.test(l) || /billing\s*cycle/i.test(l) || /month/i.test(l)),
    );
    if (perKwhIdx >= 0) {
      for (let j = 1; j <= 6; j++) {
        const candidate = lines[perKwhIdx + j];
        if (!candidate) continue;
        if (!/¢/.test(candidate)) continue;
        const parsed = parseCentsPerKwhFromLine(candidate);
        if (parsed != null) {
          perKwhCents = parsed;
          perKwhLine = candidate;
          break;
        }
      }
    }
  }
  const monthlyCents =
    monthlyDollars == null ? null : Math.round(monthlyDollars * 100);

  const snippetLines = [monthlyLine, perKwhLine].filter(
    (x): x is string => !!x,
  );
  const snippet = snippetLines.length ? snippetLines.join("\n") : null;

  let confidence: EflTdspCharges["confidence"] = "LOW";
  if (perKwhCents != null && monthlyCents != null) confidence = "HIGH";
  else if (perKwhCents != null || monthlyCents != null) confidence = "MED";

  return { perKwhCents, monthlyCents, snippet, confidence };
}

/**
 * Infer TDSP service territory from EFL raw text using simple name matching.
 * Used only when the EFL masks TDSP numeric charges (e.g. "**") but clearly
 * indicates that TDSP delivery charges are passed through.
 */
export function inferTdspTerritoryFromEflText(
  rawText: string,
):
  | "ONCOR"
  | "CENTERPOINT"
  | "AEP_NORTH"
  | "AEP_CENTRAL"
  | "TNMP"
  | null {
  const t = rawText.toLowerCase();
  const norm = t
    .replace(/[\u2010-\u2015]/g, "-") // unicode hyphens → '-'
    .replace(/\s+/g, " ")
    .trim();

  if (norm.includes("centerpoint")) return "CENTERPOINT";
  if (norm.includes("oncor")) return "ONCOR";
  // TNMP appears in some EFL headers as either:
  // - "Texas New Mexico Power Service Area"
  // - "Texas-New Mexico Power"
  // - "TNMP"
  if (/\btexas\s*-?\s*new\s+mexico\s+power\b/i.test(norm) || norm.includes("tnmp")) {
    return "TNMP";
  }

  // AEP variants (common in EFL headers: "AEP North", "AEP Central")
  if (
    norm.includes("aep north") ||
    norm.includes("aep-north") ||
    norm.includes("aep texas north") ||
    // Some EFLs abbreviate North/Central as a single letter (e.g., "AEP Texas N").
    norm.includes("aep texas n ") ||
    norm.includes("aep texas n service area") ||
    norm.includes("aep texas n delivery") ||
    norm.includes("aep texas north company")
  ) {
    return "AEP_NORTH";
  }
  if (
    norm.includes("aep central") ||
    norm.includes("aep-central") ||
    norm.includes("aep texas central") ||
    norm.includes("aep texas c ") ||
    norm.includes("aep texas c service area") ||
    norm.includes("aep texas c delivery") ||
    norm.includes("aep texas central company")
  ) {
    return "AEP_CENTRAL";
  }

  return null;
}

/**
 * Best-effort inference of an EFL "effective date" from raw text.
 * Returns an ISO date string (YYYY-MM-DD) or null when no reasonable
 * candidate is found.
 */
export function inferEflDateISO(rawText: string): string | null {
  const m1 = rawText.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
  );

  if (m1) {
    const d = new Date(m1[0]);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const m2 = rawText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (m2) {
    const d = new Date(m2[0]);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Detects when an EFL masks TDSP numeric charges (e.g. "**") but clearly
 * describes TDSP/TDU delivery as pass-through from the utility. This is
 * the only case where the validator is allowed to consult the Utility/TDSP
 * tariff table as a fallback.
 *
 * We prefer explicit pass-through + "**For updated TDU delivery charges"
 * style markers, and fall back to the broader heuristic to avoid regressions.
 */
function isTdspMasked(rawText: string, eflTdsp: EflTdspCharges): boolean {
  const tdspUnknown =
    eflTdsp.perKwhCents == null && eflTdsp.monthlyCents == null;
  if (!tdspUnknown) return false;

  const t = rawText.toLowerCase();

  const hasStarPlaceholder =
    /\*\*\s*for\s+updated\s+tdu\s+delivery\s+charges/i.test(t) ||
    /tdu\s+delivery\s+charges[\s\S]{0,120}\*\*/i.test(rawText);

  const hasPassThroughLanguage =
    /will\s+be\s+passed\s+through/i.test(t) ||
    /passed\s+through\s+to\s+customer/i.test(t) ||
    /passed\s+through[\s\S]{0,40}without\s+mark-?up/i.test(t) ||
    /passed[-\s]through/i.test(t);

  if (hasStarPlaceholder && hasPassThroughLanguage) {
    return true;
  }

  // Backwards-compatible fallback: any "**" near generic TDSP/TDU pass-through
  // language still counts as "masked" so we don't silently weaken behavior.
  const hasMask = t.includes("**");
  const hasPassThroughBroad =
    t.includes("tdu delivery charges") ||
    t.includes("tdu charges") ||
    t.includes("tdu fees") ||
    t.includes("tdsp charges") ||
    t.includes("passed through") ||
    t.includes("passed-through") ||
    t.includes("as billed") ||
    (t.includes("tdu") && t.includes("billed"));

  return hasMask && hasPassThroughBroad;
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
        usageKwh >=
          (x.tierMinKWh ??
            x.minUsageKwh ??
            x.minimumUsageKWh ??
            x.minimumUsageKwh ??
            0) &&
        ((x.tierMaxKWh ??
          x.maxUsageKwh ??
          x.maximumUsageKWh ??
          x.maximumUsageKwh) == null ||
          usageKwh <
            (x.tierMaxKWh ??
              x.maxUsageKwh ??
              x.maximumUsageKWh ??
              x.maximumUsageKwh)),
    );
    const rate =
      t?.energyRateCentsPerKWh ??
      t?.energyChargeCentsPerKwh ??
      t?.energyChargeCentsPerKWh ??
      // Common model typo/variant: "...PerkWh" with lowercase k in "kWh"
      t?.energyChargeCentsPerkWh ??
      t?.energyChargeCentsPerkWh;
    if (rate != null) {
      return Number(rate);
    }
  }

  const single =
    planRules?.currentBillEnergyRateCents ?? planRules?.defaultRateCentsPerKwh;
  if (single != null) return Number(single);

  return null;
}

function computeEnergyDollarsFromPlanRules(
  planRules: any,
  rateStructure: any,
  usageKwh: number,
): number | null {
  if (!Number.isFinite(usageKwh) || usageKwh <= 0) return null;

  const tiersA = Array.isArray(planRules?.usageTiers)
    ? planRules.usageTiers
    : null;

  // Prefer explicit usage tiers when available (e.g. 0–1000, >1000).
  if (tiersA && tiersA.length) {
    const tiers = [...tiersA].map((t) => ({
      minKwh:
        t?.minKwh != null && Number.isFinite(Number(t.minKwh))
          ? Number(t.minKwh)
          : 0,
      maxKwh:
        t?.maxKwh != null && Number.isFinite(Number(t.maxKwh))
          ? Number(t.maxKwh)
          : null,
      rateCentsPerKwh:
        t?.rateCentsPerKwh != null && Number.isFinite(Number(t.rateCentsPerKwh))
          ? Number(t.rateCentsPerKwh)
          : null,
    }));

    const validTiers = tiers.filter((t) => t.rateCentsPerKwh != null);
    if (validTiers.length === 0) return null;

    validTiers.sort((a, b) => a.minKwh - b.minKwh);

    let totalDollars = 0;
    let coveredUpTo = 0;

    for (const t of validTiers) {
      const start = Math.max(0, t.minKwh);
      const end = t.maxKwh == null ? usageKwh : Math.min(usageKwh, t.maxKwh);
      if (end <= start) continue;
      const segmentKwh = end - start;
      const rateDollars = t.rateCentsPerKwh! / 100;
      totalDollars += segmentKwh * rateDollars;
      if (end > coveredUpTo) coveredUpTo = end;
      if (end >= usageKwh) break;
    }

    // If usage exceeds the covered range and there is no explicit open-ended
    // tier, treat the remaining kWh as billed at the last tier's rate instead
    // of silently dropping it. This keeps the math monotonic and avoids
    // undercounting for validator scenarios where extraction missed an open
    // upper bound.
    if (
      coveredUpTo < usageKwh &&
      validTiers.length > 0 &&
      !validTiers.some((t) => t.maxKwh == null)
    ) {
      const last = validTiers[validTiers.length - 1]!;
      const remaining = usageKwh - coveredUpTo;
      const lastRateDollars = last.rateCentsPerKwh! / 100;
      totalDollars += remaining * lastRateDollars;
    }

    return totalDollars;
  }

  // Fallback: single effective rate for the whole usage bucket.
  const energyRateCents = getEnergyRateCentsForUsage(
    planRules,
    rateStructure,
    usageKwh,
  );
  if (energyRateCents == null || !Number.isFinite(energyRateCents)) {
    return null;
  }
  return (usageKwh * energyRateCents) / 100;
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

    // Standard "usage <= threshold" bill credits.
    // Used by prepaid products that offer a credit up to a max usage threshold
    // (e.g. "Monthly Credit -$15 applies: 500 kWh usage or less").
    if (type === "THRESHOLD_MAX") {
      if (threshold == null || usageKwh <= threshold) totalCredit += dollars;
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
  weekendUsagePercent?: number,
  nightUsagePercent?: number,
): ValidatorModeledBreakdown | null {
  // Special-case: simple weekday/weekend TOU expressed as all-day weekday vs all-day weekend.
  const touPeriods: any[] = Array.isArray(planRules?.timeOfUsePeriods)
    ? planRules.timeOfUsePeriods
    : [];
  const isTou =
    planRules?.rateType === "TIME_OF_USE" ||
    planRules?.planType === "tou" ||
    planRules?.planType === "free-weekends" ||
    touPeriods.length > 0;

  let repEnergyDollars: number | null = null;

  if (isTou && weekendUsagePercent != null && Number.isFinite(weekendUsagePercent)) {
    const weekdayPeriod = touPeriods.find((p: any) => {
      const days = Array.isArray(p?.daysOfWeek) ? p.daysOfWeek : [];
      const isAllDay = Number(p?.startHour) === 0 && Number(p?.endHour) >= 23;
      return (
        isAllDay &&
        days.length === 5 &&
        days.every((d: number) => [1, 2, 3, 4, 5].includes(d))
      );
    });
    const weekendPeriod = touPeriods.find((p: any) => {
      const days = Array.isArray(p?.daysOfWeek) ? p.daysOfWeek : [];
      const isAllDay = Number(p?.startHour) === 0 && Number(p?.endHour) >= 23;
      return (
        isAllDay &&
        days.length === 2 &&
        days.every((d: number) => [0, 6].includes(d))
      );
    });

    const weekdayRate = weekdayPeriod?.rateCentsPerKwh;
    const weekendRate = weekendPeriod?.rateCentsPerKwh;
    if (Number.isFinite(Number(weekdayRate)) && Number.isFinite(Number(weekendRate))) {
      const wp = Math.max(0, Math.min(1, weekendUsagePercent));
      const weekdayShare = 1 - wp;
      const blendedCents = Number(weekdayRate) * weekdayShare + Number(weekendRate) * wp;
      repEnergyDollars = (usageKwh * blendedCents) / 100;
    }
  }

  // Special-case: Peak/Off-Peak TOU where the EFL discloses an assumed off-peak usage percent.
  // We model energy charges as a blended rate based on that percent.
  if (
    repEnergyDollars == null &&
    isTou &&
    nightUsagePercent != null &&
    Number.isFinite(nightUsagePercent) &&
    touPeriods.length >= 2
  ) {
    const pct = Math.max(0, Math.min(1, nightUsagePercent));
    const rated = touPeriods
      .map((p: any) => ({
        p,
        rate: Number(p?.rateCentsPerKwh),
        start: Number(p?.startHour),
        end: Number(p?.endHour),
        label: String(p?.label ?? ""),
      }))
      .filter((x) => Number.isFinite(x.rate) && Number.isFinite(x.start) && Number.isFinite(x.end));

    if (rated.length >= 2) {
      const crossesMidnight = (x: any) => x.start > x.end;
      const offLabel = (x: any) => /off\s*-?\s*peak|night/i.test(x.label.toLowerCase());
      const peakLabel = (x: any) => /\bpeak\b|on\s*-?\s*peak|day/i.test(x.label.toLowerCase());

      let off = rated.find((x) => offLabel(x) || crossesMidnight(x));
      let peak = rated.find((x) => peakLabel(x) && x !== off);

      // Fallback: choose lowest-rate as off-peak and highest-rate as peak.
      if (!off || !peak) {
        const sorted = [...rated].sort((a, b) => a.rate - b.rate);
        off = off ?? sorted[0];
        peak = peak ?? sorted[sorted.length - 1];
      }

      if (off && peak && Number.isFinite(off.rate) && Number.isFinite(peak.rate)) {
        const blendedCents = off.rate * pct + peak.rate * (1 - pct);
        repEnergyDollars = (usageKwh * blendedCents) / 100;
      }
    }
  }

  if (repEnergyDollars == null) {
    repEnergyDollars = computeEnergyDollarsFromPlanRules(
      planRules,
      rateStructure,
      usageKwh,
    );
  }
  if (repEnergyDollars == null || !Number.isFinite(repEnergyDollars)) {
    return null;
  }

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

export async function modelAvgCentsPerKwhAtUsage(args: {
  usageKwh: number;
  planRules: any | null;
  rateStructure: any | null;
  assumptionsUsed?: any;
}): Promise<{
  modeledAvgCentsPerKwh: number | null;
  modeledTotalCents?: number | null;
  notes?: string[];
}> {
  const notes: string[] = [];

  const { usageKwh, planRules, rateStructure } = args;
  if (!planRules || !Number.isFinite(usageKwh) || usageKwh <= 0) {
    return {
      modeledAvgCentsPerKwh: null,
      notes: ["INVALID_INPUT"],
    };
  }

  const assumptions = args.assumptionsUsed ?? {};

  const tdspIncludedFlag =
    assumptions.tdspIncludedInEnergyCharge === true ||
    (planRules as any).tdspDeliveryIncludedInEnergyCharge === true ||
    (rateStructure as any)?.tdspDeliveryIncludedInEnergyCharge === true
      ? true
      : undefined;

  let effectiveTdsp: EflTdspCharges = {
    perKwhCents: null,
    monthlyCents: null,
    snippet: null,
    confidence: "LOW",
  };

  const fromUtility = assumptions.tdspFromUtilityTable ?? null;
  const fromEfl = assumptions.tdspFromEfl ?? null;
  const appliedMode = assumptions.tdspAppliedMode ?? null;

  if (
    appliedMode === "UTILITY_TABLE" &&
    fromUtility &&
    (fromUtility.perKwhCents != null || fromUtility.monthlyCents != null)
  ) {
    effectiveTdsp = {
      perKwhCents:
        typeof fromUtility.perKwhCents === "number"
          ? fromUtility.perKwhCents
          : null,
      monthlyCents:
        typeof fromUtility.monthlyCents === "number"
          ? fromUtility.monthlyCents
          : null,
      snippet: null,
      confidence: fromUtility.confidence ?? "MED",
    };
  } else if (fromEfl) {
    effectiveTdsp = {
      perKwhCents:
        typeof fromEfl.perKwhCents === "number" ? fromEfl.perKwhCents : null,
      monthlyCents:
        typeof fromEfl.monthlyCents === "number" ? fromEfl.monthlyCents : null,
      snippet: fromEfl.snippet ?? null,
      confidence: fromEfl.confidence ?? "LOW",
    };
  }

  const nightUsagePercent =
    typeof assumptions.nightUsagePercent === "number"
      ? assumptions.nightUsagePercent
      : undefined;
  const nightStartHour =
    typeof assumptions.nightStartHour === "number"
      ? assumptions.nightStartHour
      : undefined;
  const nightEndHour =
    typeof assumptions.nightEndHour === "number"
      ? assumptions.nightEndHour
      : undefined;
  const weekendUsagePercent =
    typeof assumptions.weekendUsagePercent === "number"
      ? assumptions.weekendUsagePercent
      : undefined;

  const engineResult = await computeModeledComponentsOrNull({
    planRules: planRules as PlanRules,
    rateStructure: (rateStructure as RateStructure | null) ?? null,
    kwh: usageKwh,
    eflTdsp: effectiveTdsp,
    tdspIncludedInEnergyCharge: tdspIncludedFlag,
    nightUsagePercent,
    nightStartHour,
    nightEndHour,
  });

  let components = engineResult.components;

  // For simple weekday/weekend TOU, the canonical engine path does not model
  // the EFL's stated weekend/weekday usage split reliably. Prefer deterministic
  // validator math when we have that assumption + TOU periods.
  if (
    planRules?.rateType === "TIME_OF_USE" &&
    weekendUsagePercent != null &&
    Array.isArray((planRules as any).timeOfUsePeriods) &&
    (planRules as any).timeOfUsePeriods.length > 0
  ) {
    components = null;
  }

  if (!components || Number.isNaN(components.avgCentsPerKwh)) {
    components = computeValidatorModeledBreakdown(
      planRules,
      rateStructure,
      usageKwh,
      effectiveTdsp,
      tdspIncludedFlag,
      weekendUsagePercent,
      nightUsagePercent,
    );
    if (components) {
      notes.push("FALLBACK_VALIDATOR_MATH");
    }
  }

  if (!components || Number.isNaN(components.avgCentsPerKwh)) {
    return {
      modeledAvgCentsPerKwh: null,
      notes: [...notes, "NO_MODELED_COMPONENTS"],
    };
  }

  const modeledAvg = Number(cents(components.avgCentsPerKwh).toFixed(4));
  const modeledTotalCents = Math.round(components.totalDollars * 100);

  return {
    modeledAvgCentsPerKwh: modeledAvg,
    modeledTotalCents,
    notes,
  };
}

// -------------------- Avg price table extraction --------------------

function extractBaseChargePerMonthCentsFromRawText(
  rawText: string,
): number | null {
  // Treat explicit N/A as "not present".
  if (/Base\s*Charge[^.\n]*\bN\/A\b/i.test(rawText)) {
    return null;
  }

  // Table-style base charge (no "per billing cycle" phrase), e.g. "Base Charge $0.00".
  const table = rawText.match(
    /\bBase\s*Charge\b[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i,
  );
  if (table?.[1]) {
    const dollars = Number(table[1]);
    if (Number.isFinite(dollars)) {
      return Math.round(dollars * 100);
    }
  }

  // Match patterns like "Base Charge: $5.00 per billing cycle" or "per month".
  const m = rawText.match(
    /Base\s*Charge\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+(?:billing\s*cycle|month)|\/\s*month|monthly)/i,
  );
  if (!m?.[1]) return null;
  const dollars = Number(m[1]);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

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
      /Average\s+Monthly\s+Us(?:e|age)[^\n]*\n?[^\n]*/i,
    );
    const useText = useMatch?.[0] ?? useLine;

    // Tolerant "Average price" scan:
    //  - There might be a header line ("Average Price per kWh") with no cents
    //    and a separate line with the actual numeric values.
    //  - We scan all lines that contain "Average price" and prefer the first
    //    window that yields ≥3 cent tokens.
    const lines = tableScan.split(/\r?\n/);
    let priceText = priceLine;
    const priceLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/Average\s+price/i.test(lines[i])) {
        // Look at this line plus the next couple of lines to catch both
        // header + numeric rows.
        const window = lines.slice(i, i + 3).join(" ");
        priceLines.push(window);
      }
    }
    if (priceLines.length > 0) {
      // Choose the first window that yields at least 3 cent tokens.
      for (const window of priceLines) {
        const tokens = Array.from(window.matchAll(centsPattern)).map((m) =>
          Number(m[1]),
        );
        if (tokens.length >= 3) {
          priceText = window;
          break;
        }
      }
      // If none of the windows produced 3 tokens, fall back to the first match
      // text or the previously derived priceLine.
      if (priceText === priceLine) {
        const firstMatch = tableScan.match(
          /Average\s+price[^\n]*\n?[^\n]*/i,
        );
        if (firstMatch?.[0]) {
          priceText = firstMatch[0];
        }
      }
    } else {
      const priceMatch = tableScan.match(
        /Average\s+price[^\n]*\n?[^\n]*/i,
      );
      if (priceMatch?.[0]) {
        priceText = priceMatch[0];
      }
    }

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
  const percentMatch =
    rawText.match(
      /estimated\s+(\d{1,3}(?:\.[0-9]+)?)%\s+consumption\s+during\s+night\s+hours/i,
    ) ??
    // Common TOU disclosure phrasing:
    // "Average price is based on usage profile ... of 32% of Off-Peak consumption ..."
    rawText.match(/(\d{1,3}(?:\.[0-9]+)?)%\s+of\s+Off-?Peak\s+consumption/i) ??
    // Fallback: "32% of Off-Peak" without the word consumption
    rawText.match(/(\d{1,3}(?:\.[0-9]+)?)%\s+of\s+Off-?Peak\b/i) ??
    null;
  const nightUsagePercent =
    percentMatch && percentMatch[1]
      ? Number(percentMatch[1]) / 100
      : undefined;

  const hoursMatch =
    rawText.match(
      /Night\s*Hours\s*=\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ??
    // Common TOU phrasing: "Off-Peak hours are 9:00 PM - 4:59 AM."
    rawText.match(
      /Off-?Peak\s+hours?\s+are\s+([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ??
    null;

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

  const to24EndExclusive = (hh: string, mm: string, ap: string): number | null => {
    const base = to24(hh, mm, ap);
    if (base == null) return null;
    const minute = Number(mm);
    if (!Number.isFinite(minute)) return base;
    // Treat minute-level end times as inclusive within the hour (e.g. 4:59 AM),
    // and round up to the next hour to form an exclusive end boundary for our
    // hour-bucket modeling.
    if (minute > 0) return (base + 1) % 24;
    return base;
  };

  let nightStartHour: number | undefined;
  let nightEndHour: number | undefined;
  if (hoursMatch) {
    const start = to24(hoursMatch[1], hoursMatch[2], hoursMatch[3]);
    const end = to24EndExclusive(hoursMatch[4], hoursMatch[5], hoursMatch[6]);
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

export function parseEflWeekendWeekdayUsageAssumption(rawText: string): {
  weekendUsagePercent?: number;
  weekdayUsagePercent?: number;
} | null {
  // Example:
  // "calculations assume that 30.0% of usage occurs during Weekends and 70.0% of usage occurs during Weekdays."
  const m =
    rawText.match(
      /assume\s+that\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+usage\s+occurs\s+during\s+Weekends?\s+and\s+([0-9]+(?:\.[0-9]+)?)%\s+of\s+usage\s+occurs\s+during\s+Weekdays?/i,
    ) ?? null;
  if (!m?.[1] || !m?.[2]) return null;

  const weekend = Number(m[1]) / 100;
  const weekday = Number(m[2]) / 100;
  if (!Number.isFinite(weekend) || !Number.isFinite(weekday)) return null;

  return {
    weekendUsagePercent: weekend,
    weekdayUsagePercent: weekday,
  };
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

  // Use explicit night-hours usage split when available AND the plan has any TOU periods.
  // This supports both Free Nights plans and Peak/Off-Peak TOU plans that disclose
  // an assumed night/off-peak usage percent in the EFL.
  const hasTouPeriods =
    Array.isArray((planRules as any).timeOfUsePeriods) &&
    (planRules as any).timeOfUsePeriods.length > 0;

  if (!hasTouPeriods || nightPercent == null || !hasNightWindow) {
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
  const weekendAssumption =
    parseEflWeekendWeekdayUsageAssumption(rawText) ?? undefined;

  const eflTdsp = extractEflTdspCharges(rawText);

  // When the EFL clearly masks TDSP numeric charges (e.g. "**") but states
  // that TDSP delivery charges are passed through from the utility, we are
  // allowed to consult the Utility/TDSP tariff table as a fallback source
  // for avg-price validation. This is the only place we ever call into the
  // Utility/TDSP module from the EFL pipeline.
  let effectiveTdspForValidation: EflTdspCharges = eflTdsp;
  let tdspFromUtilityTable:
    | {
        tdspCode: string;
        effectiveDateUsed: string;
        perKwhCents: number | null;
        monthlyCents: number | null;
        confidence: "MED" | "LOW";
      }
    | null = null;
  const tdspUnknownFromEfl =
    eflTdsp.perKwhCents == null && eflTdsp.monthlyCents == null;
  const maskedTdsp = avgTableFound && isTdspMasked(rawText, eflTdsp);
  const tdspPassThrough = avgTableFound && detectTdspPassThrough(rawText);
  let maskedTdspLookupFailedReason: string | null = null;

  const shouldUseUtilityTdspFallback =
    (maskedTdsp || (tdspPassThrough && tdspUnknownFromEfl)) && avgTableFound;

  if (shouldUseUtilityTdspFallback) {
    const territory = inferTdspTerritoryFromEflText(rawText);
    const eflDateIso = inferEflDateISO(rawText);

    if (!territory || !eflDateIso) {
      maskedTdspLookupFailedReason =
        maskedTdsp
          ? "TDSP masked with ** but TDSP service territory or effective date could not be inferred from EFL text."
          : "TDSP passed-through but TDSP service territory or effective date could not be inferred from EFL text.";
    } else {
      try {
        const tdsp = await lookupTdspCharges({
          tdspCode: territory,
          asOfDate: new Date(eflDateIso),
        });

        if (
          tdsp &&
          (tdsp.monthlyCents != null || tdsp.perKwhCents != null)
        ) {
          effectiveTdspForValidation = {
            perKwhCents: tdsp.perKwhCents,
            monthlyCents: tdsp.monthlyCents,
            // Keep original snippet if we had one; otherwise note that values
            // came from the utility tariff table.
            snippet:
              eflTdsp.snippet ??
              `TDSP delivery inferred from utility tariff table for ${territory} as of ${eflDateIso}.`,
            confidence: tdsp.confidence,
          };
          tdspFromUtilityTable = {
            tdspCode: territory,
            effectiveDateUsed: tdsp.effectiveStart.toISOString().slice(0, 10),
            perKwhCents: tdsp.perKwhCents,
            monthlyCents: tdsp.monthlyCents,
            confidence: tdsp.confidence,
          };
        } else {
          maskedTdspLookupFailedReason =
            maskedTdsp
              ? `TDSP masked with ** and no numeric TDSP tariff components found for ${territory} as of ${eflDateIso}.`
              : `TDSP passed-through but no numeric TDSP tariff components found for ${territory} as of ${eflDateIso}.`;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
        maskedTdspLookupFailedReason =
          maskedTdsp
            ? `TDSP masked with ** but utility tariff lookup failed: ${msg}`
            : `TDSP passed-through but utility tariff lookup failed: ${msg}`;
      }
    }
  }

  // For validator math, prefer a copy of planRules that includes a deterministic
  // base charge when the EFL clearly states one but the parser left it empty.
  const planRulesForValidation: any = planRules ? { ...(planRules as any) } : {};
  const validatorBaseCents = extractBaseChargePerMonthCentsFromRawText(rawText);
  if (
    validatorBaseCents != null &&
    (planRulesForValidation.baseChargePerMonthCents == null ||
      typeof planRulesForValidation.baseChargePerMonthCents !== "number")
  ) {
    planRulesForValidation.baseChargePerMonthCents = validatorBaseCents;
  }

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
      planRules: planRulesForValidation,
      rateStructure,
      kwh: p.kwh,
      eflTdsp: effectiveTdspForValidation,
      tdspIncludedInEnergyCharge: tdspIncludedFlag,
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
    });

    let components = engineResult.components;

    // For simple weekday/weekend TOU, the canonical engine path does not model
    // the EFL's stated weekend/weekday usage split reliably. Prefer deterministic
    // validator math when we have that assumption + TOU periods.
    if (
      planRulesForValidation?.rateType === "TIME_OF_USE" &&
      weekendAssumption?.weekendUsagePercent != null &&
      Array.isArray((planRulesForValidation as any).timeOfUsePeriods) &&
      (planRulesForValidation as any).timeOfUsePeriods.length > 0
    ) {
      components = null;
    }

    // 2) If engine path failed, fall back to deterministic validator math
    // from the EFL (energy rate, base charge, credits, TDSP from EFL).
    if (!components || Number.isNaN(components.avgCentsPerKwh)) {
      components = computeValidatorModeledBreakdown(
        planRulesForValidation,
        rateStructure,
        p.kwh,
        effectiveTdspForValidation,
        tdspIncludedFlag,
        weekendAssumption?.weekendUsagePercent,
        nightAssumption?.nightUsagePercent,
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
        weekendUsagePercent: weekendAssumption?.weekendUsagePercent,
        weekdayUsagePercent: weekendAssumption?.weekdayUsagePercent,
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

  // If the EFL's average prices are clearly REP+TDSP totals but the document
  // does not state numeric TDSP delivery charges (per-kWh or monthly) and we
  // could not infer a matching TDSP tariff from the utility table, we cannot
  // reliably validate the avg table. In this case, surface the modeled REP-only
  // breakdown for debugging but SKIP the strict PASS/FAIL gate.
  const tdspUnknownAfterFallback =
    effectiveTdspForValidation.perKwhCents == null &&
    effectiveTdspForValidation.monthlyCents == null;
  if (tdspUnknownAfterFallback) {
    const baseSkipNote =
      "Skipped avg-price validation: EFL does not state numeric TDSP delivery charges; avg table reflects full REP+TDSP price.";
    const maskedNote = maskedTdspLookupFailedReason
      ? `TDSP masked with ** and utility-table fallback failed: ${maskedTdspLookupFailedReason}`
      : null;

    const notes: string[] = maskedNote ? [baseSkipNote, maskedNote] : [baseSkipNote];

    return {
      status: "SKIP",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        weekendUsagePercent: weekendAssumption?.weekendUsagePercent,
        weekdayUsagePercent: weekendAssumption?.weekdayUsagePercent,
        tdspIncludedInEnergyCharge: tdspIncludedFlag,
        tdspFromEfl: {
          perKwhCents: eflTdsp.perKwhCents,
          monthlyCents: eflTdsp.monthlyCents,
          confidence: eflTdsp.confidence,
          snippet: eflTdsp.snippet,
        },
        usedEngineTdspFallback: true,
        tdspAppliedMode: "NONE",
        tdspFromUtilityTable: tdspFromUtilityTable ?? undefined,
      },
      fail: false,
      notes,
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  const allOk =
    modeledPoints.length > 0 &&
    modeledPoints.every(
      (p) => p.modeledAvgCentsPerKwh != null && p.ok === true,
    );

  const usedUtilityTableTdsp =
    tdspFromUtilityTable != null && tdspUnknownFromEfl;

  if (allOk) {
    const notes: string[] = [];
    if (usedUtilityTableTdsp && tdspFromUtilityTable) {
      notes.push(
        `TDSP charges not listed numerically on EFL (**); applied ${tdspFromUtilityTable.tdspCode} tariff from utility table effective ${tdspFromUtilityTable.effectiveDateUsed} for avg-price validation.`,
      );
    }

    return {
      status: "PASS",
      toleranceCentsPerKwh: tolerance,
      points: modeledPoints,
      assumptionsUsed: {
        nightUsagePercent: nightAssumption?.nightUsagePercent,
        nightStartHour: nightAssumption?.nightStartHour,
        nightEndHour: nightAssumption?.nightEndHour,
        weekendUsagePercent: weekendAssumption?.weekendUsagePercent,
        weekdayUsagePercent: weekendAssumption?.weekdayUsagePercent,
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
          tdspFromUtilityTable != null
            ? "UTILITY_TABLE"
            : tdspIncludedFlag === true
              ? "INCLUDED_IN_RATE"
              : eflTdsp.perKwhCents != null || eflTdsp.monthlyCents != null
                ? "ADDED_FROM_EFL"
                : "NONE",
        tdspFromUtilityTable: tdspFromUtilityTable ?? undefined,
      },
      fail: false,
      notes,
      avgTableFound,
      avgTableRows: points.map((p) => ({
        kwh: p.kwh,
        avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
      })),
      avgTableSnippet,
    };
  }

  const failNotes: string[] = [
    `Modeled avg ¢/kWh differs from EFL avg price table by up to ${maxAbsDiff.toFixed(
      4,
    )} ¢/kWh (tolerance ${tolerance} ¢/kWh).`,
  ];
  if (usedUtilityTableTdsp && tdspFromUtilityTable) {
    failNotes.unshift(
      `TDSP charges not listed numerically on EFL (**); applied ${tdspFromUtilityTable.tdspCode} tariff from utility table effective ${tdspFromUtilityTable.effectiveDateUsed} for avg-price validation.`,
    );
  }

  return {
    status: "FAIL",
    toleranceCentsPerKwh: tolerance,
    points: modeledPoints,
    assumptionsUsed: {
      nightUsagePercent: nightAssumption?.nightUsagePercent,
      nightStartHour: nightAssumption?.nightStartHour,
      nightEndHour: nightAssumption?.nightEndHour,
      weekendUsagePercent: weekendAssumption?.weekendUsagePercent,
      weekdayUsagePercent: weekendAssumption?.weekdayUsagePercent,
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
        tdspFromUtilityTable != null
          ? "UTILITY_TABLE"
          : tdspIncludedFlag === true
            ? "INCLUDED_IN_RATE"
            : eflTdsp.perKwhCents != null || eflTdsp.monthlyCents != null
              ? "ADDED_FROM_EFL"
              : "NONE",
      tdspFromUtilityTable: tdspFromUtilityTable ?? undefined,
    },
    fail: true,
    queueReason:
      "EFL average price table mismatch (modeled vs expected) — manual admin review required.",
    notes: failNotes,
    avgTableFound,
    avgTableRows: points.map((p) => ({
      kwh: p.kwh,
      avgPriceCentsPerKwh: p.eflAvgCentsPerKwh,
    })),
    avgTableSnippet,
  };
}

export async function scoreEflPassStrength(args: {
  rawText: string;
  validation: any | null;
  planRules: any | null;
  rateStructure: any | null;
}): Promise<{
  strength: EflPassStrength;
  reasons: string[];
  offPointDiffs?: Array<{
    usageKwh: number;
    expectedInterp: number;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }>;
}> {
  const { validation, planRules, rateStructure } = args;

  if (!validation || validation.status !== "PASS") {
    return { strength: "INVALID", reasons: ["NOT_PASS"] };
  }

  const reasons: string[] = [];

  const points: any[] = Array.isArray(validation.points)
    ? validation.points
    : [];

  for (const p of points) {
    const v = p?.modeledAvgCentsPerKwh;
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v <= 0 || v > 150) {
        reasons.push("AVG_OUT_OF_RANGE");
        return { strength: "INVALID", reasons: Array.from(new Set(reasons)) };
      }
    }
  }

  const baseCandidateRaw =
    (planRules as any)?.baseChargePerMonthCents ??
    (rateStructure as any)?.baseMonthlyFeeCents;
  if (
    typeof baseCandidateRaw === "number" &&
    Number.isFinite(baseCandidateRaw)
  ) {
    if (baseCandidateRaw < 0 || baseCandidateRaw > 20000) {
      reasons.push("BASE_OUT_OF_RANGE");
      return { strength: "INVALID", reasons: Array.from(new Set(reasons)) };
    }
  }

  const tiers: any[] = Array.isArray((planRules as any)?.usageTiers)
    ? (planRules as any).usageTiers
    : [];
  for (const t of tiers) {
    const rc = Number(t?.rateCentsPerKwh);
    if (Number.isFinite(rc)) {
      if (rc < 0 || rc > 200) {
        reasons.push("ENERGY_RATE_OUT_OF_RANGE");
        return { strength: "INVALID", reasons: Array.from(new Set(reasons)) };
      }
    }
  }

  const credits: any[] = Array.isArray((planRules as any)?.billCredits)
    ? (planRules as any).billCredits
    : [];
  for (const c of credits) {
    if (typeof c?.creditDollars === "number") {
      const centsVal = Math.abs(c.creditDollars * 100);
      if (centsVal > 30000) {
        reasons.push("CREDIT_OUT_OF_RANGE");
        return { strength: "INVALID", reasons: Array.from(new Set(reasons)) };
      }
    } else if (typeof c?.creditCents === "number") {
      const centsVal = Math.abs(c.creditCents);
      if (centsVal > 30000) {
        reasons.push("CREDIT_OUT_OF_RANGE");
        return { strength: "INVALID", reasons: Array.from(new Set(reasons)) };
      }
    }
  }

  const byUsage = new Map<number, any>();
  for (const p of points) {
    if (typeof p?.usageKwh === "number") {
      byUsage.set(p.usageKwh, p);
    }
  }

  const p500 = byUsage.get(500);
  const p1000 = byUsage.get(1000);
  const p2000 = byUsage.get(2000);

  if (!p500 || !p1000 || !p2000) {
    reasons.push("MISSING_ANCHOR_POINTS");
    return { strength: "WEAK", reasons: Array.from(new Set(reasons)) };
  }

  const expected500 = Number(p500.expectedAvgCentsPerKwh);
  const expected1000 = Number(p1000.expectedAvgCentsPerKwh);
  const expected2000 = Number(p2000.expectedAvgCentsPerKwh);

  if (
    !Number.isFinite(expected500) ||
    !Number.isFinite(expected1000) ||
    !Number.isFinite(expected2000)
  ) {
    reasons.push("ANCHOR_EXPECTED_INVALID");
    return { strength: "WEAK", reasons: Array.from(new Set(reasons)) };
  }

  // Off-point interpolation checks are meant to catch "cancellation passes" where the
  // model matches the three anchors but behaves strangely between them (typically due to
  // tiers/credits/TOU discontinuities). For a simple flat plan with only a base fee, the
  // avg-price curve is naturally non-linear (\(base / kWh\)), so linear interpolation will
  // produce false OFFPOINT_DEVIATION flags.
  const rateType = String((planRules as any)?.rateType ?? (rateStructure as any)?.type ?? "").toUpperCase();
  const hasAnyCredits =
    (Array.isArray((planRules as any)?.billCredits) && (planRules as any).billCredits.length > 0) ||
    Boolean((rateStructure as any)?.billCredits?.hasBillCredit);
  const hasAnyUsageTiers =
    (Array.isArray((planRules as any)?.usageTiers) && (planRules as any).usageTiers.length > 0) ||
    (Array.isArray((rateStructure as any)?.usageTiers) && (rateStructure as any).usageTiers.length > 0);
  const hasTouTiers =
    Array.isArray((rateStructure as any)?.timeOfUsePeriods) ||
    Array.isArray((rateStructure as any)?.tiers);

  const isSimpleFlat =
    rateType === "FIXED" &&
    !hasAnyCredits &&
    !hasAnyUsageTiers &&
    !hasTouTiers;

  if (isSimpleFlat) {
    return {
      strength: "STRONG",
      reasons: Array.from(new Set(reasons)),
      offPointDiffs: [],
    };
  }

  // Plans with threshold-based bill credits (e.g., "credit applies <= 500 kWh")
  // introduce a real discontinuity in the average-price curve at the threshold.
  // A linear interpolation between the 500/1000/2000 anchor points is not a
  // valid expectation model for off-point checks and will create false WEAKs.
  const hasThresholdBillCredits = credits.some((c: any) => {
    const t = String(c?.type ?? "").toUpperCase();
    const thr = Number(c?.thresholdKwh);
    return (
      Number.isFinite(thr) &&
      (t === "THRESHOLD_MAX" ||
        t === "THRESHOLD_MIN" ||
        t.includes("THRESHOLD"))
    );
  });

  if (hasThresholdBillCredits) {
    return {
      strength: "STRONG",
      reasons: Array.from(new Set(reasons)),
      offPointDiffs: [],
    };
  }

  const interp = (
    x: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number => {
    if (!Number.isFinite(x) || x2 === x1) return y1;
    const t = (x - x1) / (x2 - x1);
    return y1 + t * (y2 - y1);
  };

  const offUsages = [750, 1250, 1500];
  const offPointDiffs: Array<{
    usageKwh: number;
    expectedInterp: number;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }> = [];

  let hasOffPointIssue = false;

  for (const usage of offUsages) {
    const expectedInterp =
      usage <= 1000
        ? interp(usage, 500, expected500, 1000, expected1000)
        : interp(usage, 1000, expected1000, 2000, expected2000);

    const modeledRes = await modelAvgCentsPerKwhAtUsage({
      usageKwh: usage,
      planRules,
      rateStructure,
      assumptionsUsed: validation.assumptionsUsed ?? {},
    });

    const modeled = modeledRes.modeledAvgCentsPerKwh;
    let ok = true;
    let diff: number | null = null;

    if (modeled == null || !Number.isFinite(modeled)) {
      reasons.push("OFFPOINT_MODELED_NULL");
      ok = false;
      hasOffPointIssue = true;
    } else {
      diff = modeled - expectedInterp;
      const absDiff = Math.abs(diff);
      if (absDiff > 0.5) {
        reasons.push("OFFPOINT_DEVIATION");
        ok = false;
        hasOffPointIssue = true;
      }
    }

    offPointDiffs.push({
      usageKwh: usage,
      expectedInterp,
      modeled: modeled ?? null,
      diff,
      ok,
    });
  }

  const uniqueReasons = Array.from(new Set(reasons));

  if (hasOffPointIssue) {
    return {
      strength: "WEAK",
      reasons: uniqueReasons.length ? uniqueReasons : ["OFFPOINT_ISSUE"],
      offPointDiffs,
    };
  }

  return {
    strength: "STRONG",
    reasons: uniqueReasons.length ? uniqueReasons : [],
    offPointDiffs,
  };
}


