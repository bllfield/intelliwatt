import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || '';
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error('UNAUTHORIZED');
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const list = await prisma.ercotIngest.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return NextResponse.json({ ok: true, ingests: list });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'UNAUTHORIZED' ? 401 : 500 });
  }
}

