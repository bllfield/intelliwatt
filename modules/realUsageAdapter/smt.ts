import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SMT_SHAPE_DERIVATION_VERSION = "v1";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const iso = bucket.toISOString();
  return iso.slice(0, 7);
}

export async function hasSmtIntervals(args: { esiid: string; canonicalMonths: string[] }): Promise<boolean> {
  const { esiid, canonicalMonths } = args;
  if (!esiid) return false;
  if (!canonicalMonths.length) return false;
  const { start, endExclusive } = utcRangeWithChicagoBuffer(canonicalMonths);

  const rows = await prisma.$queryRaw<Array<{ c: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS c
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${start}
      AND "ts" < ${endExclusive}
    LIMIT 1
  `);
  return (Number(rows?.[0]?.c ?? 0) || 0) > 0;
}

function excludeDateKeysFragment(excludeDateKeys: string[] | undefined): Prisma.Sql {
  if (!excludeDateKeys?.length) return Prisma.sql``;
  return Prisma.sql` AND to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::timestamp, 'YYYY-MM-DD') NOT IN (${Prisma.join(excludeDateKeys.map((d) => Prisma.sql`${d}`), ", ")})`;
}

export async function fetchSmtCanonicalMonthlyTotals(args: {
  esiid: string;
  canonicalMonths: string[];
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}) {
  const { esiid, canonicalMonths, excludeDateKeys, travelRanges } = args;
  const travelKeys = travelRanges?.length ? travelRangesToExcludeDateKeys(travelRanges) : [];
  const mergedExclude = [...(excludeDateKeys ?? []), ...travelKeys];
  const exclude = mergedExclude.length ? mergedExclude : excludeDateKeys;
  if (!esiid) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };
  if (!canonicalMonths.length) return { intervalsCount: 0, monthlyKwhByMonth: {} as Record<string, number> };

  const { start, endExclusive } = utcRangeWithChicagoBuffer(canonicalMonths);
  const excludeFrag = excludeDateKeysFragment(exclude);

  const rows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number; intervalscount: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${start}
        AND "ts" < ${endExclusive}
        ${excludeFrag}
      GROUP BY "ts"
    )
    SELECT
      date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket,
      COALESCE(SUM("kwh"), 0)::float AS kwh,
      COUNT(*)::int AS intervalscount
    FROM iv
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  const monthSet = new Set(canonicalMonths);
  const monthlyKwhByMonth: Record<string, number> = {};
  let intervalsCount = 0;
  for (const r of rows) {
    const ym = chicagoYearMonthFromBucket(r.bucket);
    if (!monthSet.has(ym)) continue;
    const kwh = Number(r.kwh) || 0;
    monthlyKwhByMonth[ym] = kwh;
    intervalsCount += Number(r.intervalscount) || 0;
  }

  return { intervalsCount, monthlyKwhByMonth };
}

function travelRangesToExcludeDateKeys(ranges: Array<{ startDate: string; endDate: string }> | undefined): string[] {
  if (!ranges?.length) return [];
  const set = new Set<string>();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  for (const r of ranges) {
    if (!re.test(String(r.startDate).trim()) || !re.test(String(r.endDate).trim())) continue;
    const start = new Date(String(r.startDate).trim() + "T12:00:00.000Z");
    const end = new Date(String(r.endDate).trim() + "T12:00:00.000Z");
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      set.add(d.toISOString().slice(0, 10));
    }
  }
  return Array.from(set);
}

export async function fetchSmtIntradayShape96(args: {
  esiid: string;
  canonicalMonths: string[];
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<number[] | null> {
  const { esiid, canonicalMonths, excludeDateKeys, travelRanges } = args;
  const travelKeys = travelRanges?.length ? travelRangesToExcludeDateKeys(travelRanges) : [];
  const mergedExclude = [...(excludeDateKeys ?? []), ...travelKeys];
  const exclude = mergedExclude.length ? mergedExclude : undefined;
  if (!esiid) return null;
  if (!canonicalMonths.length) return null;

  const { start, endExclusive } = utcRangeWithChicagoBuffer(canonicalMonths);
  const excludeFrag = excludeDateKeysFragment(exclude);

  const rows = await prisma.$queryRaw<Array<{ bucket: number; kwh: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${start}
        AND "ts" < ${endExclusive}
        ${excludeFrag}
      GROUP BY "ts"
    ),
    local AS (
      SELECT
        (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago') AS lt,
        "kwh" AS kwh
      FROM iv
    )
    SELECT
      (EXTRACT(HOUR FROM lt)::int * 4 + FLOOR(EXTRACT(MINUTE FROM lt)::int / 15))::int AS bucket,
      COALESCE(SUM(kwh), 0)::float AS kwh
    FROM local
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

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
}

