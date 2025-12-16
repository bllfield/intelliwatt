// lib/wattbuy/normalize.ts
// Step 60: Normalize WattBuy offers into a stable internal shape (+ doc link sanitizer)
// ------------------------------------------------------------------------------------
// Why:
//  • Your matcher, PlanMaster, and UI need a consistent shape regardless of supplier quirks.
//  • Centralizes parsing of term, kWh "tiers", green/fixed flags, cancellation fee, TDSP, docs.
//  • Sanitizes document links to allow-list of supplier domains.
//
// Exposes:
//  • type OfferNormalized
//  • normalizeOffer(raw)
//  • normalizeOffers(rawResp)  // { offers: OfferNormalized[], tdsp: string | null }
//  • sanitizeDocURL(url)
//
// Usage note: Offers are requested by address/zip + optional TDSP context; ESIID is intentionally unused. See docs/WATTBUY_COMPLIANCE_UPDATE.md.

import { extractTdspSlug } from './client';

export type OfferNormalized = {
  offer_id: string;
  plan_name: string;
  supplier_slug: string | null;
  supplier_name: string | null;
  tdsp: string | null;                    // normalized: oncor | centerpoint | tnmp | aep_n | aep_c | null
  term_months: number | null;            // 1, 6, 12, 24, 36…
  rate_type: 'fixed' | 'variable' | 'renewable' | 'unknown';
  green_percentage: number | null;       // 0..100 if present
  kwh500_cents: number | null;           // advertised EFL cents/kWh at 500
  kwh1000_cents: number | null;          // advertised EFL cents/kWh at 1000
  kwh2000_cents: number | null;          // advertised EFL cents/kWh at 2000
  cancel_fee_text: string | null;        // raw text like "$150" or "$15/month remaining"
  docs: {
    efl: string | null;
    tos: string | null;
    yrac: string | null;
  };
  enroll_link: string | null;            // only use in customer-facing flows, not in probe
  // Compliance fields
  supplier_puct_registration?: string | null;
  supplier_contact_email?: string | null;
  supplier_contact_phone?: string | null;
  distributor_name?: string | null;
  raw: any;                              // keep original for debugging
};

const DOC_HOST_ALLOWLIST = new Set<string>([
  // Generic
  'docs.google.com',
  's3.amazonaws.com',
  'wattbuy.com',
  // WattBuy partner doc hosts (seen in enrollment-form "Electricity Facts Label" links)
  'ohm-gridlink.smartgridcis.net',

  // Chariot
  'signup.chariotenergy.com',
  'mychariotenergy.com',

  // Gexa
  'eflviewer.gexaenergy.com',
  'gexaenergy.com',

  // Frontier
  'eflviewer.frontierutilities.com',
  'frontierutilities.com',

  // Champion
  'docs.championenergyservices.com',
  'championenergyservices.com',

  // Payless
  'paylesspower.com',
]);

export function sanitizeDocURL(url: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!DOC_HOST_ALLOWLIST.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function toNum(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function toCentsMaybe(n: any): number | null {
  const v = toNum(n);
  return v === null ? null : v;
}

function rateTypeFrom(o: any): OfferNormalized['rate_type'] {
  const t = (o?.offer_data?.rate_type || '').toString().toLowerCase();
  if (t === 'fixed') return 'fixed';
  if (t === 'variable') return 'variable';
  if (t === 'renewable') return 'renewable';
  // fallback via flags
  if (o?.offer_data?.is_green) return 'renewable';
  if (o?.offer_data?.is_variable) return 'variable';
  if (o?.offer_data?.is_fixed) return 'fixed';
  return 'unknown';
}

function supplierSlug(o: any): string | null {
  const s = (o?.offer_data?.supplier || o?.offer_data?.supplier_name || '').toString().toLowerCase().trim();
  if (!s) return null;
  return s.replace(/[^\w]+/g, '-');
}

export function normalizeOffer(o: any): OfferNormalized {
  const docs = {
    efl: sanitizeDocURL(o?.offer_data?.efl ?? null),
    tos: sanitizeDocURL(o?.offer_data?.tos ?? null),
    yrac: sanitizeDocURL(o?.offer_data?.yrac ?? null),
  };

  return {
    offer_id: String(o?.offer_id ?? ''),
    plan_name: String(o?.offer_name ?? o?.offer_data?.name_id ?? 'Unknown plan'),
    supplier_slug: supplierSlug(o),
    supplier_name: o?.offer_data?.supplier_name ?? o?.offer_data?.supplier ?? null,
    tdsp: normalizeTdsp(o?.offer_data?.utility ?? null),
    term_months: toNum(o?.offer_data?.term),
    rate_type: rateTypeFrom(o),
    green_percentage: toNum(o?.offer_data?.green_percentage),
    kwh500_cents: toCentsMaybe(o?.offer_data?.kwh500),
    kwh1000_cents: toCentsMaybe(o?.offer_data?.kwh1000),
    kwh2000_cents: toCentsMaybe(o?.offer_data?.kwh2000),
    cancel_fee_text: o?.offer_data?.cancel_notes ?? null,
    docs,
    enroll_link: typeof o?.link === 'string' ? o.link : null,
    // Extract compliance fields from API response
    supplier_puct_registration: o?.offer_data?.supplier_registration_number ?? 
                                 o?.offer_data?.puct_registration_number ?? 
                                 o?.offer_data?.puct_registration ?? null,
    supplier_contact_email: o?.offer_data?.supplier_contact_email ?? 
                            o?.offer_data?.contact_email ?? null,
    supplier_contact_phone: o?.offer_data?.supplier_contact_phone ?? 
                            o?.offer_data?.contact_phone ?? 
                            o?.offer_data?.phone ?? null,
    distributor_name: o?.offer_data?.utility_name ?? 
                      o?.offer_data?.distributor_name ?? 
                      o?.offer_data?.utility ?? null,
    raw: o,
  };
}

export function normalizeOffers(rawResp: any): { offers: OfferNormalized[]; tdsp: string | null } {
  // Some WattBuy responses include non-electricity "offers" (e.g., Optiwatt, Qmerit, etc.).
  // Only electricity plans have EFL/TOS/YRAC docs and should enter our EFL pipeline.
  const offersRaw = Array.isArray(rawResp?.offers) ? rawResp.offers : [];
  const offers = offersRaw
    .filter((o: any) => {
      const cat = (o?.offer_category ?? '').toString();
      return !cat || cat === 'electricity_plans';
    })
    .map(normalizeOffer);
  const tdsp =
    normalizeTdsp(rawResp?.offers?.[0]?.offer_data?.utility ?? null) ||
    extractTdspSlug(rawResp);
  return { offers, tdsp };
}

function normalizeTdsp(x: any): string | null {
  if (!x) return null;
  const s = String(x).toLowerCase();
  if (s.includes('oncor')) return 'oncor';
  if (s.includes('centerpoint') || s.includes('cnp')) return 'centerpoint';
  if (s.includes('tnmp')) return 'tnmp';
  if (s.includes('aep') && s.includes('north')) return 'aep_n';
  if (s.includes('aep') && (s.includes('central') || s.includes('south'))) return 'aep_c';
  return s.replace(/[^\w]+/g, '');
}
