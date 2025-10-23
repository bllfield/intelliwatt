// lib/rates/key.ts
// Step 32: Stable key derivation for matching WattBuy offers → local RateConfig files
// - getRateKeyParts(offer) extracts normalized supplier, tdsp, and plan identifier
// - deriveRateKey(offer) returns `${supplier}:${tdsp}:${planIdOrName}`
// This MUST stay perfectly in sync with the filenames you place under /data/rates/**.
//
// Example:
//   offer.offer_data = {
//     supplier: "gexa", supplier_name: "Gexa Energy", plan_id: "159872",
//     utility: "oncor", utility_name: "Oncor", name_id: "gexa-eco-saver-plus-8", term: 8
//   }
//   → key: "gexa:oncor:159872"
//
// If there is no numeric plan_id, we fall back to a filename-safe slug of name_id or offer_name.

import { tdspToSlug } from '@/lib/wattbuy/client';

export type RateKeyParts = {
  supplierSlug: string | null;
  tdspSlug: string | null;
  planIdent: string | null; // plan_id (preferred) or planName slug
  debug: Record<string, any>;
};

export function getRateKeyParts(offer: any): RateKeyParts {
  const od = offer?.offer_data || {};

  // ---- supplier
  const supplierRaw =
    od.supplier ||
    od.supplier_slug ||
    od.supplier_name ||
    offer?.supplier ||
    offer?.supplier_name ||
    guessSupplierFromName(offer?.offer_name || '');

  const supplierSlug = normalizeSupplierSlug(supplierRaw);

  // ---- tdsp / utility
  const tdspRaw =
    od.utility ||
    od.utility_name ||
    od.market_type ||
    offer?.tdsp ||
    guessTdspFromName(offer?.offer_name || '');

  const tdspSlug = normalizeTdspSlug(tdspRaw);

  // ---- plan id / name
  const planId =
    od.plan_id != null
      ? String(od.plan_id)
      : // some REPs embed internal plan_name or rate_id — include as secondary keys for debugging
        null;

  const nameCandidate =
    od.name_id || od.plan_name || offer?.offer_name || (typeof offer?.offer_id === 'string' ? offer.offer_id : null);
  const planNameSlug = nameCandidate ? safeSlug(nameCandidate) : null;

  // prefer numeric-like planId; otherwise use planName slug
  const planIdent = planId && planId.trim() ? planId.trim() : planNameSlug;

  return {
    supplierSlug,
    tdspSlug,
    planIdent,
    debug: {
      supplierRaw,
      tdspRaw,
      planId,
      planNameSlug,
      term: od.term ?? null,
      kwh500: od.kwh500 ?? null,
      kwh1000: od.kwh1000 ?? null,
      kwh2000: od.kwh2000 ?? null,
    },
  };
}

export function deriveRateKey(offer: any): string | null {
  const parts = getRateKeyParts(offer);
  if (!parts.supplierSlug || !parts.tdspSlug || !parts.planIdent) return null;
  return `${parts.supplierSlug}:${parts.tdspSlug}:${parts.planIdent}`;
}

// ---------------- helpers ----------------

function normalizeSupplierSlug(s: any): string | null {
  const x = String(s || '').trim().toLowerCase();
  if (!x) return null;

  // Common vendor aliases → stable slug
  const map: Record<string, string> = {
    'gexa energy': 'gexa',
    gexa: 'gexa',
    'frontier utilities': 'frontier',
    frontier: 'frontier',
    'champion energy services': 'champion',
    champion: 'champion',
    'chariot energy': 'chariot',
    chariot: 'chariot',
    'payless power': 'payless',
    payless: 'payless',
    // add more as you integrate (tri-eagle → trieagle, reliant → reliant, etc.)
  };
  if (map[x]) return map[x];

  // Try to strip common suffixes like "energy", "llc", "inc."
  const stripped = x
    .replace(/\b(energy|power|utilities|utility|services|service|llc|inc|co|company|corp|corporation)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (map[stripped]) return map[stripped];

  return safeSlug(x);
}

function normalizeTdspSlug(s: any): string | null {
  const slugFromHelper = tdspToSlug(s || '');
  if (slugFromHelper) return slugFromHelper;
  const x = String(s || '').trim().toLowerCase();
  if (!x) return null;
  // Fallbacks
  if (/oncor/.test(x)) return 'oncor';
  if (/center\s*point|centerpoint/.test(x)) return 'centerpoint';
  if (/aep.*north/.test(x)) return 'aep_n';
  if (/aep.*(central|south)/.test(x)) return 'aep_c';
  if (/tnmp|texas new mexico/.test(x)) return 'tnmp';
  return safeSlug(x);
}

function guessSupplierFromName(name: string): string | null {
  const x = (name || '').toLowerCase();
  if (x.includes('gexa')) return 'gexa';
  if (x.includes('frontier')) return 'frontier';
  if (x.includes('champ')) return 'champion';
  if (x.includes('chariot')) return 'chariot';
  if (x.includes('payless')) return 'payless';
  return null;
}

function guessTdspFromName(name: string): string | null {
  const x = (name || '').toLowerCase();
  if (x.includes('oncor')) return 'oncor';
  if (x.includes('centerpoint')) return 'centerpoint';
  if (x.includes('aep') && x.includes('north')) return 'aep_n';
  if (x.includes('aep') && (x.includes('central') || x.includes('south'))) return 'aep_c';
  if (x.includes('tnmp')) return 'tnmp';
  return null;
}

function safeSlug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .replace(/--+/g, '-');
}