// app/api/wattbuy/probe/route.ts
// Step 57: One-click diagnostics for WattBuy connectivity (ESI ➜ Info ➜ Offers ➜ Retail Rates)
// -------------------------------------------------------------------------------------------
// Why:
//  • Quickly verify your WATTBUY_API_KEY, address → ESIID lookup, utility info, offers,
//    and optional retail-rate DB without touching your PlanMaster matcher/UI.
//  • Useful for QA and support. Safe to call server-side only.
//
// How to use (GET):
//   /api/wattbuy/probe?esiid=10443720004529147
//   /api/wattbuy/probe?address=8808%20Las%20Vegas%20Ct&city=White%20Settlement&state=TX&zip=76108
// Optional:
//   &retail=true           // try retail-rates lookup using the detected TDSP EIA ID (if known)
//   &page=1                // retail-rates page
//
// Notes:
//  • This endpoint does NOT return enroll links by default (we redact them) to avoid accidental clicks in QA.
//  • No caching here—this is a deliberate live check. The rest of the app uses revalidate on fetch.

import { NextRequest, NextResponse } from 'next/server';
import {
  getESIByAddress,
  getUtilityInfo,
  getOffersForAddress,
  getOffersForESIID,
  getRetailRates,
  extractTdspSlug,
} from '@/lib/wattbuy/client';

type Addr = { line1: string; city: string; state: string; zip: string };

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const esiid = param(url, 'esiid');
    const retail = param(url, 'retail') === 'true';
    const page = num(url, 'page') ?? 1;

    const addr = toAddress(url);

    if (!esiid && !addr) {
      return NextResponse.json(
        { error: 'Provide either ?esiid=… or ?address=…&city=…&state=…&zip=…' },
        { status: 400 }
      );
    }

    // 1) Address → ESIID (if address was provided)
    let esiLookup: any = null;
    let resolvedEsiid = esiid || null;
    let tdspSlug: string | null = null;

    if (addr && !resolvedEsiid) {
      esiLookup = await getESIByAddress(addr);
      resolvedEsiid = esiLookup?.addresses?.[0]?.esiid || null;
      tdspSlug = extractTdspSlug(esiLookup);
    }

    // 2) Utility info (if address present)
    let utilInfo: any = null;
    if (addr) {
      utilInfo = await getUtilityInfo(addr);
      tdspSlug = tdspSlug || extractTdspSlug(utilInfo);
    }

    // 3) Offers (prefer ESIID when available)
    let offersResp: any = null;
    if (resolvedEsiid) {
      offersResp = await getOffersForESIID(resolvedEsiid);
      tdspSlug = tdspSlug || normalizeTdsp(offersResp?.offers?.[0]?.offer_data?.utility || null);
    } else if (addr) {
      offersResp = await getOffersForAddress(addr);
      tdspSlug = tdspSlug || normalizeTdsp(offersResp?.offers?.[0]?.offer_data?.utility || null);
    }

    // 4) Optional: Retail-rate DB (needs EIA utility id; we map common TX TDSPs)
    let retailResp: any = null;
    let eiaId: number | null = tdspToEia(tdspSlug);
    if (retail && eiaId) {
      retailResp = await getRetailRates({ utilityID: eiaId, state: 'tx', page });
    }

    // Redact enroll links in diagnostics to avoid accidental sign-ups in QA
    const offersRedacted = (offersResp?.offers ?? []).map((o: any) => ({
      offer_id: o.offer_id,
      offer_name: o.offer_name,
      supplier: o.offer_data?.supplier_name || o.offer_data?.supplier || null,
      tdsp: o.offer_data?.utility || null,
      term: o.offer_data?.term ?? null,
      kwh500: o.offer_data?.kwh500 ?? null,
      kwh1000: o.offer_data?.kwh1000 ?? null,
      kwh2000: o.offer_data?.kwh2000 ?? null,
      efl: o.offer_data?.efl ?? null,
      tos: o.offer_data?.tos ?? null,
      yrac: o.offer_data?.yrac ?? null,
      // link intentionally omitted
    }));

    return NextResponse.json(
      {
        ok: true,
        context: {
          input: {
            esiid: esiid || null,
            address: addr || null,
            retail,
            page,
          },
          resolved: {
            esiid: resolvedEsiid,
            tdsp: tdspSlug,
            eia_utility_id: eiaId,
          },
        },
        probes: {
          address_to_esiid: summarizeEsi(esiLookup),
          utility_info: summarizeUtil(utilInfo),
          offers_count: offersRedacted.length,
          first_offer: offersRedacted[0] || null,
          retail_rates_preview: retailResp ? summarizeRetail(retailResp) : null,
        },
        offers: offersRedacted,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

// ---------------- helpers ----------------

function param(u: URL, k: string): string | null {
  const v = u.searchParams.get(k);
  return v && v.trim() ? v.trim() : null;
}

function num(u: URL, k: string): number | null {
  const v = u.searchParams.get(k);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toAddress(u: URL): Addr | null {
  const line1 = param(u, 'address');
  const city = param(u, 'city');
  const state = param(u, 'state');
  const zip = param(u, 'zip');
  if (line1 && city && state && zip) {
    return { line1, city, state, zip };
  }
  return null;
}

function summarizeEsi(esi: any) {
  if (!esi) return null;
  const a = esi.addresses?.[0];
  return {
    exact_match: !!esi.exact_match,
    esiid: a?.esiid || null,
    tdsp: a?.utility || null,
    utility_name: a?.utility_name || a?.preferred_name || null,
    plans_available: !!a?.plans_available,
  };
}

function summarizeUtil(ui: any) {
  if (!ui) return null;
  const first = ui.utility_info?.[0];
  return {
    type: ui.type || null,
    esiid: ui.esiid || null,
    preferred_name: first?.preferred_name || null,
    utility_name: first?.name || null,
    tdsp_on_sitemap: !!first?.on_sitemap,
  };
}

function summarizeRetail(rr: any) {
  if (!rr) return null;
  const count = Array.isArray(rr.rates) ? rr.rates.length : 0;
  return {
    page: rr.page ?? null,
    page_count: rr.page_count ?? null,
    total_count: rr.total_count ?? null,
    sample: count ? rr.rates.slice(0, 2) : [],
  };
}

function normalizeTdsp(x: string | null): string | null {
  if (!x) return null;
  const s = x.toLowerCase();
  if (s.includes('oncor')) return 'oncor';
  if (s.includes('centerpoint') || s.includes('cnp')) return 'centerpoint';
  if (s.includes('tnmp')) return 'tnmp';
  if (s.includes('aep') && s.includes('north')) return 'aep_n';
  if (s.includes('aep') && (s.includes('central') || s.includes('south'))) return 'aep_c';
  return s.replace(/[^\w]+/g, '');
}

function tdspToEia(tdsp: string | null): number | null {
  if (!tdsp) return null;
  switch (tdsp) {
    case 'oncor':
      return 44372;
    case 'centerpoint':
      return 8901;
    case 'tnmp':
      return 40051;
    case 'aep_n':
      return 20404; // AEP North
    case 'aep_c':
      return 3278; // AEP Central
    default:
      return null;
  }
}
