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
  // OhmConnect / SmartGridCIS (host varies by utility / plan; allow the base domain)
  'smartgridcis.net',
  'ohmconnect.com',

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
    const host = u.hostname.toLowerCase();
    const allowed = Array.from(DOC_HOST_ALLOWLIST).some((d) => {
      const domain = d.toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    });
    if (!allowed) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function looksLikeEflDocUrlLoose(u: string): boolean {
  const s = (u || '').toLowerCase();
  return (
    s.includes('electricity') && s.includes('facts') ||
    s.includes('facts') && s.includes('label') ||
    s.includes('efl') ||
    // SmartGridCIS/OhmConnect doc host uses a non-.pdf download endpoint.
    (s.includes('/documents/download.aspx') && s.includes('productdocumentid=')) ||
    s.endsWith('.pdf') ||
    s.includes('.pdf?')
  );
}

function deepFindBestDocUrl(
  root: unknown,
  opts: { kind: 'efl' | 'tos' | 'yrac' },
): string | null {
  const seen = new Set<unknown>();
  const candidates: Array<{ url: string; score: number }> = [];

  const scorePath = (path: string, url: string): number => {
    const p = path.toLowerCase();
    const u = url.toLowerCase();
    let score = 0;
    if (opts.kind === 'efl') {
      if (p.includes('efl')) score += 200;
      if (p.includes('electricity') && p.includes('facts')) score += 150;
      if (p.includes('facts') && p.includes('label')) score += 150;
      if (u.includes('/documents/download.aspx') && u.includes('productdocumentid=')) score += 120;
      if (u.includes('smartgridcis')) score += 40;
      if (u.includes('ohm')) score += 20;
    } else if (opts.kind === 'tos') {
      if (p.includes('tos') || p.includes('terms')) score += 200;
      if (u.includes('terms')) score += 80;
    } else if (opts.kind === 'yrac') {
      if (p.includes('yrac') || p.includes('rights')) score += 200;
      if (u.includes('rights')) score += 80;
    }
    if (u.endsWith('.pdf') || u.includes('.pdf?')) score += 50;
    return score;
  };

  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 10) return;
    if (node == null) return;
    if (typeof node === 'string') {
      const sanitized = sanitizeDocURL(node);
      if (sanitized && looksLikeEflDocUrlLoose(sanitized)) {
        candidates.push({ url: sanitized, score: scorePath(path, sanitized) });
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };

  walk(root, '', 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
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
  const rawDocs = o?.offer_data?.docs ?? o?.offer_data?.documents ?? o?.docs ?? null;
  const docsArray: any[] = Array.isArray(rawDocs) ? rawDocs : [];
  const docsObj: any =
    rawDocs && typeof rawDocs === 'object' && !Array.isArray(rawDocs) ? rawDocs : null;

  const findDocUrl = (needle: RegExp) => {
    for (const d of docsArray) {
      const label = String(d?.name ?? d?.label ?? d?.type ?? d?.title ?? '').toLowerCase();
      if (!label) continue;
      if (!needle.test(label)) continue;
      const url = d?.url ?? d?.href ?? d?.link ?? null;
      if (typeof url === 'string' && url) return url;
    }
    return null;
  };

  const docs = {
    // EFLs vary across suppliers: sometimes `offer_data.efl`, sometimes nested docs, sometimes an array.
    efl: sanitizeDocURL(
      o?.offer_data?.efl ??
        docsObj?.efl ??
        docsObj?.efl_url ??
        docsObj?.electricity_facts_label ??
        docsObj?.electricityFactsLabel ??
        docsObj?.ElectricityFactsLabel ??
        findDocUrl(/electricity\s*facts\s*label|efl/) ??
        null,
    ),
    tos: sanitizeDocURL(
      o?.offer_data?.tos ??
        docsObj?.tos ??
        docsObj?.terms_of_service ??
        docsObj?.termsOfService ??
        findDocUrl(/terms\s*of\s*service|tos/) ??
        null,
    ),
    yrac: sanitizeDocURL(
      o?.offer_data?.yrac ??
        docsObj?.yrac ??
        docsObj?.yrca ??
        docsObj?.your_rights_as_a_customer ??
        docsObj?.yourRightsAsACustomer ??
        findDocUrl(/your\s*rights|yrac|yra[cs]/) ??
        null,
    ),
  };

  // Fallback: some suppliers embed doc links in unexpected nested shapes (or in `links.*`),
  // and those links are not present in offer_data.docs. When the allowlist permits it,
  // do a deep scan for likely doc URLs so EFL parsing doesn't have to scrape WAF-protected
  // enrollment pages.
  if (!docs.efl) {
    const deepEfl = deepFindBestDocUrl(o, { kind: 'efl' });
    if (deepEfl) docs.efl = deepEfl;
  }
  if (!docs.tos) {
    const deepTos = deepFindBestDocUrl(o, { kind: 'tos' });
    if (deepTos) docs.tos = deepTos;
  }
  if (!docs.yrac) {
    const deepYrac = deepFindBestDocUrl(o, { kind: 'yrac' });
    if (deepYrac) docs.yrac = deepYrac;
  }

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
