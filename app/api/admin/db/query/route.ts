// app/api/admin/db/query/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';

const TABLE_WHITELIST = new Set([
  'HouseAddress',
  'ErcotIngest',
  // 'ErcotEsiidIndex', // Removed: ESIID lookup now uses WattBuy, not ERCOT database
  'RatePlan',
  'RawSmtFile',
  'SmtInterval',
  'SmtBillingRead'
]);

// Modest cap to keep responses efficient on Vercel functions
const HARD_LIMIT = 500;

export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  const { table, offset = 0, limit = 50, orderBy, orderDir = 'desc', q, csv = false } = body || {};

  const tableName = typeof table === 'string' ? table.trim() : '';

  if (!tableName || !TABLE_WHITELIST.has(tableName)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INVALID_TABLE',
        detail: { tableName }
      },
      { status: 400 }
    );
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, HARD_LIMIT));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const dir = String(orderDir).toLowerCase() === 'asc' ? 'asc' : 'desc';

  try {
    // Get column names & types for this table
    const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${tableName}
      ORDER BY ordinal_position
    `;

    const colNames = columns.map((c) => c.column_name);
    const orderCol = (orderBy && colNames.includes(orderBy)) ? orderBy : colNames[0] || 'id';

    // Optional basic search: apply ILIKE to text-ish columns
    const textCols = columns
      .filter(c => ['text', 'character varying', 'character', 'json', 'jsonb'].includes(c.data_type))
      .map(c => c.column_name);

    let results: any[] = [];

    if (q && textCols.length > 0) {
      // Build OR of ILIKE on text columns (parameterized)
      const ilike = `%${q}%`;
      const where = textCols.map((c) => `"${c}"::text ILIKE $1`).join(' OR ');
      
      const sql = `
        SELECT *
        FROM "${tableName}"
        WHERE ${where}
        ORDER BY "${orderCol}" ${dir.toUpperCase()}
        OFFSET ${safeOffset}
        LIMIT ${safeLimit}
      `;
      
      // Use $queryRawUnsafe with escaped parameter
      const escapedQ = ilike.replace(/'/g, "''");
      results = await prisma.$queryRawUnsafe(sql.replace(/\$1/g, `'${escapedQ}'`));
    } else {
      const sql = `
        SELECT *
        FROM "${tableName}"
        ORDER BY "${orderCol}" ${dir.toUpperCase()}
        OFFSET ${safeOffset}
        LIMIT ${safeLimit}
      `;
      results = await prisma.$queryRawUnsafe(sql);
    }

    if (csv) {
      // CSV export
      const headers = colNames;
      const lines = [headers.join(',')].concat(
        results.map(r =>
          headers.map(h => {
            let v = r[h];
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') v = JSON.stringify(v);
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          }).join(',')
        )
      );
      const blob = lines.join('\n');
      return new NextResponse(blob, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${tableName}.csv"`
        }
      });
    }

    return NextResponse.json({ ok: true, columns: colNames, rows: results });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'DATABASE', detail: String(err?.message || err) }, { status: 500 });
  }
}
