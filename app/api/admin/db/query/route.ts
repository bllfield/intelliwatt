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
  'SmtBillingRead',
  'NormalizedCurrentPlan'
]);

// Modest cap to keep responses efficient on Vercel functions
const HARD_LIMIT = 500;

function stringifyBigInts<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') {
    return (value.toString() as unknown) as T;
  }
  if (Array.isArray(value)) {
    return (value.map((v) => stringifyBigInts(v)) as unknown) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stringifyBigInts(v);
    }
    return (out as unknown) as T;
  }
  return value;
}

export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  const { sql, offset = 0, limit = 50, orderBy, orderDir = 'desc', q, csv = false } = body || {};

  const sqlText = typeof sql === 'string' ? sql.trim() : '';
  if (!sqlText) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_QUERY', detail: { reason: 'SQL string missing or empty' } },
      { status: 400 },
    );
  }

  if (!/^\s*select\b/i.test(sqlText)) {
    return NextResponse.json({ ok: false, error: 'ONLY_SELECT_ALLOWED' }, { status: 400 });
  }

  const fromMatch = sqlText.match(/from\s+(?:(?:"?public"?)\.)?\s*"?([A-Za-z0-9_]+)"?/i);
  const tableName = fromMatch?.[1] ?? '';

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

    const safeResults = stringifyBigInts(results);

    if (csv) {
      // CSV export
      const headers = colNames;
      const lines = [headers.join(',')].concat(
        safeResults.map(r =>
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

    return NextResponse.json({ ok: true, columns: colNames, rows: safeResults });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'DATABASE', detail: String(err?.message || err) }, { status: 500 });
  }
}
