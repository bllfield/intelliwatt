export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { runErcotIngest } from '@/lib/ercot/ingest';

function checkAuth(req: NextRequest) {
  const header = req.headers.get('x-cron-secret') || '';
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  const want = process.env.CRON_SECRET || '';
  return want && (header === want || token === want);
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized (cron)' }), { status: 401 });
  }

  const result = await runErcotIngest();

  const status = result.ok ? 200 : 502;
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

