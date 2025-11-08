export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { retailRatesParams, electricityParams } from '@/lib/wattbuy/params';

export async function POST(req: NextRequest) {
  // Authenticate YOUR cron/admin only (do not forward upstream)

  const adminToken = req.headers.get('x-admin-token');

  const cronSecret = req.headers.get('x-cron-secret');

  const vercelCron = req.headers.get('x-vercel-cron');

  if (!(adminToken === process.env.ADMIN_TOKEN || cronSecret === process.env.CRON_SECRET || vercelCron)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const targets = [{ zip: '75201', state: 'tx' }];

  const results = [];

  for (const t of targets) {
    const rrParams = retailRatesParams({ utilityID: (t as any).utilityID, state: t.state });

    const rr = await wbGet('electricity/retail-rates', rrParams);

    if (!rr.ok) {
      results.push({ where: rrParams, ok: false, status: rr.status, error: rr.text });

      continue;
    }

    const elecParams = electricityParams({ address: (t as any).address, city: (t as any).city, state: t.state, zip: t.zip });

    const meta = await wbGet('electricity', elecParams);

    // TODO: persist RAW → transform → upsert

    results.push({
      where: rrParams,
      ok: true,
      retailRatesCount: Array.isArray(rr.data) ? rr.data.length : undefined,
      metaOk: meta.ok,
    });
  }

  return Response.json({ ok: true, results });
}

