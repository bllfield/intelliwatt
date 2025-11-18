import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { wbGetElectricityInfo } from '@/lib/wattbuy/client';
import { extractEsiidDetails } from '@/lib/wattbuy/extractEsiid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ESIID Lookup via WattBuy Electricity Info endpoint
 * 
 * Note: This endpoint uses WattBuy's /v3/electricity/info endpoint to get ESIID,
 * not the ERCOT database. The ERCOT database lookup logic is preserved but not used.
 * 
 * The WattBuy electricity/info response may include ESIID in various field names:
 * - esiid
 * - esiId
 * - esi_id
 * - addresses[0].esi / addresses[0].esiid
 * - utility_info[].esiid
 */
export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const address = req.nextUrl.searchParams.get('line1') || req.nextUrl.searchParams.get('address') || '';
    const city = req.nextUrl.searchParams.get('city') || '';
    const state = req.nextUrl.searchParams.get('state') || 'tx';
    const zip = req.nextUrl.searchParams.get('zip') || '';

    if (!address || !state || !zip) {
      return NextResponse.json({ ok: false, error: 'REQUIRED: line1/address, state, zip' }, { status: 400 });
    }

    // Use WattBuy electricity/info endpoint to get ESIID
    const info = await wbGetElectricityInfo({ address, city, state, zip, utility_list: 'true' });
    
    if (!info.ok) {
      return NextResponse.json({
        ok: false,
        error: 'WATTBUY_ELECTRICITY_INFO_FAILED',
        status: info.status,
        message: 'Failed to fetch electricity/info from WattBuy',
      }, { status: info.status || 502 });
    }

    const data = info.data || {};
    const { esiid, utility, territory } = extractEsiidDetails(data);

    return NextResponse.json({
      ok: true,
      match: !!esiid,
      esiid: esiid,
      utility,
      tdsp: territory,
      wattkey: data.wattkey || null,
      source: 'wattbuy_electricity',
      // Include sample keys for debugging
      sampleKeys: Object.keys(data).slice(0, 20),
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: 'LOOKUP_ERROR', message: msg }, { status: 500 });
  }
}

