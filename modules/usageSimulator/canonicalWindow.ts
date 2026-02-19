/**
 * Canonical window: last 12 full months ending at the canonical end month.
 * End month = (a) last full month America/Chicago (default), or (b) manual anchor end month when in manual mode.
 * See CANONICAL_WINDOW.md. Output day count may be 365 or 366 depending on the window.
 */
import { lastFullMonthChicago, monthsEndingAt } from "@/modules/manualUsage/anchor";

export type CanonicalWindow = {
  endMonth: string; // YYYY-MM
  months: string[]; // 12 entries, ascending
};

export function canonicalWindow12Months(now = new Date()): CanonicalWindow {
  const endMonth = lastFullMonthChicago(now);
  return { endMonth, months: monthsEndingAt(endMonth, 12) };
}

