import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import {
  CORE_MONTHLY_BUCKETS,
  canonicalizeMonthlyBucketKey,
  bucketRuleFromParsedKey,
  parseMonthlyBucketKey,
  type BucketRuleV1,
  type DayType,
  type OvernightAttribution,
  type UsageBucketDef,
} from "@/lib/plan-engine/usageBuckets";

export type UsageIntervalSource = "SMT" | "GREENBUTTON";
export type BucketComputeSource = "SMT" | "GREENBUTTON" | "SIMULATED";

export class BucketKeyParseError extends Error {
  readonly key: string;
  constructor(key: string, message?: string) {
    super(message ?? `Unparseable monthly bucket key: ${key}`);
    this.name = "BucketKeyParseError";
    this.key = key;
  }
}

function hhmmToLabel(hhmm: string): string {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) return s;
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

export async function ensureBucketsExist(args: {
  bucketKeys: string[];
  tz?: string; // default "America/Chicago"
}): Promise<{ ensured: string[]; created: string[]; skipped: string[] }> {
  const tz = typeof args?.tz === "string" && args.tz.trim() ? args.tz.trim() : "America/Chicago";
  const inKeys = Array.isArray(args?.bucketKeys) ? args.bucketKeys : [];
  const uniq = Array.from(new Set(inKeys.map((k) => String(k ?? "").trim()).filter(Boolean)));

  const ensured: string[] = [];
  const created: string[] = [];
  const skipped: string[] = [];

  for (const key of uniq) {
    const parsed = parseMonthlyBucketKey(key);
    if (!parsed) throw new BucketKeyParseError(key);
    if (parsed.tz !== "America/Chicago" || tz !== "America/Chicago") {
      // For now we only support America/Chicago in the stored rule format + evaluator.
      skipped.push(key);
      continue;
    }

    const rule = bucketRuleFromParsedKey(parsed);
    const dayType: DayType = rule.dayType ?? "ALL";
    const startHHMM = String(rule.window?.startHHMM ?? "").trim();
    const endHHMM = String(rule.window?.endHHMM ?? "").trim();
    const overnightAttribution: OvernightAttribution = rule.overnightAttribution ?? "ACTUAL_DAY";

    const label = parsed.isTotal
      ? `Monthly kWh (${dayType}, 00:00-24:00)`
      : `Monthly kWh (${dayType}, ${hhmmToLabel(startHHMM)}-${hhmmToLabel(endHHMM)})`;

    // Best-effort: idempotent upsert by key (registry only, no totals computed here).
    await (usagePrisma as any).usageBucketDefinition.upsert({
      where: { key },
      create: {
        key,
        label,
        dayType,
        season: null,
        startHHMM,
        endHHMM,
        tz,
        overnightAttribution,
        ruleJson: rule,
      },
      update: {
        label,
        dayType,
        season: null,
        startHHMM,
        endHHMM,
        tz,
        overnightAttribution,
        ruleJson: rule,
      },
    });

    ensured.push(key);
  }

  return { ensured, created, skipped };
}

export type EnsureCoreMonthlyBucketsInput = {
  homeId: string;
  // Only required for SMT interval reads. Green Button buckets can be computed without ESIID.
  esiid?: string | null;
  rangeStart: Date;
  rangeEnd: Date;
  source: BucketComputeSource;
  intervalSource?: UsageIntervalSource;
  bucketDefs?: UsageBucketDef[];
};

export type EnsureCoreMonthlyBucketsResult = {
  monthsProcessed: number;
  rowsUpserted: number;
  intervalRowsRead: number;
  kwhSummed: number;
  notes: string[];
};

export type AggregateMonthlyBucketsInput = { homeId: string; esiid: string; rangeStart: Date; rangeEnd: Date };

export async function aggregateMonthlyBuckets(
  input: AggregateMonthlyBucketsInput,
): Promise<{ monthsProcessed: number; rowsUpserted: number; notes: string[] }> {
  // Back-compat wrapper for older scripts/callers (SMT-only).
  const res = await ensureCoreMonthlyBuckets({
    homeId: input?.homeId,
    esiid: input?.esiid,
    rangeStart: input?.rangeStart,
    rangeEnd: input?.rangeEnd,
    source: "SMT",
    intervalSource: "SMT",
  });

  return { monthsProcessed: res.monthsProcessed, rowsUpserted: res.rowsUpserted, notes: res.notes };
}

export async function ensureCoreMonthlyBuckets(
  input: EnsureCoreMonthlyBucketsInput,
): Promise<EnsureCoreMonthlyBucketsResult> {
  const notes: string[] = [];

  if (!input?.homeId) {
    return { monthsProcessed: 0, rowsUpserted: 0, intervalRowsRead: 0, kwhSummed: 0, notes: ["missing_homeId"] };
  }
  if (!(input.rangeStart instanceof Date) || Number.isNaN(input.rangeStart.getTime())) {
    return { monthsProcessed: 0, rowsUpserted: 0, intervalRowsRead: 0, kwhSummed: 0, notes: ["invalid_rangeStart"] };
  }
  if (!(input.rangeEnd instanceof Date) || Number.isNaN(input.rangeEnd.getTime())) {
    return { monthsProcessed: 0, rowsUpserted: 0, intervalRowsRead: 0, kwhSummed: 0, notes: ["invalid_rangeEnd"] };
  }
  if (input.rangeEnd.getTime() <= input.rangeStart.getTime()) {
    return { monthsProcessed: 0, rowsUpserted: 0, intervalRowsRead: 0, kwhSummed: 0, notes: ["rangeEnd_must_be_gt_rangeStart"] };
  }

  const intervalSource: UsageIntervalSource = input.intervalSource ?? "SMT";
  if (intervalSource === "SMT" && !input.esiid) {
    return {
      monthsProcessed: 0,
      rowsUpserted: 0,
      intervalRowsRead: 0,
      kwhSummed: 0,
      notes: ["missing_esiid_for_smt_interval_read"],
    };
  }

  const tz = "America/Chicago";
  notes.push(`TZ=${tz}`);
  notes.push(`intervalSource=${intervalSource}`);
  notes.push(`source=${input.source}`);

  const bucketDefsRaw = Array.isArray(input.bucketDefs) && input.bucketDefs.length > 0 ? input.bucketDefs : CORE_MONTHLY_BUCKETS;
  const bucketDefs = (() => {
    // Canonicalize keys for storage going forward (do not rewrite old rows; loader aliases legacy reads).
    // Also avoid double-counting if multiple defs canonicalize to the same key.
    const out: UsageBucketDef[] = [];
    const seen = new Set<string>();
    let deduped = 0;

    for (const b of bucketDefsRaw) {
      const canonicalKey = canonicalizeMonthlyBucketKey(b?.key);
      if (!canonicalKey) continue;
      if (seen.has(canonicalKey)) {
        deduped++;
        continue;
      }
      seen.add(canonicalKey);
      out.push({ ...b, key: canonicalKey });
    }

    if (deduped > 0) notes.push(`bucketDefs_deduped_after_key_canonicalization=${deduped}`);
    return out;
  })();

  // Cache the formatter (Intl construction is relatively expensive).
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const toChicagoParts = (d: Date) => {
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const weekday = get("weekday"); // Mon/Tue/.../Sat/Sun (en-US)
    const hour = get("hour");
    const minute = get("minute");
    return { year, month, day, weekday, hour, minute };
  };

  const weekdayShortToIndex = (w: string): number | null => {
    const s = String(w ?? "").trim().toLowerCase();
    if (s === "sun") return 0;
    if (s === "mon") return 1;
    if (s === "tue") return 2;
    if (s === "wed") return 3;
    if (s === "thu") return 4;
    if (s === "fri") return 5;
    if (s === "sat") return 6;
    return null;
  };

  const isWeekendByIndex = (idx: number): boolean => idx === 0 || idx === 6;

  const hhmmToMinutes = (hhmm: string): number => {
    const s = String(hhmm ?? "").trim();
    if (!/^\d{4}$/.test(s)) throw new Error(`Invalid HHMM: ${s}`);
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(2, 4));
    if (hh === 24 && mm === 0) return 24 * 60;
    if (!Number.isInteger(hh) || hh < 0 || hh > 23) throw new Error(`Invalid hour in HHMM: ${s}`);
    if (!Number.isInteger(mm) || mm < 0 || mm > 59) throw new Error(`Invalid minute in HHMM: ${s}`);
    return hh * 60 + mm;
  };

  const evalRule = (
    rule: BucketRuleV1,
    local: { month: number; dayOfMonth: number; weekdayIndex: number; minutesOfDay: number },
  ): boolean => {
    if (!rule || rule.v !== 1) return false;
    if (rule.tz !== "America/Chicago") return false;

    const startHHMM = String(rule.window?.startHHMM ?? "").trim();
    const endHHMM = String(rule.window?.endHHMM ?? "").trim();
    const startMin = hhmmToMinutes(startHHMM);
    const endMin = hhmmToMinutes(endHHMM);
    if (startMin === endMin) return false;

    const overnight = startMin > endMin;
    const t = local.minutesOfDay;
    const inWindow = overnight ? t >= startMin || t < endMin : t >= startMin && t < endMin;
    if (!inWindow) return false;

    // Overnight attribution affects only day filters (not month/yearMonth attribution in this step).
    const attribution: OvernightAttribution = rule.overnightAttribution ?? "ACTUAL_DAY";
    const usePrevDayForFilter = overnight && attribution === "START_DAY" && t < endMin;
    const weekdayIndex = usePrevDayForFilter ? (local.weekdayIndex + 6) % 7 : local.weekdayIndex;
    const isWeekend = isWeekendByIndex(weekdayIndex);

    if (Array.isArray(rule.months) && rule.months.length > 0) {
      // Month filtering should match the same attribution semantics as day filtering.
      // If START_DAY is active for early-morning overnight hours, treat 01:00 on Jan 1 as "previous day" for filters,
      // which implies month=Dec for the months[] check (without changing yearMonth aggregation in this step).
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
  };

  const decimalToNumber = (v: any): number => {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && typeof v.toString === "function") return Number(v.toString());
    return Number(v);
  };

  const intervals: Array<{ ts: Date; kwh: any }> =
    intervalSource === "GREENBUTTON"
      ? await (usagePrisma as any).greenButtonInterval.findMany({
          where: { homeId: input.homeId, timestamp: { gte: input.rangeStart, lte: input.rangeEnd } },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true, consumptionKwh: true },
        }).then((rows: Array<{ timestamp: Date; consumptionKwh: any }>) =>
          rows.map((r) => ({ ts: r.timestamp, kwh: r.consumptionKwh })),
        )
      : await prisma.smtInterval.findMany({
          where: { esiid: input.esiid!, ts: { gte: input.rangeStart, lte: input.rangeEnd } },
          orderBy: { ts: "asc" },
          select: { ts: true, kwh: true },
        });

  const monthSet = new Set<string>();
  const sumByMonthBucket = new Map<string, number>(); // key = `${yearMonth}|${bucketKey}`
  let kwhSummed = 0;
  let sawStartDay = false;

  for (const row of intervals) {
    const kwh = decimalToNumber((row as any).kwh);
    if (!Number.isFinite(kwh) || kwh <= 0) continue;
    kwhSummed += kwh;

    const p = toChicagoParts(row.ts);
    const yearMonth = `${p.year}-${p.month}`;
    monthSet.add(yearMonth);

    const weekdayIndex = weekdayShortToIndex(p.weekday);
    if (weekdayIndex == null) continue;
    const localMinute = Number(p.hour) * 60 + Number(p.minute);
    const localMonth = Number(p.month);
    if (!Number.isFinite(localMonth) || localMonth < 1 || localMonth > 12) continue;
    const localDayOfMonth = Number(p.day);
    if (!Number.isFinite(localDayOfMonth) || localDayOfMonth < 1 || localDayOfMonth > 31) continue;

    for (const b of bucketDefs) {
      const rule = b?.rule as BucketRuleV1;
      if (rule?.overnightAttribution === "START_DAY") sawStartDay = true;
      if (!evalRule(rule, { month: localMonth, dayOfMonth: localDayOfMonth, weekdayIndex, minutesOfDay: localMinute })) continue;
      const mk = `${yearMonth}|${b.key}`;
      sumByMonthBucket.set(mk, (sumByMonthBucket.get(mk) ?? 0) + kwh);
    }
  }

  const now = new Date();

  // Ensure bucket definitions exist (idempotent upsert by key).
  // (We store start/end as HHMM, matching canonical key format.)
  for (const b of bucketDefs) {
    const rule = b.rule as BucketRuleV1;
    const dayType: DayType = rule.dayType ?? "ALL";
    const startHHMM = String(rule.window?.startHHMM ?? "").trim();
    const endHHMM = String(rule.window?.endHHMM ?? "").trim();
    const overnightAttribution: OvernightAttribution = rule.overnightAttribution ?? "ACTUAL_DAY";
    await (usagePrisma as any).usageBucketDefinition.upsert({
      where: { key: b.key },
      create: {
        key: b.key,
        label: b.label,
        dayType,
        season: null,
        startHHMM,
        endHHMM,
        tz: tz,
        overnightAttribution,
        ruleJson: rule,
      },
      update: {
        label: b.label,
        dayType,
        season: null,
        startHHMM,
        endHHMM,
        tz: tz,
        overnightAttribution,
        ruleJson: rule,
        updatedAt: now,
      },
    });
  }

  // Upsert monthly totals (bounded: months * buckets).
  let rowsUpserted = 0;
  const entries = Array.from(sumByMonthBucket.entries());

  // Chunk transactions to keep request sizes sane.
  const chunkSize = 50;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    await (usagePrisma as any).$transaction(
      chunk.map(([mk, total]) => {
        const [yearMonth, bucketKey] = mk.split("|");
        const kwhTotal = Number(total.toFixed(6)).toFixed(6); // string is safest for Decimal
        return (usagePrisma as any).homeMonthlyUsageBucket.upsert({
          where: {
            homeId_yearMonth_bucketKey: {
              homeId: input.homeId,
              yearMonth,
              bucketKey,
            },
          },
          create: {
            homeId: input.homeId,
            yearMonth,
            bucketKey,
            kwhTotal,
            source: input.source,
            computedAt: now,
          },
          update: {
            kwhTotal,
            source: input.source,
            computedAt: now,
          },
        });
      }),
    );
    rowsUpserted += chunk.length;
  }

  return {
    monthsProcessed: monthSet.size,
    rowsUpserted,
    intervalRowsRead: intervals.length,
    kwhSummed: Number.isFinite(kwhSummed) ? Number(kwhSummed.toFixed(6)) : 0,
    notes: [
      ...notes,
      `Buckets: ${bucketDefsRaw === CORE_MONTHLY_BUCKETS ? "CORE_MONTHLY_BUCKETS" : "custom"} (raw=${bucketDefsRaw.length}, canonical=${bucketDefs.length})`,
      "Best-effort: skips non-finite/<=0 kWh intervals",
      sawStartDay
        ? "Overnight bucket dayType attribution: post-midnight intervals count toward previous local dayType"
        : "Overnight attribution: ACTUAL_DAY (default)",
    ],
  };
}


