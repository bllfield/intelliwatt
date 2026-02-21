/**
 * Determines which canonical months use simulated data for Past (vs actual 15-min intervals).
 * Simulated months = (a) months with any Past overlay impact (ledger/events), (b) months with travel/vacancy, (c) months with no actual data (gap fill).
 */

const YYYY_MM = /^\d{4}-\d{2}$/;
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function toYearMonth(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim().slice(0, 7);
  return YYYY_MM.test(t) ? t : null;
}

function monthsIntersectingRange(
  canonicalMonths: string[],
  startDate: string,
  endDate: string
): Set<string> {
  const set = new Set<string>();
  if (!YYYY_MM_DD.test(startDate) || !YYYY_MM_DD.test(endDate)) return set;
  const start = new Date(startDate + "T12:00:00.000Z");
  const end = new Date(endDate + "T12:00:00.000Z");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return set;
  const startYm = start.getUTCFullYear() * 100 + (start.getUTCMonth() + 1);
  const endYm = end.getUTCFullYear() * 100 + (end.getUTCMonth() + 1);
  for (const ym of canonicalMonths) {
    const m = /^(\d{4})-(\d{2})$/.exec(ym);
    if (!m) continue;
    const y = Number(m[1]);
    const month1 = Number(m[2]);
    const ymNum = y * 100 + month1;
    if (ymNum >= startYm && ymNum <= endYm) set.add(ym);
  }
  return set;
}

export type ComputePastSimulatedMonthsArgs = {
  canonicalMonths: string[];
  /** Ledger overlay entries (effectiveMonth = YYYY-MM). */
  ledgerEntries: Array<{ effectiveMonth: string }>;
  /** Scenario events (effectiveMonth, kind e.g. MONTHLY_ADJUSTMENT, TRAVEL_RANGE). */
  scenarioEvents: Array<{ effectiveMonth: string; kind: string }>;
  /** Travel/vacancy date ranges. Months intersecting any range are simulated. */
  travelRanges: Array<{ startDate: string; endDate: string }>;
  /** Months that were gap-filled (no actual data); these are simulated. */
  filledMonths: string[];
};

/**
 * Returns the set of YYYY-MM that must use simulated data for Past.
 * All other canonical months use actual 15-min intervals.
 */
export function computePastSimulatedMonths(args: ComputePastSimulatedMonthsArgs): Set<string> {
  const simulated = new Set<string>();
  const monthSet = new Set(args.canonicalMonths);

  // (a) First changed month from ledger: all months >= min effectiveMonth are simulated.
  let firstEffective: string | null = null;
  for (const e of args.ledgerEntries) {
    const ym = toYearMonth(e.effectiveMonth);
    if (ym && monthSet.has(ym)) {
      if (firstEffective == null || ym < firstEffective) firstEffective = ym;
    }
  }
  for (const e of args.scenarioEvents) {
    const kind = String(e?.kind ?? "").trim();
    if (kind !== "MONTHLY_ADJUSTMENT" && kind !== "UPGRADE_ACTION") continue;
    const ym = toYearMonth(e.effectiveMonth);
    if (ym && monthSet.has(ym)) {
      if (firstEffective == null || ym < firstEffective) firstEffective = ym;
    }
  }
  if (firstEffective != null) {
    for (const ym of args.canonicalMonths) {
      if (ym >= firstEffective) simulated.add(ym);
    }
  }

  // (b) Months intersecting travel/vacancy ranges.
  for (const r of args.travelRanges ?? []) {
    const start = String(r?.startDate ?? "").trim().slice(0, 10);
    const end = String(r?.endDate ?? "").trim().slice(0, 10);
    const hit = monthsIntersectingRange(args.canonicalMonths, start, end);
    for (const ym of Array.from(hit)) simulated.add(ym);
  }

  // (c) Missing actual data (gap-filled months).
  for (const ym of args.filledMonths ?? []) {
    const t = String(ym).trim().slice(0, 7);
    if (YYYY_MM.test(t) && monthSet.has(t)) simulated.add(t);
  }

  return simulated;
}
