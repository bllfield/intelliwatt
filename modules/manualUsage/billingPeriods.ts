const DAY_MS = 24 * 60 * 60 * 1000;

function isIsoDateKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "").trim());
}

function parseIsoDateKey(d: string): { year: number; month1: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || !Number.isFinite(day)) return null;
  if (month1 < 1 || month1 > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month1, day };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInUtcMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function addDaysUtcDateKey(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return dateKey;
  return new Date(t + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

function shiftMonthClampDay(anchorEndDateKey: string, deltaMonths: number): string | null {
  const p = parseIsoDateKey(anchorEndDateKey);
  if (!p) return null;

  const base = new Date(Date.UTC(p.year, p.month1 - 1, 1, 0, 0, 0, 0));
  base.setUTCMonth(base.getUTCMonth() + deltaMonths);

  const y = base.getUTCFullYear();
  const m1 = base.getUTCMonth() + 1;
  const dim = daysInUtcMonth(y, m1);
  const day = Math.max(1, Math.min(dim, p.day));
  return `${y}-${pad2(m1)}-${pad2(day)}`;
}

export type BillingPeriod = {
  id: string; // YYYY-MM (end month label)
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string; // YYYY-MM-DD (inclusive)
};

export function billingPeriodsEndingAt(anchorEndDateKey: string, count = 12): BillingPeriod[] {
  const n = Math.max(1, Math.min(24, Math.trunc(count)));
  const endKey = String(anchorEndDateKey ?? "").trim();
  if (!isIsoDateKey(endKey)) return [];

  // Build end dates oldest..newest.
  const endDates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const shifted = shiftMonthClampDay(endKey, -i);
    if (!shifted) return [];
    endDates.push(shifted);
  }

  // Previous boundary is one month before oldest end date (clamped).
  const prevBoundary = shiftMonthClampDay(endKey, -n);
  if (!prevBoundary) return [];

  const periods: BillingPeriod[] = [];
  let prevEnd = prevBoundary;
  for (const endDate of endDates) {
    const startDate = addDaysUtcDateKey(prevEnd, 1);
    periods.push({ id: endDate.slice(0, 7), startDate, endDate });
    prevEnd = endDate;
  }
  return periods;
}

