/**
 * Rule R-TOU-BREAKDOWN: Energy Charge Breakdown tables (Off-peak / On-peak rows
 * with clock windows, ¢/kWh rates, and optional Expected Usage %).
 */

export type EnergyChargeBreakdownTouPeriod = {
  label: string;
  startHour: number;
  endHour: number;
  daysOfWeek: number[];
  rateCentsPerKwh: number;
  isFree: boolean;
};

export type EnergyChargeBreakdownTouExtract = {
  periods: EnergyChargeBreakdownTouPeriod[];
  offPeakUsagePercent: number | null;
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const CLOCK_RANGE_RE =
  /([0-9]{1,2})\s*:\s*([0-9]{2})\s*(am|pm)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(am|pm)/gi;

function parseClockTokenTo24(hh: string, mm: string, ap: string): number | null {
  let h = Number(hh);
  const minute = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(minute)) return null;
  const isPm = ap.toUpperCase() === "PM";
  if (h === 12) h = isPm ? 12 : 0;
  else h = isPm ? h + 12 : h;
  return h;
}

function parseClockTokenTo24EndExclusive(hh: string, mm: string, ap: string): number | null {
  const base = parseClockTokenTo24(hh, mm, ap);
  if (base == null) return null;
  const minute = Number(mm);
  if (!Number.isFinite(minute)) return base;
  if (minute > 0) return (base + 1) % 24;
  return base;
}

function parseClockRanges(text: string): Array<{ startHour: number; endHour: number }> {
  const out: Array<{ startHour: number; endHour: number }> = [];
  const re = new RegExp(CLOCK_RANGE_RE.source, CLOCK_RANGE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = parseClockTokenTo24(m[1], m[2], m[3]);
    const end = parseClockTokenTo24EndExclusive(m[4], m[5], m[6]);
    if (start == null || end == null) continue;
    out.push({ startHour: start, endHour: end === 0 && Number(m[5]) > 0 ? 24 : end });
  }
  return out;
}

function parseBreakdownRow(args: {
  text: string;
  labelPattern: RegExp;
  defaultLabel: string;
}): { periods: EnergyChargeBreakdownTouPeriod[]; usagePercent: number | null } | null {
  const m = args.text.match(args.labelPattern);
  if (!m?.[0]) return null;
  const rowText = m[0];
  const rateMatch = rowText.match(/([0-9]+(?:\.[0-9]+)?)\s*¢/i);
  if (!rateMatch?.[1]) return null;
  const rateCentsPerKwh = Number(rateMatch[1]);
  if (!Number.isFinite(rateCentsPerKwh)) return null;

  const pctMatch = rowText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/i);
  const usagePercent =
    pctMatch?.[1] && Number.isFinite(Number(pctMatch[1])) ? Number(pctMatch[1]) / 100 : null;

  const windows = parseClockRanges(rowText);
  if (!windows.length) return null;

  const periods = windows.map((w, idx) => ({
    label: windows.length > 1 ? `${args.defaultLabel} ${idx + 1}` : args.defaultLabel,
    startHour: w.startHour,
    endHour: w.endHour,
    daysOfWeek: ALL_DAYS,
    rateCentsPerKwh,
    isFree: false,
  }));

  return { periods, usagePercent };
}

export function hasEnergyChargeBreakdownTou(rawText: string): boolean {
  const t = String(rawText ?? "");
  return (
    /Energy\s*Charge\s*Breakdown/i.test(t) &&
    /Off-?\s*peak/i.test(t) &&
    /On-?\s*peak/i.test(t)
  );
}

export function extractEnergyChargeBreakdownTou(rawText: string): EnergyChargeBreakdownTouExtract | null {
  const t = String(rawText ?? "");
  if (!hasEnergyChargeBreakdownTou(t)) return null;

  const off = parseBreakdownRow({
    text: t,
    labelPattern: /Off-?\s*peak[\s\S]{0,900}?[0-9]+(?:\.[0-9]+)?\s*¢[\s\S]{0,120}?[0-9]+(?:\.[0-9]+)?\s*%/i,
    defaultLabel: "Off-Peak",
  });
  const on = parseBreakdownRow({
    text: t,
    labelPattern: /On-?\s*peak[\s\S]{0,600}?[0-9]+(?:\.[0-9]+)?\s*¢[\s\S]{0,120}?[0-9]+(?:\.[0-9]+)?\s*%/i,
    defaultLabel: "Peak",
  });

  if (!off?.periods.length || !on?.periods.length) return null;

  return {
    periods: [...off.periods, ...on.periods],
    offPeakUsagePercent: off.usagePercent,
  };
}

export function applyEnergyChargeBreakdownTouToTemplateShapes(args: {
  planRules: Record<string, any>;
  rateStructure: Record<string, any>;
  breakdown: EnergyChargeBreakdownTouExtract;
}): void {
  const { planRules, rateStructure, breakdown } = args;
  const offPeakDefault = breakdown.periods.find((p) => /off/i.test(p.label))?.rateCentsPerKwh ?? null;

  planRules.rateType = "TIME_OF_USE";
  planRules.planType = "tou";
  planRules.timeOfUsePeriods = breakdown.periods;
  if (offPeakDefault != null) {
    planRules.defaultRateCentsPerKwh = offPeakDefault;
  }
  delete planRules.currentBillEnergyRateCents;

  rateStructure.type = "TIME_OF_USE";
  rateStructure.timeOfUsePeriods = breakdown.periods;
  delete rateStructure.energyRateCents;
  delete rateStructure.usageTiers;
}
