/**
 * Orchestrator: Electricity details → SMT kick (using ESIID if available) → Offers (all=true)
 * GET /api/admin/wattbuy/property-bundle?address=...&city=...&state=tx&zip=...
 * Optional: &is_renter=true|false &language=en|es
 */
import { NextRequest, NextResponse } from 'next/server';
import { wbGetElectricity, extractElectricityKeys, wbGetOffers } from '@/lib/wattbuy/client';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function kickSmtIfPossible(elec: any) {
  try {
    // Try to find ESIID from electricity details (field name varies by account).
    // Check direct fields first
    let esiid = elec?.esiid ?? elec?.esiId ?? elec?.esi_id ?? undefined;
    
    // Try addresses array
    if (!esiid && Array.isArray(elec?.addresses) && elec.addresses.length > 0) {
      const addr = elec.addresses[0];
      esiid = addr.esi || addr.esiid || addr.esi_id || undefined;
    }
    
    // Try utility_info array
    if (!esiid && Array.isArray(elec?.utility_info) && elec.utility_info.length > 0) {
      const ui = elec.utility_info[0];
      esiid = ui.esiid || ui.esiId || ui.esi_id || undefined;
    }
    
    if (!esiid) return { kicked: false, reason: 'NO_ESIID_IN_RESPONSE' };
    
    // Use the SMT pull endpoint
    const SMT_BASE = process.env.PROD_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';
    if (!SMT_BASE) return { kicked: false, reason: 'NO_PROD_BASE_URL' };
    const url = `${SMT_BASE}/api/admin/smt/pull`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'x-admin-token': process.env.ADMIN_TOKEN || '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ esiid }),
    });
    const data = await r.json().catch(() => ({}));
    return { kicked: true, status: r.status, response: data };
  } catch (err: any) {
    return { kicked: false, reason: 'SMT_KICK_ERROR', error: err?.message };
  }
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address') ?? '';
    const city = searchParams.get('city') ?? '';
    const state = searchParams.get('state') ?? 'tx';
    const zip = searchParams.get('zip') ?? '';
    const language = (searchParams.get('language') as 'en' | 'es') ?? 'en';
    const is_renter = (searchParams.get('is_renter') ?? 'false') === 'true';

    // 1) Electricity details → wattkey (+ maybe ESIID)
    const elec = await wbGetElectricity({ address, city, state, zip });
    if (!elec.ok) {
      return NextResponse.json({ ok: false, stage: 'electricity', elec }, { status: elec.status || 502 });
    }
    const keys = extractElectricityKeys(elec.data);

    // 2) SMT kick (best-effort)
    const smtKick = await kickSmtIfPossible(elec.data);

    // 3) Offers (prefer wattkey; fall back to address if missing)
    const offers = await wbGetOffers(
      keys.wattkey
        ? { wattkey: keys.wattkey, language, is_renter, all: true }
        : { address, city, state, zip, language, is_renter, all: true }
    );

    return NextResponse.json({
      ok: true,
      where: { address, city, state, zip },
      electricity: { status: elec.status, headers: elec.headers, sampleKeys: Object.keys(elec.data ?? {}) },
      smtKick,
      offers: { status: offers.status, headers: offers.headers, topKeys: offers.data ? Object.keys(offers.data) : null, data: offers.data },
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'PROPERTY_BUNDLE_ERROR', message: err?.message }, { status: 500 });
  }
}

