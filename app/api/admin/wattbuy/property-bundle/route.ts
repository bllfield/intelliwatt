/**
 * Orchestrator: Electricity details → SMT kick (using ESIID if available) → Offers (all=true)
 * GET /api/admin/wattbuy/property-bundle?address=...&city=...&state=tx&zip=...
 * Optional: &is_renter=true|false &language=en|es
 */
import { NextRequest, NextResponse } from 'next/server';
import { wbGetElectricity, wbGetElectricityInfo, extractElectricityKeys, wbGetOffers } from '@/lib/wattbuy/client';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Extract ESIID from WattBuy electricity response
 * Handles multiple field name variations and nested structures
 */
function extractEsiidFromElectricity(elec: any): string | null {
  if (!elec || typeof elec !== 'object') return null;
  
  // Direct fields (case-insensitive check)
  const directFields = ['esiid', 'esiId', 'esi_id', 'ESIID', 'ESI_ID', 'esi'];
  for (const field of directFields) {
    if (elec[field] && typeof elec[field] === 'string' && elec[field].trim()) {
      return elec[field].trim();
    }
  }
  
  // Try addresses array
  if (Array.isArray(elec.addresses) && elec.addresses.length > 0) {
    for (const addr of elec.addresses) {
      if (addr && typeof addr === 'object') {
        for (const field of directFields) {
          if (addr[field] && typeof addr[field] === 'string' && addr[field].trim()) {
            return addr[field].trim();
          }
        }
      }
    }
  }
  
  // Try utility_info array
  if (Array.isArray(elec.utility_info) && elec.utility_info.length > 0) {
    for (const ui of elec.utility_info) {
      if (ui && typeof ui === 'object') {
        for (const field of directFields) {
          if (ui[field] && typeof ui[field] === 'string' && ui[field].trim()) {
            return ui[field].trim();
          }
        }
      }
    }
  }
  
  // Try nested objects (common patterns)
  if (elec.address && typeof elec.address === 'object') {
    for (const field of directFields) {
      if (elec.address[field] && typeof elec.address[field] === 'string' && elec.address[field].trim()) {
        return elec.address[field].trim();
      }
    }
  }
  
  if (elec.utility && typeof elec.utility === 'object') {
    for (const field of directFields) {
      if (elec.utility[field] && typeof elec.utility[field] === 'string' && elec.utility[field].trim()) {
        return elec.utility[field].trim();
      }
    }
  }
  
  // Deep search in all string values that look like ESIIDs (17-18 digits)
  const esiidPattern = /\b\d{17,18}\b/;
  const searchObj = (obj: any, depth = 0): string | null => {
    if (depth > 3) return null; // Limit recursion
    if (typeof obj === 'string' && esiidPattern.test(obj)) {
      const match = obj.match(esiidPattern);
      if (match) return match[0];
    }
    if (obj && typeof obj === 'object') {
      for (const value of Object.values(obj)) {
        const found = searchObj(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  
  return searchObj(elec);
}

async function kickSmtIfPossible(address: string, city: string, state: string, zip: string) {
  try {
    // Get ESIID from /v3/electricity/info endpoint (not /v3/electricity)
    const infoRes = await wbGetElectricityInfo({ address, city, state, zip, utility_list: 'true' });

    const infoSummary = infoRes?.data
      ? {
          status: infoRes.status,
          headers: infoRes.headers,
          sampleKeys: Object.keys(infoRes.data ?? {}).slice(0, 20),
          data: infoRes.data,
        }
      : undefined;

    if (!infoRes.ok || !infoRes.data) {
      return {
        kicked: false,
        reason: 'ELECTRICITY_INFO_FAILED',
        status: infoRes.status,
        error: 'Failed to fetch electricity/info for ESIID extraction',
        info: infoSummary,
      };
    }

    // Extract ESIID from electricity/info response
    const info = infoRes.data;
    const esiid = extractEsiidFromElectricity(info);

    if (!esiid) {
      // Return diagnostic info to help debug
      return {
        kicked: false,
        reason: 'NO_ESIID_IN_RESPONSE',
        diagnostic: {
          hasData: !!info,
          topLevelKeys: info && typeof info === 'object' ? Object.keys(info).slice(0, 20) : [],
          sampleStructure: info ? JSON.stringify(info).slice(0, 500) : null,
        },
        info: infoSummary,
      };
    }

    // Use the SMT pull endpoint
    const SMT_BASE = process.env.PROD_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '';
    if (!SMT_BASE) return { kicked: false, reason: 'NO_PROD_BASE_URL', esiid, info: infoSummary };

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
    return {
      kicked: true,
      status: r.status,
      esiid, // Include ESIID in response for verification
      response: data,
      info: infoSummary,
    };
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

    // 1) Electricity details → wattkey (for offers)
    const elec = await wbGetElectricity({ address, city, state, zip });
    if (!elec.ok) {
      return NextResponse.json({ ok: false, stage: 'electricity', elec }, { status: elec.status || 502 });
    }
    const keys = extractElectricityKeys(elec.data);

    // 2) SMT kick (best-effort) - uses /v3/electricity/info for ESIID extraction
    const smtKick = await kickSmtIfPossible(address, city, state, zip);

    // 3) Offers (prefer wattkey; fall back to address if missing)
    const offers = await wbGetOffers(
      keys.wattkey
        ? { wattkey: keys.wattkey, language, is_renter, all: true }
        : { address, city, state, zip, language, is_renter, all: true }
    );

    return NextResponse.json({
      ok: true,
      where: { address, city, state, zip },
      electricity: {
        status: elec.status,
        headers: elec.headers,
        sampleKeys: Object.keys(elec.data ?? {}),
        data: elec.data, // Full electricity data (for wattkey)
      },
      electricityInfo: smtKick.info ?? null,
      smtKick,
      offers: { status: offers.status, headers: offers.headers, topKeys: offers.data ? Object.keys(offers.data) : null, data: offers.data },
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'PROPERTY_BUNDLE_ERROR', message: err?.message }, { status: 500 });
  }
}

