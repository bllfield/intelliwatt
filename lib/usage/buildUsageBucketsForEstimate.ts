import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import type { BucketRuleV1, OvernightAttribution } from "@/lib/plan-engine/usageBuckets";
import { bucketDefsFromBucketKeys, canonicalizeMonthlyBucketKey } from "@/lib/plan-engine/usageBuckets";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";

const DAY_MS = 24 * 60 * 60 * 1000;

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function aliasesForCanonicalMonthlyBucketKey(key: string): string[] {
  const s = canonicalizeMonthlyBucketKey(String(key ?? "").trim());
  if (!s) return [];
  const m = s.match(/^kwh\.m\.(all|weekday|weekend)\.(.+)$/);
  if (!m) return [s];
  const day = m[1];
  const suffix = m[2];

  const out: string[] = [];
  out.push(`kwh.m.${day}.${suffix}`);
  out.push(`kwh.m.${day.toUpperCase()}.${suffix}`);
  if (suffix === "total") {
    out.push(`kwh.m.${day}.0000-2400`);
    out.push(`kwh.m.${day.toUpperCase()}.0000-2400`);
    out.push(`kwh.m.${day.toUpperCase()}.total`);
  }
  return uniq(out);
}

function daysInMonth(year: number, month1: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return 31;
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function isBucketSumMismatchTolerable(args: { totalKwh: number; sumKwh: number }): boolean {
  const total = args.totalKwh;
  const sum = args.sumKwh;
  if (!Number.isFinite(total) || !Number.isFinite(sum)) return false;
  if (total <= 0 || sum <= 0) return false;
  const diff = Math.abs(sum - total);
  // Keep this aligned with plan-cost mismatch tolerance (<=3% or 2 kWh).
  const tol = Math.max(2, total * 0.03); // kWh
  return diff <= tol;
}

function chicagoYearMonthParts(now: Date): { year: number; month: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
    return { year: y, month: m };
  } catch {
    return null;
  }
}

function lastNYearMonthsChicagoFrom(date: Date, n: number): string[] {
  const base = chicagoYearMonthParts(date);
  if (!base) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = base.month - i;
    const y = idx >= 1 ? base.year : base.year - Math.ceil((1 - idx) / 12);
    const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
  }
  return out;
}

function chicagoParts(ts: Date): {
  yearMonth: string;
  year: number;
  month: number;
  day: number;
  weekdayIndex: number; // 0=Sun..6=Sat
  minutesOfDay: number;
} | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    const hh = Number(get("hour"));
    const mm = Number(get("minute"));
    const wd = get("weekday");
    if (![y, m, d, hh, mm].every((n) => Number.isFinite(n))) return null;
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    if (weekdayIndex < 0) return null;
    const minutesOfDay = hh * 60 + mm;
    return {
      yearMonth: `${String(y)}-${String(m).padStart(2, "0")}`,
      year: y,
      month: m,
      day: d,
      weekdayIndex,
      minutesOfDay,
    };
  } catch {
    return null;
  }
}

function lastCompleteChicagoDay(ts: Date, opts?: { minMinutesOfDay?: number; maxStepDays?: number }): {
  year: number;
  month: number;
  yearMonth: string;
  day: number;
} | null {
  const minMinutesOfDay =
    typeof opts?.minMinutesOfDay === "number" ? opts!.minMinutesOfDay : 23 * 60 + 45; // 23:45
  const maxStepDays = typeof opts?.maxStepDays === "number" ? opts!.maxStepDays : 2;

  const p0 = chicagoParts(ts);
  if (!p0) return null;
  if (p0.minutesOfDay >= minMinutesOfDay) {
    return { year: p0.year, month: p0.month, yearMonth: p0.yearMonth, day: p0.day };
  }

  const anchor = new Date(Date.UTC(p0.year, p0.month - 1, p0.day, 18, 0, 0));
  for (let step = 1; step <= Math.max(1, maxStepDays); step++) {
    const prev = new Date(anchor.getTime() - step * DAY_MS);
    const p = chicagoParts(prev);
    if (!p) continue;
    return { year: p.year, month: p.month, yearMonth: p.yearMonth, day: p.day };
  }
  return null;
}

function isWeekendByIndex(idx: number): boolean {
  return idx === 0 || idx === 6;
}

function hhmmToMinutes(hhmm: string): number | null {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (hh === 24 && mm === 0) return 24 * 60;
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function evalRule(
  rule: BucketRuleV1,
  local: { month: number; dayOfMonth: number; weekdayIndex: number; minutesOfDay: number },
): boolean {
  if (!rule || rule.v !== 1) return false;
  if (rule.tz !== "America/Chicago") return false;

  const startMin = hhmmToMinutes(String(rule.window?.startHHMM ?? "").trim());
  const endMin = hhmmToMinutes(String(rule.window?.endHHMM ?? "").trim());
  if (startMin == null || endMin == null) return false;
  if (startMin === endMin) return false;

  const overnight = startMin > endMin;
  const t = local.minutesOfDay;
  const inWindow = overnight ? t >= startMin || t < endMin : t >= startMin && t < endMin;
  if (!inWindow) return false;

  const attribution: OvernightAttribution = rule.overnightAttribution ?? "ACTUAL_DAY";
  const usePrevDayForFilter = overnight && attribution === "START_DAY" && t < endMin;
  const weekdayIndex = usePrevDayForFilter ? (local.weekdayIndex + 6) % 7 : local.weekdayIndex;
  const isWeekend = isWeekendByIndex(weekdayIndex);

  if (Array.isArray(rule.months) && rule.months.length > 0) {
    const attributedMonth =
      usePrevDayForFilter && local.dayOfMonth === 1 ? (local.month === 1 ? 12 : local.month - 1) : local.month;
    if (!rule.months.includes(attributedMonth)) return false;
  }

  if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0) {
    if (!rule.daysOfWeek.includes(weekdayIndex)) return false;
  } else if (rule.dayType) {
    const dt = rule.dayType;
    if (dt === "WEEKDAY" && isWeekend) return false;
    if (dt === "WEEKEND" && !isWeekend) return false;
  }

  return true;
}

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function monthToUtcRange(year: number, month1: number): { gte: Date; lt: Date } {
  const start = new Date(Date.UTC(year, month1 - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month1, 1, 0, 0, 0));
  return { gte: new Date(start.getTime() - 36 * 60 * 60 * 1000), lt: new Date(end.getTime() + 36 * 60 * 60 * 1000) };
}

export async function buildUsageBucketsForEstimate(args: {
  homeId: string;
  usageSource: "SMT" | "GREEN_BUTTON";
  esiid?: string | null;
  rawId?: string | null;
  windowEnd: Date;
  cutoff: Date;
  requiredBucketKeys: string[];
  monthsCount?: number;
  maxStepDays?: number;
  stitchMode?: "DAILY_ONLY" | "DAILY_OR_INTERVAL" | "NONE";
  // If false, this function becomes READ-ONLY: it will not attempt to compute/ensure missing buckets.
  // Callers like the customer Plans list must be display-only and should rely on the pipeline to populate buckets.
  computeMissing?: boolean;
}): Promise<{
  yearMonths: string[];
  keysToLoad: string[];
  usageBucketsByMonth: Record<string, Record<string, number>>;
  annualKwh: number | null;
  stitchedMonth:
    | {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      }
    | null;
}> {
  const monthsCount = Math.max(1, Math.floor(args.monthsCount ?? 12));
  const stitchMode = args.stitchMode ?? "DAILY_OR_INTERVAL";
  const computeMissing = args.computeMissing !== false;
  const completeDay = lastCompleteChicagoDay(args.windowEnd, { maxStepDays: args.maxStepDays ?? 2 });
  const stitchYm = completeDay?.yearMonth ?? null;

  const yearMonths = (stitchYm
    ? lastNYearMonthsChicagoFrom(new Date(`${stitchYm}-15T12:00:00Z`), monthsCount)
    : lastNYearMonthsChicagoFrom(args.windowEnd, monthsCount)
  )
    .slice()
    .reverse();

  const keysToLoad = Array.from(
    new Set(
      ["kwh.m.all.total", ...(Array.isArray(args.requiredBucketKeys) ? args.requiredBucketKeys : [])]
        .map((k) => canonicalizeMonthlyBucketKey(String(k ?? "").trim()))
        .filter(Boolean),
    ),
  );
  const bucketDefs = bucketDefsFromBucketKeys(keysToLoad);

  // Check bucket coverage first; compute only when missing so plan cost never "stalls"
  // on missing TOU buckets while keeping fast paths cheap.
  let shouldCompute = true;
  try {
    const aliasesByCanonical: Record<string, string[]> = {};
    const allQueryKeys: string[] = [];
    for (const k of keysToLoad) {
      const aliases = aliasesForCanonicalMonthlyBucketKey(k);
      if (aliases.length === 0) continue;
      aliasesByCanonical[k] = aliases;
      allQueryKeys.push(...aliases);
    }

    const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
      where: {
        homeId: args.homeId,
        yearMonth: { in: yearMonths },
        bucketKey: { in: uniq(allQueryKeys) },
      },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true },
    });

    const presentByMonth: Record<string, Set<string>> = {};
    const valuesByMonth: Record<string, Record<string, number>> = {};
    for (const r of rows ?? []) {
      const ym = String((r as any)?.yearMonth ?? "").trim();
      const bk = String((r as any)?.bucketKey ?? "").trim();
      const kwh = decimalToNumber((r as any)?.kwhTotal);
      if (!ym || !bk) continue;
      if (!presentByMonth[ym]) presentByMonth[ym] = new Set<string>();
      presentByMonth[ym].add(bk);
      const canonical = canonicalizeMonthlyBucketKey(bk);
      if (canonical && typeof kwh === "number" && Number.isFinite(kwh)) {
        if (!valuesByMonth[ym]) valuesByMonth[ym] = {};
        const prev = valuesByMonth[ym][canonical];
        // If multiple aliases exist for the same canonical key, keep the larger magnitude to avoid false zeros.
        valuesByMonth[ym][canonical] = typeof prev === "number" && Number.isFinite(prev) ? Math.max(prev, kwh) : kwh;
      }
    }

    let missingAny = false;
    for (const ym of yearMonths) {
      const set = presentByMonth[ym] ?? new Set<string>();
      for (const canonical of keysToLoad) {
        const aliases = aliasesByCanonical[canonical] ?? [canonical];
        const found = aliases.some((k) => set.has(k));
        if (!found) {
          missingAny = true;
          break;
        }
      }
      if (missingAny) break;
    }

    // If the required buckets are present but internally inconsistent (period buckets don't sum to totals),
    // we must recompute from intervals to self-heal. Otherwise the plan engine fail-closes with
    // USAGE_BUCKET_SUM_MISMATCH and the user UI shows "not computable" even though the plan is valid.
    let mismatchAny = false;
    if (!missingAny) {
      const canonicalKeys = keysToLoad.map((k) => canonicalizeMonthlyBucketKey(String(k ?? "").trim())).filter(Boolean) as string[];
      const byDayKind: Record<"all" | "weekday" | "weekend", string[]> = { all: [], weekday: [], weekend: [] };
      for (const k of canonicalKeys) {
        const m = k.match(/^kwh\.m\.(all|weekday|weekend)\.(.+)$/);
        if (!m) continue;
        const kind = m[1] as "all" | "weekday" | "weekend";
        const suffix = m[2];
        if (suffix === "total") continue;
        // Only treat HHMM-HHMM buckets as summable parts of a day partition.
        if (!/^\d{4}-\d{4}$/.test(suffix)) continue;
        byDayKind[kind].push(k);
      }

      for (const ym of yearMonths) {
        const vals = valuesByMonth[ym] ?? {};
        for (const kind of ["all", "weekday", "weekend"] as const) {
          const totalKey = `kwh.m.${kind}.total`;
          const total = vals[totalKey];
          if (!(typeof total === "number" && Number.isFinite(total) && total > 0)) continue;
          const parts = byDayKind[kind];
          if (!parts || parts.length < 2) continue;
          const partVals = parts.map((k) => vals[k]).filter((v) => typeof v === "number" && Number.isFinite(v) && v >= 0) as number[];
          if (partVals.length < 2) continue;
          const sum = partVals.reduce((a, b) => a + b, 0);
          if (Math.abs(sum - total) > 0.01 && !isBucketSumMismatchTolerable({ totalKwh: total, sumKwh: sum })) {
            mismatchAny = true;
            break;
          }
        }
        if (mismatchAny) break;
      }
    }

    shouldCompute = missingAny || mismatchAny;
  } catch {
    // If coverage check fails, default to computing (best-effort) to avoid false "missing buckets" stalls.
    shouldCompute = true;
  }

  if (computeMissing && shouldCompute) {
    // Ensure buckets exist for these keys/range (best-effort).
    try {
      await ensureCoreMonthlyBuckets({
        homeId: args.homeId,
        esiid: args.usageSource === "SMT" ? (args.esiid ?? null) : null,
        rangeStart: args.cutoff,
        rangeEnd: args.windowEnd,
        source: args.usageSource === "SMT" ? "SMT" : "GREENBUTTON",
        intervalSource: args.usageSource === "SMT" ? "SMT" : "GREENBUTTON",
        bucketDefs,
      });
    } catch {
      // ignore
    }
  }

  // Load monthly buckets from usage DB.
  const usageBucketsByMonth: Record<string, Record<string, number>> = {};
  try {
    const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
      where: { homeId: args.homeId, yearMonth: { in: yearMonths }, bucketKey: { in: keysToLoad } },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true },
    });
    for (const r of rows ?? []) {
      const ym = String((r as any)?.yearMonth ?? "").trim();
      const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
      const kwh = decimalToNumber((r as any)?.kwhTotal);
      if (!ym || !key || kwh == null) continue;
      if (!usageBucketsByMonth[ym]) usageBucketsByMonth[ym] = {};
      usageBucketsByMonth[ym][key] = kwh;
    }
  } catch {
    // ignore
  }

  // Stitch newest month to full calendar month.
  const stitchedMonth =
    completeDay && stitchYm && yearMonths.length && yearMonths[yearMonths.length - 1] === stitchYm
      ? (() => {
          const lastDay = completeDay.day;
          const monthDays = daysInMonth(completeDay.year, completeDay.month);
          const missingStartDay = lastDay + 1;
          if (missingStartDay > monthDays) return null;
          return {
            mode: "PRIOR_YEAR_TAIL" as const,
            yearMonth: stitchYm,
            haveDaysThrough: lastDay,
            missingDaysFrom: missingStartDay,
            missingDaysTo: monthDays,
            borrowedFromYearMonth: `${String(completeDay.year - 1)}-${String(completeDay.month).padStart(2, "0")}`,
            completenessRule: "Uses last complete local day (>=23:45) and may step back up to 2 days if SMT/GB is late.",
          };
        })()
      : null;

  if (stitchedMonth && stitchMode !== "NONE") {
    // Preferred: stitch using DAILY buckets (fast, no interval scans).
    try {
      const ym = stitchedMonth.yearMonth;
      const byBucket: Record<string, number> = {};
      for (const k of keysToLoad) byBucket[k] = 0;

      const monthDays = daysInMonth(completeDay!.year, completeDay!.month);
      const mkDay = (y: number, m: number, d: number) => `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

      const curDays: string[] = [];
      for (let d = 1; d <= stitchedMonth.haveDaysThrough; d++) curDays.push(mkDay(completeDay!.year, completeDay!.month, d));
      const priorDays: string[] = [];
      for (let d = stitchedMonth.missingDaysFrom; d <= stitchedMonth.missingDaysTo; d++) {
        priorDays.push(mkDay(completeDay!.year - 1, completeDay!.month, d));
      }

      const loadDays = async (days: string[]) => {
        if (!days.length) return [];
        return await (usagePrisma as any).homeDailyUsageBucket.findMany({
          where: { homeId: args.homeId, day: { in: days }, bucketKey: { in: keysToLoad } },
          select: { day: true, bucketKey: true, kwhTotal: true },
        });
      };

      const curRows = await loadDays(curDays);
      const priorRows = await loadDays(priorDays);

      // IMPORTANT:
      // Only apply DAILY stitching if we have DAILY coverage for *all* requested bucket keys
      // across both the "current" and "borrowed" day ranges.
      //
      // Otherwise, we can accidentally stitch `kwh.m.all.total` (which is usually available)
      // while leaving TOU/window buckets missing/partial for the borrowed segment, which then
      // triggers `USAGE_BUCKET_SUM_MISMATCH` (period buckets don't sum to total).
      //
      // When DAILY coverage is incomplete:
      // - DAILY_ONLY: keep the monthly buckets as-is (no stitching)
      // - DAILY_OR_INTERVAL: fall back to interval stitching so all keys are computed consistently
      // NOTE:
      // Previously we only checked that each key existed at least once in each segment. That’s not enough:
      // if `kwh.m.all.total` is missing for even a single day but period buckets are present, we can get:
      //   sum(periods) > total  → USAGE_BUCKET_SUM_MISMATCH
      // So we require per-day coverage for each key (for the days we’re stitching).
      const curDaysSet = new Set(curDays);
      const priorDaysSet = new Set(priorDays);

      const curKeyDays = new Map<string, Set<string>>();
      const priorKeyDays = new Map<string, Set<string>>();

      for (const r of curRows ?? []) {
        const day = String((r as any)?.day ?? "").trim();
        const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
        if (!day || !key || !curDaysSet.has(day)) continue;
        if (!curKeyDays.has(key)) curKeyDays.set(key, new Set<string>());
        curKeyDays.get(key)!.add(day);
      }
      for (const r of priorRows ?? []) {
        const day = String((r as any)?.day ?? "").trim();
        const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
        if (!day || !key || !priorDaysSet.has(day)) continue;
        if (!priorKeyDays.has(key)) priorKeyDays.set(key, new Set<string>());
        priorKeyDays.get(key)!.add(day);
      }

      const needCur = curDays.length > 0;
      const needPrior = priorDays.length > 0;
      const dailyCoverageOk =
        keysToLoad.length > 0 &&
        keysToLoad.every((k) => {
          const kk = canonicalizeMonthlyBucketKey(String(k ?? "").trim());
          if (!kk) return false;
          if (needCur) {
            const days = curKeyDays.get(kk);
            if (!days || days.size !== curDays.length) return false;
          }
          if (needPrior) {
            const days = priorKeyDays.get(kk);
            if (!days || days.size !== priorDays.length) return false;
          }
          return true;
        });

      const addRows = (rows: any[]) => {
        for (const r of rows ?? []) {
          const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
          const kwh = decimalToNumber((r as any)?.kwhTotal);
          if (!key || kwh == null) continue;
          byBucket[key] = (byBucket[key] ?? 0) + kwh;
        }
      };
      if (dailyCoverageOk) {
        addRows(curRows);
        addRows(priorRows);
      }

      // If we got any daily rows, apply stitched totals.
      const hasAny = Object.values(byBucket).some((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
      if (dailyCoverageOk && hasAny) {
        usageBucketsByMonth[ym] = byBucket;
      } else if (stitchMode === "DAILY_ONLY") {
        // do nothing (keep monthly buckets as-is)
      } else if (stitchMode === "DAILY_OR_INTERVAL") {
        // Fall back to interval stitching when DAILY coverage is incomplete.
        try {
          const currentRange = monthToUtcRange(completeDay!.year, completeDay!.month);
          const priorRange = monthToUtcRange(completeDay!.year - 1, completeDay!.month);

          const currentRows: Array<{ ts: Date; kwh: number }> = [];
          const priorRows2: Array<{ ts: Date; kwh: number }> = [];

          if (args.usageSource === "SMT") {
            const esiid = String(args.esiid ?? "");
            if (esiid) {
              const cur = await prisma.smtInterval.findMany({
                where: { esiid, ts: { gte: currentRange.gte, lt: currentRange.lt } },
                select: { ts: true, kwh: true },
                orderBy: { ts: "asc" },
              });
              for (const r of cur ?? []) {
                const kwh = decimalToNumber((r as any)?.kwh);
                const ts = (r as any)?.ts ? new Date((r as any).ts) : null;
                if (ts && kwh != null) currentRows.push({ ts, kwh });
              }

              const prior = await prisma.smtInterval.findMany({
                where: { esiid, ts: { gte: priorRange.gte, lt: priorRange.lt } },
                select: { ts: true, kwh: true },
                orderBy: { ts: "asc" },
              });
              for (const r of prior ?? []) {
                const kwh = decimalToNumber((r as any)?.kwh);
                const ts = (r as any)?.ts ? new Date((r as any).ts) : null;
                if (ts && kwh != null) priorRows2.push({ ts, kwh });
              }
            }
          } else {
            const rawId = String(args.rawId ?? "");
            if (rawId) {
              const usageClient = usagePrisma as any;
              const cur = await usageClient.greenButtonInterval.findMany({
                where: { homeId: args.homeId, rawId, timestamp: { gte: currentRange.gte, lt: currentRange.lt } },
                select: { timestamp: true, consumptionKwh: true },
                orderBy: { timestamp: "asc" },
              });
              for (const r of cur ?? []) {
                const kwh = decimalToNumber((r as any)?.consumptionKwh);
                const ts = (r as any)?.timestamp ? new Date((r as any).timestamp) : null;
                if (ts && kwh != null) currentRows.push({ ts, kwh });
              }

              const prior = await usageClient.greenButtonInterval.findMany({
                where: { homeId: args.homeId, rawId, timestamp: { gte: priorRange.gte, lt: priorRange.lt } },
                select: { timestamp: true, consumptionKwh: true },
                orderBy: { timestamp: "asc" },
              });
              for (const r of prior ?? []) {
                const kwh = decimalToNumber((r as any)?.consumptionKwh);
                const ts = (r as any)?.timestamp ? new Date((r as any).timestamp) : null;
                if (ts && kwh != null) priorRows2.push({ ts, kwh });
              }
            }
          }

          if (currentRows.length && priorRows2.length) {
            const totals: Record<string, number> = {};
            for (const k of keysToLoad) totals[k] = 0;

            const applyIntervals = (
              rows: Array<{ ts: Date; kwh: number }>,
              onlyYearMonth: string,
              dayMin: number,
              dayMax: number,
            ) => {
              for (const r of rows) {
                const p = chicagoParts(r.ts);
                if (!p) continue;
                if (p.yearMonth !== onlyYearMonth) continue;
                if (p.day < dayMin || p.day > dayMax) continue;
                for (const def of bucketDefs) {
                  const rule = def.rule as BucketRuleV1;
                  if (
                    !evalRule(rule, {
                      month: p.month,
                      dayOfMonth: p.day,
                      weekdayIndex: p.weekdayIndex,
                      minutesOfDay: p.minutesOfDay,
                    })
                  )
                    continue;
                  totals[def.key] = (totals[def.key] ?? 0) + r.kwh;
                }
              }
            };

            applyIntervals(currentRows, stitchedMonth.yearMonth, 1, stitchedMonth.haveDaysThrough);
            applyIntervals(priorRows2, stitchedMonth.borrowedFromYearMonth, stitchedMonth.missingDaysFrom, stitchedMonth.missingDaysTo);
            usageBucketsByMonth[stitchedMonth.yearMonth] = totals;
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // If daily table isn't deployed yet, optionally fall back to interval stitching (detail page only).
      if (stitchMode === "DAILY_OR_INTERVAL") {
        try {
          const currentRange = monthToUtcRange(completeDay!.year, completeDay!.month);
          const priorRange = monthToUtcRange(completeDay!.year - 1, completeDay!.month);

          const currentRows: Array<{ ts: Date; kwh: number }> = [];
          const priorRows: Array<{ ts: Date; kwh: number }> = [];

          if (args.usageSource === "SMT") {
            const esiid = String(args.esiid ?? "");
            if (esiid) {
              const cur = await prisma.smtInterval.findMany({
                where: { esiid, ts: { gte: currentRange.gte, lt: currentRange.lt } },
                select: { ts: true, kwh: true },
                orderBy: { ts: "asc" },
              });
              for (const r of cur ?? []) {
                const kwh = decimalToNumber((r as any)?.kwh);
                const ts = (r as any)?.ts ? new Date((r as any).ts) : null;
                if (ts && kwh != null) currentRows.push({ ts, kwh });
              }

              const prior = await prisma.smtInterval.findMany({
                where: { esiid, ts: { gte: priorRange.gte, lt: priorRange.lt } },
                select: { ts: true, kwh: true },
                orderBy: { ts: "asc" },
              });
              for (const r of prior ?? []) {
                const kwh = decimalToNumber((r as any)?.kwh);
                const ts = (r as any)?.ts ? new Date((r as any).ts) : null;
                if (ts && kwh != null) priorRows.push({ ts, kwh });
              }
            }
          } else {
            const rawId = String(args.rawId ?? "");
            if (rawId) {
              const usageClient = usagePrisma as any;
              const cur = await usageClient.greenButtonInterval.findMany({
                where: { homeId: args.homeId, rawId, timestamp: { gte: currentRange.gte, lt: currentRange.lt } },
                select: { timestamp: true, consumptionKwh: true },
                orderBy: { timestamp: "asc" },
              });
              for (const r of cur ?? []) {
                const kwh = decimalToNumber((r as any)?.consumptionKwh);
                const ts = (r as any)?.timestamp ? new Date((r as any).timestamp) : null;
                if (ts && kwh != null) currentRows.push({ ts, kwh });
              }

              const prior = await usageClient.greenButtonInterval.findMany({
                where: { homeId: args.homeId, rawId, timestamp: { gte: priorRange.gte, lt: priorRange.lt } },
                select: { timestamp: true, consumptionKwh: true },
                orderBy: { timestamp: "asc" },
              });
              for (const r of prior ?? []) {
                const kwh = decimalToNumber((r as any)?.consumptionKwh);
                const ts = (r as any)?.timestamp ? new Date((r as any).timestamp) : null;
                if (ts && kwh != null) priorRows.push({ ts, kwh });
              }
            }
          }

          if (currentRows.length && priorRows.length) {
            const totals: Record<string, number> = {};
            for (const k of keysToLoad) totals[k] = 0;

            const applyIntervals = (
              rows: Array<{ ts: Date; kwh: number }>,
              onlyYearMonth: string,
              dayMin: number,
              dayMax: number,
            ) => {
              for (const r of rows) {
                const p = chicagoParts(r.ts);
                if (!p) continue;
                if (p.yearMonth !== onlyYearMonth) continue;
                if (p.day < dayMin || p.day > dayMax) continue;
                for (const def of bucketDefs) {
                  const rule = def.rule as BucketRuleV1;
                  if (
                    !evalRule(rule, {
                      month: p.month,
                      dayOfMonth: p.day,
                      weekdayIndex: p.weekdayIndex,
                      minutesOfDay: p.minutesOfDay,
                    })
                  )
                    continue;
                  totals[def.key] = (totals[def.key] ?? 0) + r.kwh;
                }
              }
            };

            applyIntervals(currentRows, stitchedMonth.yearMonth, 1, stitchedMonth.haveDaysThrough);
            applyIntervals(priorRows, stitchedMonth.borrowedFromYearMonth, stitchedMonth.missingDaysFrom, stitchedMonth.missingDaysTo);
            usageBucketsByMonth[stitchedMonth.yearMonth] = totals;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Annual kWh = sum of kwh.m.all.total over the months used for calc (stitched month included if built).
  let annualKwh: number | null = null;
  try {
    const sum = yearMonths
      .map((ym) => {
        const v = usageBucketsByMonth?.[ym]?.["kwh.m.all.total"];
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      })
      .reduce((a, b) => a + b, 0);
    if (sum > 0) annualKwh = Number.isFinite(sum) ? sum : null;
  } catch {
    annualKwh = null;
  }

  return { yearMonths, keysToLoad, usageBucketsByMonth, annualKwh, stitchedMonth };
}


