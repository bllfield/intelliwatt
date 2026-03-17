/**
 * Canonical window: last 12 full months ending at the canonical end month.
 * End month is derived from the canonical usage day window anchor (today-2 Chicago by default).
 * See CANONICAL_WINDOW.md. Output day count may be 365 or 366 depending on the window.
 */
import { monthsEndingAt } from "@/modules/manualUsage/anchor";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

export type CanonicalWindow = {
  endMonth: string; // YYYY-MM
  months: string[]; // 12 entries, ascending
};

export function canonicalWindow12Months(now = new Date()): CanonicalWindow {
  const { endDate } = resolveCanonicalUsage365CoverageWindow(now);
  const endMonth = endDate.slice(0, 7);
  return { endMonth, months: monthsEndingAt(endMonth, 12) };
}

