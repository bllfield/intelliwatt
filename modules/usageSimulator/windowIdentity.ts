const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM = /^\d{4}-\d{2}$/;

function canonicalWindowDateRange(canonicalMonths: string[]): { start: string; end: string } | null {
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0) return null;
  const first = String(canonicalMonths[0]).trim();
  const last = String(canonicalMonths[canonicalMonths.length - 1]).trim();
  if (!YYYY_MM.test(first) || !YYYY_MM.test(last)) return null;
  const start = `${first}-01`;
  const [y, m] = last.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${last}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

/** Shared identity window resolver for Past hash/cache consumers. */
export function resolveWindowFromBuildInputsForPastIdentity(
  buildInputs: Record<string, unknown>,
): { startDate: string; endDate: string } | null {
  const canonicalPeriods = Array.isArray((buildInputs as any)?.canonicalPeriods)
    ? ((buildInputs as any).canonicalPeriods as Array<{ startDate?: string; endDate?: string }>)
    : [];
  if (canonicalPeriods.length > 0) {
    const periods = canonicalPeriods
      .map((p) => ({
        startDate: String(p?.startDate ?? "").slice(0, 10),
        endDate: String(p?.endDate ?? "").slice(0, 10),
      }))
      .filter((p) => YYYY_MM_DD.test(p.startDate) && YYYY_MM_DD.test(p.endDate));
    if (periods.length > 0) {
      return {
        startDate: periods[0].startDate,
        endDate: periods[periods.length - 1].endDate,
      };
    }
  }

  const canonicalMonths = Array.isArray((buildInputs as any)?.canonicalMonths)
    ? ((buildInputs as any).canonicalMonths as string[])
    : [];
  const window = canonicalWindowDateRange(canonicalMonths);
  if (!window) return null;
  return { startDate: window.start, endDate: window.end };
}

