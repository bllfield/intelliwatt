export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { wbGet } from '@/lib/wattbuy/client';
import { retailRatesParams } from '@/lib/wattbuy/params';

type DiagnosticResult = {
  utilityID: string;
  utilityName: string;
  state: string;
  status: number;
  hasData: boolean;
  count?: number;
  error?: string;
};

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'sweep-tx';

  if (mode === 'sweep-tx') {
    // Sweep all TX TDSPs
    const txTdsps: Array<{ utilityID: string; utilityName: string }> = [
      { utilityID: '44372', utilityName: 'Oncor' },
      { utilityID: '8901', utilityName: 'CenterPoint' },
      { utilityID: '40051', utilityName: 'Texas New Mexico Power' },
      { utilityID: '20404', utilityName: 'AEP North' },
      { utilityID: '3278', utilityName: 'AEP Central' },
      { utilityID: '3278', utilityName: 'City of Lubbock' }, // Same utilityID, different context
    ];

    const results: DiagnosticResult[] = [];

    for (const tdsp of txTdsps) {
      // Try lowercase state
      try {
        const params = retailRatesParams({ utilityID: tdsp.utilityID, state: 'tx' });
        const res = await wbGet('electricity/retail-rates', params, undefined, 1);
        results.push({
          utilityID: tdsp.utilityID,
          utilityName: tdsp.utilityName,
          state: 'tx',
          status: res.status,
          hasData: res.ok && res.status === 200 && res.data !== null,
          count: Array.isArray(res.data) ? res.data.length : (res.data?.data?.length ?? 0),
        });
      } catch (err: any) {
        results.push({
          utilityID: tdsp.utilityID,
          utilityName: tdsp.utilityName,
          state: 'tx',
          status: 0,
          hasData: false,
          error: err?.message || 'Unknown error',
        });
      }

      // Try uppercase state
      try {
        const params = retailRatesParams({ utilityID: tdsp.utilityID, state: 'TX' });
        const res = await wbGet('electricity/retail-rates', params, undefined, 1);
        results.push({
          utilityID: tdsp.utilityID,
          utilityName: tdsp.utilityName,
          state: 'TX',
          status: res.status,
          hasData: res.ok && res.status === 200 && res.data !== null,
          count: Array.isArray(res.data) ? res.data.length : (res.data?.data?.length ?? 0),
        });
      } catch (err: any) {
        results.push({
          utilityID: tdsp.utilityID,
          utilityName: tdsp.utilityName,
          state: 'TX',
          status: 0,
          hasData: false,
          error: err?.message || 'Unknown error',
        });
      }
    }

    return Response.json({
      ok: true,
      mode: 'sweep-tx',
      results,
      summary: {
        total: results.length,
        withData: results.filter(r => r.hasData).length,
        status204: results.filter(r => r.status === 204).length,
        status200: results.filter(r => r.status === 200).length,
      },
    });
  }

  if (mode === 'test-offers') {
    // Probe /v3/electricity/offers endpoint
    const address = searchParams.get('address') || '9514 Santa Paula Dr';
    const city = searchParams.get('city') || 'Fort Worth';
    const state = (searchParams.get('state') || 'tx').toLowerCase();
    const zip = searchParams.get('zip') || '76116';

    try {
      // Test offers endpoint (read-only) - using 'offers' path (deprecated but still works)
      const offersRes = await wbGet('offers', {
        address,
        city,
        state,
        zip,
      }, undefined, 1);

      return Response.json({
        ok: true,
        mode: 'test-offers',
        endpoint: '/v3/offers',
        status: offersRes.status,
        hasData: offersRes.ok && offersRes.status === 200 && offersRes.data !== null,
        dataType: Array.isArray(offersRes.data) ? 'array' : typeof offersRes.data,
        dataLength: Array.isArray(offersRes.data) ? offersRes.data.length : (offersRes.data ? 1 : 0),
        headers: offersRes.headers,
        note: 'If offers return but retail-rates don\'t, your account may be enabled for offers but not the retail-rate database.',
      });
    } catch (err: any) {
      return Response.json({
        ok: false,
        mode: 'test-offers',
        error: err?.message || 'Unknown error',
      }, { status: 500 });
    }
  }

  if (mode === 'test-state') {
    // Test a specific utilityID + state combination
    const utilityID = searchParams.get('utilityID');
    const state = searchParams.get('state') || 'tx';

    if (!utilityID) {
      return Response.json({
        ok: false,
        error: 'utilityID required for test-state mode',
      }, { status: 400 });
    }

    try {
      const params = retailRatesParams({ utilityID, state });
      const res = await wbGet('electricity/retail-rates', params, undefined, 1);

      return Response.json({
        ok: true,
        mode: 'test-state',
        utilityID,
        state,
        status: res.status,
        hasData: res.ok && res.status === 200 && res.data !== null,
        dataType: Array.isArray(res.data) ? 'array' : typeof res.data,
        dataLength: Array.isArray(res.data) ? res.data.length : (res.data?.data?.length ?? 0),
        headers: res.headers,
        pagination: {
          count: res.data?.count,
          next: res.data?.next,
        },
      });
    } catch (err: any) {
      return Response.json({
        ok: false,
        mode: 'test-state',
        error: err?.message || 'Unknown error',
      }, { status: 500 });
    }
  }

  return Response.json({
    ok: false,
    error: 'Invalid mode. Use: sweep-tx, test-offers, or test-state',
    availableModes: ['sweep-tx', 'test-offers', 'test-state'],
  }, { status: 400 });
}

