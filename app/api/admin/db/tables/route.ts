// app/api/admin/db/tables/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';

// Whitelist of safe, read-only tables to expose in the admin DB Explorer.
const TABLE_WHITELIST = [
  'HouseAddress',
  'ErcotIngest',
  // 'ErcotEsiidIndex', // Removed: ESIID lookup now uses WattBuy, not ERCOT database
  'RatePlan',
  'RawSmtFile',
  'SmtInterval',
  'NormalizedCurrentPlan'
] as const;

type Whitelisted = typeof TABLE_WHITELIST[number];

export async function GET(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  // Fetch counts safely
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; row_count: bigint }>>`
      SELECT c.relname as table_name, c.reltuples::bigint as row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY(${TABLE_WHITELIST})
      ORDER BY c.relname ASC
    `;

    // For each table, also pull a small snapshot of columns (names + types)
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string }>>`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name = ANY(${TABLE_WHITELIST})
      ORDER BY table_name, ordinal_position
    `;

    const byTable: Record<string, { count: number; columns: Array<{ name: string; type: string }> }> = {};

    for (const t of TABLE_WHITELIST) byTable[t] = { count: 0, columns: [] };

    for (const r of rows) {
      if (byTable[r.table_name]) byTable[r.table_name].count = Number(r.row_count);
    }

    for (const c of columns) {
      if (byTable[c.table_name]) byTable[c.table_name].columns.push({ name: c.column_name, type: c.data_type });
    }

    return NextResponse.json({
      ok: true,
      tables: TABLE_WHITELIST.map((t) => ({
        name: t,
        count: byTable[t].count,
        columns: byTable[t].columns
      }))
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'DATABASE', detail: String(err?.message || err) }, { status: 500 });
  }
}
