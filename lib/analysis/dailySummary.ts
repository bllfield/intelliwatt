// lib/analysis/dailySummary.ts
import { prisma } from '@/lib/db';
import { assertNodeRuntime } from '@/lib/node/_guard';
import { DateTime } from 'luxon';

assertNodeRuntime();

export type DailySummaryRow = {
  esiid: string | null;
  meter: string | null;
  date: string; // YYYY-MM-DD (local day)
  totalSlots: number; // expected slots for this day (92/96/100)
  realCount: number; // intervals with filled=false
  filledCount: number; // intervals with filled=true
  completeness: number; // actualCount / totalSlots (0-1)
  kWh_real: number; // sum of kwh where filled=false
  kWh_filled: number; // sum of kwh where filled=true (usually 0)
  kWh_total: number; // sum of all kwh
  has_missing: boolean; // true if actualCount < totalSlots
};

// If your column names differ, update just these constants.
const TABLE = '"SmtInterval"';
const COL_ESIID = 'esiid';
const COL_METER = 'meter';
const COL_TSUTC = 'ts';
const COL_KWH = 'kwh';
const COL_FILLED = 'filled';

function buildFilters(params: { esiid?: string; meter?: string }) {
  const clauses: string[] = [];
  const values: any[] = [];
  if (params.esiid) {
    clauses.push(`${COL_ESIID} = $${values.length + 1}`);
    values.push(params.esiid);
  }
  if (params.meter) {
    clauses.push(`${COL_METER} = $${values.length + 1}`);
    values.push(params.meter);
  }
  return { whereSql: clauses.length ? 'AND ' + clauses.join(' AND ') : '', values };
}

/**
 * DST-aware daily completeness (America/Chicago by default, supports other zones).
 * Uses raw SQL for performance on large datasets.
 */
export async function getDailySummary(opts: {
  esiid?: string;
  meter?: string;
  dateStart: string;
  dateEnd: string;
  tz?: string; // default: America/Chicago
}): Promise<DailySummaryRow[]> {
  const { dateStart, dateEnd, esiid, meter } = opts;
  const tz = opts.tz || 'America/Chicago';

  // Convert local date range to UTC window for the WHERE clause
  const startLocal = DateTime.fromISO(dateStart, { zone: tz }).startOf('day');
  const endLocal = DateTime.fromISO(dateEnd, { zone: tz }).endOf('day');
  if (!startLocal.isValid || !endLocal.isValid) {
    throw new Error(`Invalid date range: ${dateStart} to ${dateEnd}`);
  }

  const fromUTC = startLocal.toUTC().toISO();
  const toUTC = endLocal.toUTC().toISO();

  const { whereSql, values } = buildFilters({ esiid, meter });
  // Parameters: [fromUTC, toUTC, ...filterValues, tz]
  const paramCount = 2 + values.length;
  const tzParamNum = paramCount + 1;
  const params = [fromUTC, toUTC, ...values, tz];

  // Build parameterized SQL with correct parameter numbers
  // Use string concatenation to insert the parameter number
  const sql = `
    WITH base AS (
      SELECT
        ${COL_ESIID} AS esiid,
        ${COL_METER} AS meter,
        (${COL_TSUTC} AT TIME ZONE 'UTC' AT TIME ZONE $` + tzParamNum + `::text)::date AS local_date,
        CASE WHEN ${COL_FILLED} THEN 1 ELSE 0 END AS filled_flag,
        CASE WHEN ${COL_FILLED} THEN 0 ELSE 1 END AS real_flag,
        COALESCE(${COL_KWH},0)::numeric AS kwh,
        ${COL_FILLED} AS is_filled
      FROM ${TABLE}
      WHERE ${COL_TSUTC} >= $1::timestamp
        AND ${COL_TSUTC} <  $2::timestamp
        ${whereSql}
    ),
    agg AS (
      SELECT
        esiid, meter, local_date,
        SUM(real_flag)::int   AS realCount,
        SUM(filled_flag)::int AS filledCount,
        SUM(CASE WHEN is_filled THEN 0 ELSE kwh END)::numeric AS kWh_real,
        SUM(CASE WHEN is_filled THEN kwh ELSE 0 END)::numeric AS kWh_filled
      FROM base
      GROUP BY 1,2,3
    ),
    slots AS (
      SELECT
        a.esiid, a.meter, a.local_date,
        (EXTRACT(EPOCH FROM (
          ((a.local_date + INTERVAL '1 day')::timestamp AT TIME ZONE $` + tzParamNum + `::text)
           - (a.local_date::timestamp AT TIME ZONE $` + tzParamNum + `::text)
        )) / 900.0)::int AS totalSlots
      FROM agg a
    )
    SELECT
      a.esiid,
      a.meter,
      a.local_date AS date,
      s.totalSlots,
      a.realCount,
      a.filledCount,
      LEAST(1.0, GREATEST(0.0, (a.realCount + a.filledCount)::numeric / NULLIF(s.totalSlots,0)))::float AS completeness,
      ROUND(a.kWh_real, 6)   AS "kWh_real",
      ROUND(a.kWh_filled, 6) AS "kWh_filled",
      ROUND(a.kWh_real + a.kWh_filled, 6) AS "kWh_total",
      ((a.realCount + a.filledCount) < s.totalSlots) AS has_missing
    FROM agg a
    JOIN slots s USING (esiid, meter, local_date)
    ORDER BY a.esiid, a.meter, a.local_date;
  `;

  const finalParams = params;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...finalParams);

  return rows.map((r) => ({
    esiid: r.esiid ?? null,
    meter: r.meter ?? null,
    date: r.date,
    totalSlots: Number(r.totalSlots ?? 0),
    realCount: Number(r.realCount ?? 0),
    filledCount: Number(r.filledCount ?? 0),
    completeness: Number(r.completeness ?? 0),
    kWh_real: Number(r.kWh_real ?? 0),
    kWh_filled: Number(r.kWh_filled ?? 0),
    kWh_total: Number(r.kWh_total ?? 0),
    has_missing: Boolean(r.has_missing),
  }));
}

/**
 * Wrapper for backward compatibility - computes default date range if not provided.
 */
export async function computeDailySummaries(opts: {
  esiid?: string;
  meter?: string;
  dateStart?: string;
  dateEnd?: string;
  tz?: string;
}): Promise<DailySummaryRow[]> {
  const tz = opts.tz || 'America/Chicago';
  const now = DateTime.now().setZone(tz);
  const dateStart = opts.dateStart || now.minus({ days: 7 }).toISODate() || '';
  const dateEnd = opts.dateEnd || now.toISODate() || '';

  return getDailySummary({ ...opts, dateStart, dateEnd, tz });
}
