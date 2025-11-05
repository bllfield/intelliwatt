// app/api/admin/debug/db-info/route.ts

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

import { requireAdmin } from '@/lib/auth/admin';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    // Show which DB the API is actually connected to, and whether the table exists
    const meta = await prisma.$queryRaw<any[]>`
      SELECT
        current_database() AS db,
        current_schemas(true) AS schemas,
        current_user AS user
    `;

    const table = await prisma.$queryRaw<any[]>`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename = 'raw_smt_files'
    `;

    // DO NOT return full DATABASE_URL; just a hint to verify target
    const dbHint = {
      db: meta?.[0]?.db ?? null,
      user: meta?.[0]?.user ?? null,
      schemas: meta?.[0]?.schemas ?? null,
      table_exists: !!(table && table.length),
    };

    return NextResponse.json({ ok: true, dbHint });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'DB_CHECK', details: String(e) }, { status: 500 });
  }
}

