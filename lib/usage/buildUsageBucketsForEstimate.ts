import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import type { BucketRuleV1, OvernightAttribution } from "@/lib/plan-engine/usageBuckets";
import { bucketDefsFromBucketKeys, canonicalizeMonthlyBucketKey } from "@/lib/plan-engine/usageBuckets";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysInMonth(year: number, month1: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return 31;
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
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

      const addRows = (rows: any[]) => {
        for (const r of rows ?? []) {
          const key = canonicalizeMonthlyBucketKey(String((r as any)?.bucketKey ?? "").trim());
          const kwh = decimalToNumber((r as any)?.kwhTotal);
          if (!key || kwh == null) continue;
          byBucket[key] = (byBucket[key] ?? 0) + kwh;
        }
      };
      addRows(curRows);
      addRows(priorRows);

      // If we got any daily rows, apply stitched totals.
      const hasAny = Object.values(byBucket).some((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
      if (hasAny) {
        usageBucketsByMonth[ym] = byBucket;
      } else if (stitchMode === "DAILY_ONLY") {
        // do nothing (keep monthly buckets as-is)
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


