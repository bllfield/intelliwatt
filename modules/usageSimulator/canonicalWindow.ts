import { lastFullMonthChicago, monthsEndingAt } from "@/modules/manualUsage/anchor";

export type CanonicalWindow = {
  endMonth: string; // YYYY-MM
  months: string[]; // 12 entries, ascending
};

export function canonicalWindow12Months(now = new Date()): CanonicalWindow {
  const endMonth = lastFullMonthChicago(now);
  return { endMonth, months: monthsEndingAt(endMonth, 12) };
}

