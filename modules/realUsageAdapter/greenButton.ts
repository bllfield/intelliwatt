import { Prisma } from "@prisma/client";
import { usagePrisma } from "@/lib/db/usageClient";

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

function parseYearMonth(ym: string): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

function utcRangeWithChicagoBuffer(months: string[]): { start: Date; endExclusive: Date } {
  const first = parseYearMonth(months[0] ?? "");
  const last = parseYearMonth(months[months.length - 1] ?? "");
  if (!first || !last) {
    const now = new Date();
    return { start: new Date(now.getTime() - 370 * DAY_MS), endExclusive: new Date(now.getTime() + DAY_MS) };
  }

  // Buffer ensures we cover the full Chicago-local window even across DST boundaries.
  const start = new Date(Date.UTC(first.year, first.month1 - 1, 1, 0, 0, 0, 0) - DAY_MS);
  const endExclusive = new Date(Date.UTC(last.year, last.month1, 1, 0, 0, 0, 0) + 2 * DAY_MS);
  return { start, endExclusive };
}

function chicagoYearMonthFromBucket(bucket: Date): string {
  return bucket.toISOString().slice(0, 7);
}

async function latestRawGreenButtonIdForHouse(houseId: string): Promise<string | null> {
  if (!USAGE_DB_ENABLED) return null;
  try {
    const usageClient = usagePrisma as any;
    const latestRaw = await usageClient.rawGreenButton.findFirst({
      where: { homeId: houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return latestRaw?.id ? String(latestRaw.id) : null;
  } catch {
    return null;
  }
}

export async function getLatestGreenButtonIntervalTimestamp(args: { houseId: string }): Promise<Date | null> {
  if (!USAGE_DB_ENABLED) return null;
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return null;
  try {
    const usageClient = usagePrisma as any;
    const latest = await usageClient.greenButtonInterval.findFirst({
      where: { homeId: args.houseId, rawId },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    return latest?.timestamp ?? null;
  } catch {
    return null;
  }
}

export async function hasGreenButtonIntervals(args: { houseId: string; canonicalMonths: string[] }): Promise<boolean> {
  if (!USAGE_DB_ENABLED) return false;
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return false;
  if (!args.canonicalMonths.length) return false;
  const { start, endExclusive } = utcRangeWithChicagoBuffer(args.canonicalMonths);

  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS c
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${start}
        AND "timestamp" < ${endExclusive}
      LIMIT 1
    `)) as Array<{ c: number }>;
    return (Number(rows?.[0]?.c ?? 0) || 0) > 0;
  } catch {
    return false;
  }
}

export async function fetchGreenButtonCanonicalMonthlyTotals(args: { houseId: string; canonicalMonths: string[] }) {
  if (!USAGE_DB_ENABLED) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  if (!args.canonicalMonths.length) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };

  const { start, endExclusive } = utcRangeWithChicagoBuffer(args.canonicalMonths);
  const monthSet = new Set(args.canonicalMonths);

  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        date_trunc('month', ("timestamp" AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket,
        COALESCE(SUM("consumptionKwh"), 0)::float AS kwh,
        COUNT(*)::int AS intervalscount
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${start}
        AND "timestamp" < ${endExclusive}
      GROUP BY bucket
      ORDER BY bucket ASC
    `)) as Array<{ bucket: Date; kwh: number; intervalscount: number }>;

    const monthlyKwhByMonth: Record<string, number> = {};
    let intervalsCount = 0;
    for (const r of rows) {
      const ym = chicagoYearMonthFromBucket(r.bucket);
      if (!monthSet.has(ym)) continue;
      monthlyKwhByMonth[ym] = Number(r.kwh) || 0;
      intervalsCount += Number(r.intervalscount) || 0;
    }

    return { intervalsCount, monthlyKwhByMonth };
  } catch {
    return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  }
}

export async function fetchGreenButtonIntradayShape96(args: { houseId: string; canonicalMonths: string[] }): Promise<number[] | null> {
  if (!USAGE_DB_ENABLED) return null;
  const rawId = await latestRawGreenButtonIdForHouse(args.houseId);
  if (!rawId) return null;
  if (!args.canonicalMonths.length) return null;

  const { start, endExclusive } = utcRangeWithChicagoBuffer(args.canonicalMonths);
  try {
    const usageClient = usagePrisma as any;
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        (EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago'))::int * 4 + FLOOR(EXTRACT(MINUTE FROM ("timestamp" AT TIME ZONE 'America/Chicago'))::int / 15))::int AS bucket,
        COALESCE(SUM("consumptionKwh"), 0)::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${start}
        AND "timestamp" < ${endExclusive}
      GROUP BY bucket
      ORDER BY bucket ASC
    `)) as Array<{ bucket: number; kwh: number }>;

    const vec = Array.from({ length: 96 }, () => 0);
    let total = 0;
    for (const r of rows) {
      const b = Number(r.bucket);
      if (!Number.isFinite(b) || b < 0 || b >= 96) continue;
      const kwh = Number(r.kwh) || 0;
      vec[b] += kwh;
      total += kwh;
    }
    if (total <= 0) return null;
    return vec.map((x) => x / total);
  } catch {
    return null;
  }
}

