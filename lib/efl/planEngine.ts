// Core CDM types and helpers for pricing intervals based on EFL-derived rules.
// This module is intentionally independent of WattBuy, Prisma, and HTTP.

// Matches the planned `planType` values from docs/EFL_FACT_CARD_ENGINE.md.
export type PlanType =
  | "flat"
  | "tou"
  | "free-nights"
  | "free-weekends"
  | "solar-buyback"
  | "other";

/**
 * Time-of-use or promotional window (e.g., "Free Nights", "On-Peak").
 * These are derived from the EFL only.
 */
export interface TimeOfUsePeriod {
  /** Human-friendly label, e.g. "Free Nights", "On-Peak", "Off-Peak". */
  label: string;
  /**
   * Start hour of the daily window, 0–23, local time.
   * May be fractional if we later decide to support 30-minute boundaries (e.g., 21.5).
   */
  startHour: number;
  /**
   * End hour of the daily window, 0–23, local time.
   * If endHour < startHour, the period is treated as crossing midnight.
   */
  endHour: number;
  /** Days of week this period applies, 0 = Sunday, 6 = Saturday. */
  daysOfWeek: number[];
  /** Optional list of months (1–12) where this period applies. Omit/empty = all months. */
  months?: number[];
  /**
   * Import rate in cents/kWh when this period applies.
   * If `isFree` is true, this is typically 0 but kept nullable to allow explicit overrides.
   */
  rateCentsPerKwh: number | null;
  /** True if the energy charge is explicitly free in this period (e.g., Free Nights). */
  isFree: boolean;
}

/**
 * Solar buyback configuration derived from EFL (and any DG rider / solar addendum).
 */
export interface SolarBuybackConfig {
  /** True if the plan explicitly supports buyback of exported kWh. */
  hasBuyback: boolean;
  /**
   * Fixed credit rate, in cents/kWh, for exported energy.
   * If `matchesImportRate` is true, this may be null and resolved at pricing time.
   */
  creditCentsPerKwh?: number | null;
  /**
   * True if exports are credited at the same rate as the energy charge
   * (e.g., "credited at your energy charge rate").
   */
  matchesImportRate?: boolean | null;
  /**
   * Optional monthly export cap in kWh. If the EFL expresses a "not to exceed
   * your usage" clause, the billing engine will enforce the cap instead of
   * this field.
   */
  maxMonthlyExportKwh?: number | null;
  /** Additional notes from the EFL that we did not fully normalize. */
  notes?: string | null;
}

/**
 * Simple bill credit or minimum-usage structure as stated on the EFL.
 * More complex structures (tiered credits, multiple thresholds) can be
 * represented by multiple rules.
 */
export interface BillCreditRule {
  /** Usage threshold in kWh over a billing cycle. */
  thresholdKwh: number;
  /** Fixed credit (positive number) applied once when the threshold is met. */
  creditDollars: number;
}

/**
 * PlanRules is the CDM that represents how a plan behaves for pricing.
 * It is always derived only from official EFL documents.
 */
export interface PlanRules {
  /** Optional external ID or key; wiring to RatePlan happens later. */
  id?: string;
  /** Optional human-friendly name from the EFL (e.g. "Free Nights 36"). */
  name?: string;
  /** Plan type classification as defined in the planning doc. */
  planType: PlanType;
  /**
   * Default import rate in cents/kWh when no time-of-use period matches.
   * If null, callers must ensure at least one period covers every interval.
   */
  defaultRateCentsPerKwh: number | null;
  /**
   * Base charge in cents per billing month (REP component only, as stated
   * on the EFL). Applied at billing-cycle level, not per-interval.
   */
  baseChargePerMonthCents: number | null;
  /** Time-of-use / promotional windows derived from the EFL. */
  timeOfUsePeriods: TimeOfUsePeriod[];
  /** Solar buyback configuration, if any. */
  solarBuyback: SolarBuybackConfig | null;
  /** EFL-defined bill credits / minimum-usage rules. */
  billCredits: BillCreditRule[];
}

/**
 * Pricing snapshot for a single interval (time-of-day only; no billing-cycle logic).
 */
export interface IntervalPricing {
  /** Label of the active time-of-use period, if any. */
  periodLabel: string | null;
  /** Effective import rate for this timestamp, in cents/kWh. */
  importRateCentsPerKwh: number;
  /**
   * Export credit rate for this timestamp, in cents/kWh.
   * Null if no buyback applies at this time.
   */
  exportCreditCentsPerKwh: number | null;
  /** True if this interval is explicitly free for imports. */
  isFree: boolean;
}

/**
 * Charge result for a single interval.
 * Note: this does not apply base charges, bill credits, or minimum usage fees.
 * That logic belongs in a billing engine that works over a full cycle.
 */
export interface IntervalCharge extends IntervalPricing {
  /** Interval start timestamp in ISO-8601 string form. */
  timestamp: string;
  /** Import kWh for this interval. */
  kwhImport: number;
  /** Export kWh for this interval (e.g., solar exports). */
  kwhExport: number;
  /** Dollar charge for imports (always >= 0). */
  importChargeDollars: number;
  /** Dollar credit for exports (<= 0 for credits, 0 if none). */
  exportCreditDollars: number;
}

/**
 * Utility: check if the given Date is in the provided months list.
 */
function isInMonths(date: Date, months?: number[]): boolean {
  if (!months || months.length === 0) return true;
  const month = date.getMonth() + 1; // JS: 0–11
  return months.includes(month);
}

/**
 * Utility: check if a TimeOfUsePeriod applies on this calendar day (by DOW + month).
 */
function periodAppliesOnDay(period: TimeOfUsePeriod, date: Date): boolean {
  const dow = date.getDay(); // 0 = Sunday … 6 = Saturday
  if (!period.daysOfWeek.includes(dow)) return false;
  if (!isInMonths(date, period.months)) return false;
  return true;
}

/**
 * Utility: check if the time-of-day (hour + fractional minutes) falls inside
 * the period's [startHour, endHour) window, supporting cross-midnight wrapping.
 */
function isTimeInPeriod(period: TimeOfUsePeriod, date: Date): boolean {
  const hour = date.getHours() + date.getMinutes() / 60;
  const start = period.startHour;
  const end = period.endHour;

  if (start === end) {
    // Convention: equal start/end means "all day".
    return true;
  }

  if (start < end) {
    // Simple same-day window: [start, end)
    return hour >= start && hour < end;
  }

  // Cross-midnight window (e.g. 21 → 7): match if after start OR before end.
  return hour >= start || hour < end;
}

/**
 * Find the active TimeOfUsePeriod for the given timestamp, if any.
 * If multiple periods overlap (should not happen in a clean config),
 * the first matching period in the list is used.
 */
export function getActivePeriodForTimestamp(
  plan: PlanRules,
  date: Date,
): TimeOfUsePeriod | null {
  for (const period of plan.timeOfUsePeriods) {
    if (!periodAppliesOnDay(period, date)) continue;
    if (!isTimeInPeriod(period, date)) continue;
    return period;
  }
  return null;
}

/**
 * Compute the per-interval pricing (import + export rate and flags) for a single timestamp.
 *
 * This function uses only the plan rules and the local time-of-day.
 * It does not apply base charges, bill credits, minimum usage fees, or any
 * monthly aggregation. That is handled by a higher-level billing engine.
 */
export function getIntervalPricingForTimestamp(
  plan: PlanRules,
  date: Date,
): IntervalPricing {
  const activePeriod = getActivePeriodForTimestamp(plan, date);

  const isFree = Boolean(activePeriod?.isFree);
  const periodLabel = activePeriod ? activePeriod.label : null;

  let importRateCentsPerKwh: number;

  if (isFree) {
    importRateCentsPerKwh = 0;
  } else if (activePeriod && activePeriod.rateCentsPerKwh != null) {
    importRateCentsPerKwh = activePeriod.rateCentsPerKwh;
  } else if (plan.defaultRateCentsPerKwh != null) {
    importRateCentsPerKwh = plan.defaultRateCentsPerKwh;
  } else {
    // Fallback: treat missing defaults as 0. Callers can validate
    // their PlanRules to avoid this state if desired.
    importRateCentsPerKwh = 0;
  }

  let exportCreditCentsPerKwh: number | null = null;
  const sb = plan.solarBuyback;
  if (sb && sb.hasBuyback) {
    if (sb.matchesImportRate) {
      exportCreditCentsPerKwh = importRateCentsPerKwh;
    } else if (sb.creditCentsPerKwh != null) {
      exportCreditCentsPerKwh = sb.creditCentsPerKwh;
    }
  }

  return {
    periodLabel,
    importRateCentsPerKwh,
    exportCreditCentsPerKwh,
    isFree,
  };
}

/**
 * Compute the monetary charge for a single interval given its kWh imports
 * and exports. This is still a "local" calculation that ignores base charges
 * and billing-cycle rules.
 */
export function computeIntervalCharge(
  plan: PlanRules,
  date: Date,
  kwhImport: number,
  kwhExport: number,
): IntervalCharge {
  const pricing = getIntervalPricingForTimestamp(plan, date);

  const importChargeDollars =
    (pricing.importRateCentsPerKwh / 100) * kwhImport;

  let exportCreditDollars = 0;
  if (pricing.exportCreditCentsPerKwh != null && kwhExport > 0) {
    exportCreditDollars =
      (pricing.exportCreditCentsPerKwh / 100) * kwhExport * -1;
  }

  return {
    timestamp: date.toISOString(),
    kwhImport,
    kwhExport,
    importChargeDollars,
    exportCreditDollars,
    ...pricing,
  };
}

