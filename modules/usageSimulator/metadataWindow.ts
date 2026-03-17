export type CoverageWindow = { startDate: string; endDate: string };

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateKey(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return YYYY_MM_DD.test(s) ? s : null;
}

/**
 * Shared payload/report framing window for simulator metadata surfaces.
 * Prefer dataset.summary bounds when present; fall back to provided bounds.
 */
export function resolveReportedCoverageWindow(args: {
  dataset: any;
  fallbackStartDate: string;
  fallbackEndDate: string;
}): CoverageWindow {
  const fallbackStart = normalizeDateKey(args.fallbackStartDate) ?? String(args.fallbackStartDate).slice(0, 10);
  const fallbackEnd = normalizeDateKey(args.fallbackEndDate) ?? String(args.fallbackEndDate).slice(0, 10);
  const summaryStart = normalizeDateKey(args?.dataset?.summary?.start);
  const summaryEnd = normalizeDateKey(args?.dataset?.summary?.end);
  return {
    startDate: summaryStart ?? fallbackStart,
    endDate: summaryEnd ?? fallbackEnd,
  };
}

export function boundDateKeysToCoverageWindow(
  dateKeys: string[] | ReadonlyArray<string> | Set<string>,
  window: CoverageWindow
): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(dateKeys)) {
    for (let i = 0; i < dateKeys.length; i += 1) {
      const key = normalizeDateKey(dateKeys[i]);
      if (!key) continue;
      if (key >= window.startDate && key <= window.endDate) out.add(key);
    }
    return out;
  }
  dateKeys.forEach((dk) => {
    const key = normalizeDateKey(dk);
    if (!key) return;
    if (key >= window.startDate && key <= window.endDate) out.add(key);
  });
  return out;
}

