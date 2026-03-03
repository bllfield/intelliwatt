/**
 * Ground-truth raw monthly usage from SmtInterval (Chicago month).
 * Use this to verify what a given month's usage "really" is when debugging
 * mismatches between Usage, Simulated Usage, and Past views.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RawMonthResult = {
  yearMonth: string;
  importKwh: number;
  exportKwh: number;
  netKwh: number;
  intervalCount: number;
};

/**
 * Returns raw usage for a single month from SmtInterval, grouped by Chicago timezone.
 * This is the canonical source for "what was usage in month YYYY-MM" before any
 * stitching or bucket logic.
 */
export async function getRawMonthKwhFromSmt(params: {
  esiid: string;
  yearMonth: string;
}): Promise<RawMonthResult | null> {
  const ym = String(params.yearMonth ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;

  const esiid = String(params.esiid ?? "").trim();
  if (!esiid) return null;

  const monthStart = `${ym}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const rows = await prisma.$queryRaw<
    Array<{
      month: string;
      importkwh: number;
      exportkwh: number;
      netkwh: number;
      cnt: string;
    }>
  >(Prisma.sql`
    SELECT
      to_char(
        date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::date,
        'YYYY-MM'
      ) AS month,
      COALESCE(SUM(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END), 0)::float AS importkwh,
      COALESCE(SUM(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END), 0)::float AS exportkwh,
      COALESCE(SUM("kwh"), 0)::float AS netkwh,
      COUNT(*)::text AS cnt
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date >= (${monthStart})::date
      AND (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date < (${nextMonth})::date
    GROUP BY 1
  `);

  const r = rows[0];
  if (!r) return null;
  return {
    yearMonth: String(r.month),
    importKwh: Number(r.importkwh) || 0,
    exportKwh: Number(r.exportkwh) || 0,
    netKwh: Number(r.netkwh) || 0,
    intervalCount: parseInt(String(r.cnt), 10) || 0,
  };
}
