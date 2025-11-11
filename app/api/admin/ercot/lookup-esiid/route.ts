import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { wbGetElectricity } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ESIID Lookup via WattBuy Electricity endpoint
 * 
 * Note: This endpoint now uses WattBuy's /v3/electricity endpoint to get ESIID,
 * not the ERCOT database. The ERCOT database lookup logic is preserved but not used.
 * 
 * The WattBuy electricity response may include ESIID in various field names:
 * - esiid
 * - esiId
 * - esi_id
 * - addresses[0].esi / addresses[0].esiid
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

    // Use WattBuy electricity endpoint to get ESIID
    const elec = await wbGetElectricity({ address, city, state, zip });
    
    if (!elec.ok) {
      return NextResponse.json({
        ok: false,
        error: 'WATTBUY_ELECTRICITY_FAILED',
        status: elec.status,
        message: 'Failed to fetch electricity details from WattBuy',
      }, { status: elec.status || 502 });
    }

    // Extract ESIID from various possible field names
    const data = elec.data || {};
    let esiid: string | null = null;
    
    // Try direct fields first
    esiid = data.esiid || data.esiId || data.esi_id || null;
    
    // Try addresses array
    if (!esiid && Array.isArray(data.addresses) && data.addresses.length > 0) {
      const addr = data.addresses[0];
      esiid = addr.esi || addr.esiid || addr.esi_id || null;
    }

    // Try utility_info array
    if (!esiid && Array.isArray(data.utility_info) && data.utility_info.length > 0) {
      const ui = data.utility_info[0];
      esiid = ui.esiid || ui.esiId || ui.esi_id || null;
    }

    return NextResponse.json({
      ok: true,
      match: !!esiid,
      esiid: esiid,
      utility: data.utility || data.utility_name || null,
      tdsp: data.tdsp || data.territory || null,
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

