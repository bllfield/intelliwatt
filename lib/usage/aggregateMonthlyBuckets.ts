import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { CORE_MONTHLY_BUCKETS, normalizeTime, type DayType, type UsageBucketDef } from "@/lib/plan-engine/usageBuckets";

export type UsageIntervalSource = "SMT" | "GREENBUTTON";
export type BucketComputeSource = "SMT" | "GREENBUTTON" | "SIMULATED";

export type EnsureCoreMonthlyBucketsInput = {
  homeId: string;
  // Only required for SMT interval reads. Green Button buckets can be computed without ESIID.
  esiid?: string | null;
  rangeStart: Date;
  rangeEnd: Date;
  source: BucketComputeSource;
  intervalSource?: UsageIntervalSource;
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
    const weekday = get("weekday"); // Mon/Tue/.../Sat/Sun (en-US)
    const hour = get("hour");
    const minute = get("minute");
    return { year, month, weekday, hour, minute };
  };

  const weekdayToDayType = (w: string): DayType => {
    const s = String(w ?? "").trim().toLowerCase();
    if (s === "sat" || s === "sun") return "WEEKEND";
    return "WEEKDAY";
  };

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

  const bucketWindowMinutes = (b: UsageBucketDef) => {
    const startHHMM = normalizeTime(b.window.start);
    const endHHMM = normalizeTime(b.window.end);
    const startMin = hhmmToMinutes(startHHMM);
    const endMin = hhmmToMinutes(endHHMM);
    return { startMin, endMin };
  };

  const bucketMatches = (b: UsageBucketDef, localDayType: DayType, localMinute: number): boolean => {
    // DayType filtering is applied to the interval's local day-of-week.
    // Note: for overnight windows (e.g. 20:00-07:00), this means 01:00 Saturday is treated as WEEKEND.
    // If we later want “Friday night” semantics, we can shift overnight early-morning attribution.
    if (b.dayType !== "ALL" && b.dayType !== localDayType) return false;

    const { startMin, endMin } = bucketWindowMinutes(b);
    if (startMin === 0 && endMin === 24 * 60) return true; // full day

    if (endMin > startMin) {
      // Half-open interval: [start, end)
      return localMinute >= startMin && localMinute < endMin;
    }

    // Overnight: e.g. 20:00-07:00
    return localMinute >= startMin || localMinute < endMin;
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

  for (const row of intervals) {
    const kwh = decimalToNumber((row as any).kwh);
    if (!Number.isFinite(kwh) || kwh <= 0) continue;
    kwhSummed += kwh;

    const p = toChicagoParts(row.ts);
    const yearMonth = `${p.year}-${p.month}`;
    monthSet.add(yearMonth);

    const dayType: DayType = weekdayToDayType(p.weekday);
    const localMinute = Number(p.hour) * 60 + Number(p.minute);

    for (const b of CORE_MONTHLY_BUCKETS) {
      if (!bucketMatches(b, dayType, localMinute)) continue;
      const mk = `${yearMonth}|${b.key}`;
      sumByMonthBucket.set(mk, (sumByMonthBucket.get(mk) ?? 0) + kwh);
    }
  }

  const now = new Date();

  // Ensure bucket definitions exist (idempotent upsert by key).
  // (We store start/end as HHMM, matching canonical key format.)
  for (const b of CORE_MONTHLY_BUCKETS) {
    const startHHMM = normalizeTime(b.window.start);
    const endHHMM = normalizeTime(b.window.end);
    await (usagePrisma as any).usageBucketDefinition.upsert({
      where: { key: b.key },
      create: {
        key: b.key,
        label: b.label,
        dayType: b.dayType,
        season: (b as any).season ?? null,
        startHHMM,
        endHHMM,
        tz: tz,
      },
      update: {
        label: b.label,
        dayType: b.dayType,
        season: (b as any).season ?? null,
        startHHMM,
        endHHMM,
        tz: tz,
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
      "Buckets: CORE_MONTHLY_BUCKETS (9)",
      "Best-effort: skips non-finite/<=0 kWh intervals",
      "Overnight bucket dayType is evaluated on the interval's local day-of-week (no cross-midnight attribution yet)",
    ],
  };
}


