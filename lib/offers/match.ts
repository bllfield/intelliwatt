// lib/offers/match.ts
// Step 50: Match engine — join WattBuy offers → nightly PlanMaster
// -----------------------------------------------------------------
// What this module does
//  - Builds a multi-key index over your nightly PlanMaster records
//  - Generates multiple candidate keys for each WattBuy offer (strict→loose)
//  - Finds the best PlanMaster match per offer and returns a confidence score
//  - Surfaces unmatched offers/plans, with debug reasons & suggestions
//
// Inputs
//  - WattBuyOffer[]: raw offers from /v3/offers (subset used here)
//  - PlanMaster[]: your nightly parsed plan rows (from EFL/retail rate sync)
//
// Output
//  - MatchResult: per-offer match with method, confidence, and plan ref
//
// Notes
//  - We DO NOT depend on any external libs; string metrics are simple.
//  - Key priorities (highest → lowest):
//      1) supplier + plan_id (exact), TDSP-aware
//      2) supplier + name_id (exact), TDSP-aware
//      3) supplier + EFL product code (prodcode | planName | productId), TDSP-aware
//      4) supplier + rate_id (exact), TDSP-aware
//      5) supplier + normalized offer_name ≈ normalized plan display_name (fuzzy)
//  - For collisions, we refine by term (months) and TDSP; otherwise best name similarity.
//  - Confidence scale: 1.0 (hard exact) down to 0.55 (loose fuzzy)
//
// Extend
//  - Add REP-specific extractors in `extractEflKeys` as you add providers.
//  - If you store canonical REP product codes in PlanMaster, add them to key map.

export type WattBuyOffer = {
  offer_id: string;
  offer_name: string;
  link?: string;
  offer_data: {
    utility?: string; // 'oncor', 'centerpoint', etc.
    supplier?: string; // 'gexa', 'frontier', etc. (lowercase slug in practice)
    supplier_name?: string;
    plan_id?: string | number;
    name_id?: string;
    rate_id?: number | string; // some REPs expose this (e.g., Champion)
    plan_name?: string; // e.g., 'PN1348'
    term?: number;
    efl?: string;
    tos?: string;
    yrac?: string;
    kwh500?: number;
    kwh1000?: number;
    kwh2000?: number;
  };
};

export type PlanMaster = {
  id: string; // internal unique id
  supplier: string; // human form, e.g., 'Gexa Energy'
  supplier_slug?: string; // optional canonical slug; if absent we derive
  tdsp?: string; // oncor|centerpoint|aep_n|aep_c|tnmp
  term_months?: number | null;
  plan_id?: string | number | null; // REP product/plan id if known
  name_id?: string | null; // REP slug name_id if known
  product_code?: string | null; // e.g., prodcode=GXAECOSVRPLS12, PN1348, productId=39904
  rate_id?: number | string | null; // REP rate/version id if known
  display_name?: string | null; // human plan name
  efl_url?: string | null;
  tos_url?: string | null;
  yrac_url?: string | null;
  // ... plus any pricing/parsed fields you store; ignored by matcher
  meta?: Record<string, any>;
};

export type MatchDecision =
  | {
      status: 'matched';
      method: string;
      confidence: number; // 0–1
      plan: PlanMaster;
      keys_used: string[];
      notes?: string[];
    }
  | {
      status: 'unmatched';
      suggestions: Array<{ plan: PlanMaster; score: number; reason: string }>;
      keys_used: string[];
      notes?: string[];
    };

export type MatchResult = {
  offer: WattBuyOffer;
  decision: MatchDecision;
};

export type MatchSummary = {
  total_offers: number;
  matched: number;
  unmatched: number;
  methods: Record<string, number>;
  avg_confidence: number;
};

export type MatchOutput = {
  results: MatchResult[];
  summary: MatchSummary;
  unmatched_offers: MatchResult[];
  unmatched_plans: PlanMaster[]; // plans never referenced by any match
};

type IndexKey = string;

type PlanIndex = {
  byKey: Map<IndexKey, PlanMaster[]>;
  all: PlanMaster[];
};

export function matchOffersToPlans(
  offers: WattBuyOffer[],
  plans: PlanMaster[],
  opts?: { preferTdspStrict?: boolean }
): MatchOutput {
  const preferTdspStrict = opts?.preferTdspStrict ?? true;

  const index = buildPlanIndex(plans);
  const seenPlanIds = new Set<string>();

  const results: MatchResult[] = [];
  const methodCounts: Record<string, number> = {};
  let confSum = 0;
  let matchedCount = 0;

  for (const offer of offers) {
    const keys = offerKeys(offer);
    const tdsp = tdspSlug(offer.offer_data.utility);

    // Try strategies in order
    const strategies: Array<{ name: string; keys: IndexKey[]; confidence: number }> = [
      { name: 'supplier+plan_id', keys: keys.key_planId, confidence: 1.0 },
      { name: 'supplier+name_id', keys: keys.key_nameId, confidence: 0.95 },
      { name: 'supplier+efl_code', keys: keys.key_eflCode, confidence: 0.9 },
      { name: 'supplier+rate_id', keys: keys.key_rateId, confidence: 0.9 },
      { name: 'supplier+name_fuzzy', keys: keys.key_nameFuzzy, confidence: 0.7 },
    ];

    let decision: MatchDecision | null = null;
    const allTriedKeys: string[] = [];

    for (const strat of strategies) {
      for (const k of strat.keys) {
        allTriedKeys.push(`${strat.name}:${k}`);
        const candidates = index.byKey.get(k);
        if (!candidates?.length) continue;

        // Optional TDSP refinement
        const refined = preferTdspStrict && tdsp
          ? candidates.filter((p) => tdspSlug(p.tdsp) === tdsp)
          : candidates;

        const picked = pickBestCandidate(offer, refined.length ? refined : candidates, strat.name);
        if (picked) {
          const conf = refineConfidence(strat.confidence, offer, picked);
          decision = {
            status: 'matched',
            method: strat.name,
            confidence: conf,
            plan: picked,
            keys_used: [k],
          };
          break;
        }
      }
      if (decision) break;
    }

    if (!decision) {
      // Build suggestions (same supplier, top 5 by name similarity & term proximity)
      const sup = supplierSlugFromOffer(offer);
      const pool = index.byKey.get(`supplier:${sup}`) || [];
      const suggestions = pool
        .map((p) => ({
          plan: p,
          score: similarity(normalizeName(offer.offer_name), normalizeName(p.display_name || '')) +
            termAffinity(offer.offer_data.term, p.term_months),
          reason: 'supplier pool',
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      decision = {
        status: 'unmatched',
        suggestions,
        keys_used: allTriedKeys,
        notes: ['No exact keys matched; provided top suggestions by supplier.'],
      };
    } else if (decision.status === 'matched') {
      // Track plan seen
      seenPlanIds.add(decision.plan.id);
      methodCounts[decision.method] = (methodCounts[decision.method] || 0) + 1;
      confSum += decision.confidence;
      matchedCount += 1;
    }

    results.push({ offer, decision });
  }

  // Unmatched plans = not referenced in any match result
  const unmatchedPlans = plans.filter((p) => !seenPlanIds.has(p.id));

  const summary: MatchSummary = {
    total_offers: offers.length,
    matched: matchedCount,
    unmatched: offers.length - matchedCount,
    methods: methodCounts,
    avg_confidence: matchedCount ? round2(confSum / matchedCount) : 0,
  };

  return {
    results,
    summary,
    unmatched_offers: results.filter((r) => r.decision.status === 'unmatched'),
    unmatched_plans: unmatchedPlans,
  };
}

// -------------------- Index construction --------------------

function buildPlanIndex(plans: PlanMaster[]): PlanIndex {
  const byKey = new Map<IndexKey, PlanMaster[]>();

  function put(k: IndexKey, p: PlanMaster) {
    if (!k) return;
    const arr = byKey.get(k);
    if (arr) arr.push(p);
    else byKey.set(k, [p]);
  }

  for (const p of plans) {
    const sup = supplierSlug(p.supplier_slug || p.supplier);

    // Global supplier pool
    put(`supplier:${sup}`, p);

    const tdsp = tdspSlug(p.tdsp);
    const tdspPart = tdsp ? `|tdsp:${tdsp}` : '';

    if (p.plan_id != null && p.plan_id !== '') {
      put(`k:plan#${sup}#${String(p.plan_id)}${tdspPart}`, p);
      // Non-TDSP key as well for cross-tdsp matches (fallback)
      put(`k:plan#${sup}#${String(p.plan_id)}`, p);
    }

    if (p.name_id) {
      const nid = simpleSlug(p.name_id);
      put(`k:name#${sup}#${nid}${tdspPart}`, p);
      put(`k:name#${sup}#${nid}`, p);
    }

    if (p.product_code) {
      const pc = simpleSlug(p.product_code);
      put(`k:efl#${sup}#${pc}${tdspPart}`, p);
      put(`k:efl#${sup}#${pc}`, p);
    }

    if (p.rate_id != null && p.rate_id !== '') {
      const rid = String(p.rate_id);
      put(`k:rate#${sup}#${rid}${tdspPart}`, p);
      put(`k:rate#${sup}#${rid}`, p);
    }

    if (p.display_name) {
      const ns = normalizeName(p.display_name);
      put(`k:nm#${sup}#${ns}${tdspPart}`, p);
      put(`k:nm#${sup}#${ns}`, p);
    }

    // EFL URL derived codes
    const eflKeys = extractEflKeys(p.efl_url || undefined);
    for (const ek of eflKeys) {
      put(`k:efl#${sup}#${ek}${tdspPart}`, p);
      put(`k:efl#${sup}#${ek}`, p);
    }
  }

  return { byKey, all: plans };
}

// -------------------- Offer key generation --------------------

function offerKeys(o: WattBuyOffer) {
  const sup = supplierSlugFromOffer(o);
  const tdsp = tdspSlug(o.offer_data.utility);
  const tdspPart = tdsp ? `|tdsp:${tdsp}` : '';

  const keys = {
    key_planId: [] as IndexKey[],
    key_nameId: [] as IndexKey[],
    key_eflCode: [] as IndexKey[],
    key_rateId: [] as IndexKey[],
    key_nameFuzzy: [] as IndexKey[],
  };

  // plan_id
  if (o.offer_data.plan_id != null && o.offer_data.plan_id !== '') {
    const pid = String(o.offer_data.plan_id);
    keys.key_planId.push(`k:plan#${sup}#${pid}${tdspPart}`, `k:plan#${sup}#${pid}`);
  }

  // name_id
  if (o.offer_data.name_id) {
    const nid = simpleSlug(o.offer_data.name_id);
    keys.key_nameId.push(`k:name#${sup}#${nid}${tdspPart}`, `k:name#${sup}#${nid}`);
  }

  // EFL code(s)
  const eflCodes = new Set<string>([
    ...extractEflKeys(o.offer_data.efl),
    ...extractEflKeys(o.link),
  ]);
  for (const ec of eflCodes) {
    keys.key_eflCode.push(`k:efl#${sup}#${ec}${tdspPart}`, `k:efl#${sup}#${ec}`);
  }

  // rate_id (Champion etc.)
  if (o.offer_data.rate_id != null && o.offer_data.rate_id !== '') {
    const rid = String(o.offer_data.rate_id);
    keys.key_rateId.push(`k:rate#${sup}#${rid}${tdspPart}`, `k:rate#${sup}#${rid}`);
  }

  // name fuzzy
  const nm = normalizeName(o.offer_name);
  keys.key_nameFuzzy.push(`k:nm#${sup}#${nm}${tdspPart}`, `k:nm#${sup}#${nm}`);

  return keys;
}

function supplierSlugFromOffer(o: WattBuyOffer): string {
  const raw = o.offer_data.supplier || o.offer_data.supplier_name || guessSupplierFromLink(o.link) || o.offer_name;
  return supplierSlug(raw);
}

// -------------------- Candidate selection --------------------

function pickBestCandidate(offer: WattBuyOffer, cands: PlanMaster[], method: string): PlanMaster | null {
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];

  const tdsp = tdspSlug(offer.offer_data.utility);
  const term = offer.offer_data.term ?? null;
  const oname = normalizeName(offer.offer_name);

  // Score each candidate
  const scored = cands.map((p) => {
    let s = 0;
    // TDSP boost
    if (tdsp && tdspSlug(p.tdsp) === tdsp) s += 0.25;
    // Term proximity
    s += termAffinity(term, p.term_months);
    // Name similarity
    s += similarity(oname, normalizeName(p.display_name || ''));
    return { p, s };
  });

  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.p ?? null;
}

function refineConfidence(base: number, offer: WattBuyOffer, plan: PlanMaster): number {
  let conf = base;
  // Small bumps for corroborating fields
  if ((offer.offer_data.term || 0) && plan.term_months && offer.offer_data.term === plan.term_months) conf += 0.05;
  // If EFL host matches, bump
  const oHost = urlHost(offer.offer_data.efl || offer.link || '');
  const pHost = urlHost(plan.efl_url || '');
  if (oHost && pHost && oHost === pHost) conf += 0.02;
  return Math.max(0, Math.min(1, conf));
}

// -------------------- Utilities --------------------

function supplierSlug(s?: string | null): string {
  const raw = (s || '').toLowerCase().trim();
  // normalize common variants
  const table: Record<string, string> = {
    'gexa energy': 'gexa',
    gexa: 'gexa',
    frontier: 'frontier',
    'frontier utilities': 'frontier',
    champion: 'champion',
    'champion energy services': 'champion',
    chariot: 'chariot',
    'chariot energy': 'chariot',
    payless: 'payless',
    'payless power': 'payless',
    reliant: 'reliant',
    'reliant energy': 'reliant',
    'txu energy': 'txu',
    txu: 'txu',
    triagle: 'trieagle',
    'trieagle energy': 'trieagle',
  };
  if (table[raw]) return table[raw];
  // strip suffixes like " energy"
  return raw.replace(/\s+energy\b/g, '').replace(/\s+utilities\b/g, '').replace(/[^\w]+/g, '');
}

function tdspSlug(s?: string | null): string | null {
  if (!s) return null;
  const raw = s.toLowerCase();
  if (/oncor/.test(raw)) return 'oncor';
  if (/centerpoint|cnp/.test(raw)) return 'centerpoint';
  if (/aep.*north|aep_n|aepn/.test(raw)) return 'aep_n';
  if (/aep.*central|aep_c|aepc|wtu|cpl/.test(raw)) return 'aep_c';
  if (/tnmp/.test(raw)) return 'tnmp';
  return raw.replace(/[^\w]+/g, '');
}

function normalizeName(n?: string | null): string {
  const raw = (n || '').toLowerCase();
  return simpleSlug(
    raw
      .replace(/(\benergy\b|\bpower\b|\bservices\b)/g, '')
      .replace(/\b(saver|eco|plus|value|silver|green|shine|solarize|free|weekends)\b/g, (m) => m) // keep tokens
  );
}

function simpleSlug(s?: string | null): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function termAffinity(a?: number | null, b?: number | null): number {
  if (!a || !b) return 0;
  const diff = Math.abs(a - b);
  if (diff === 0) return 0.15;
  if (diff <= 3) return 0.08;
  if (diff <= 6) return 0.04;
  return 0;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 0.4;
  // Jaccard over bigrams (lightweight)
  const sa = bigrams(a);
  const sb = bigrams(b);
  let inter = 0;
  const sbSet = new Set(sb);
  for (const x of sa) if (sbSet.has(x)) inter++;
  const union = new Set([...sa, ...sb]).size || 1;
  const j = inter / union;
  return j * 0.35; // scaled so exact ≈0.35, partials 0.1–0.25
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function urlHost(u?: string | null): string | null {
  if (!u) return null;
  try {
    const { host } = new URL(u);
    return host.toLowerCase();
  } catch {
    return null;
  }
}

function extractEflKeys(u?: string | null): string[] {
  if (!u) return [];
  let keys: string[] = [];
  try {
    const url = new URL(u);
    const host = url.host.toLowerCase();
    const qp = url.searchParams;

    // Frontier: eflviewer.frontierutilities.com/?prodcode=FSVRPLS12&tdspcode=ONCOR_ELEC
    if (host.includes('frontierutilities.com')) {
      const prod = qp.get('prodcode');
      if (prod) keys.push(simpleSlug(prod));
    }

    // Gexa: eflviewer.gexaenergy.com/?prodcode=GXAECOSVRPLS12&tdspcode=ONCOR_ELEC
    if (host.includes('gexaenergy.com')) {
      const prod = qp.get('prodcode');
      if (prod) keys.push(simpleSlug(prod));
    }

    // Champion: docs.championenergyservices.com/ExternalDocs?planName=PN1348
    if (host.includes('championenergyservices.com')) {
      const planName = qp.get('planName');
      if (planName) keys.push(simpleSlug(planName)); // pn1348
    }

    // Chariot: signup.chariotenergy.com//Home/EFl?productId=39904
    if (host.includes('chariotenergy.com')) {
      const pid = qp.get('productId');
      if (pid) keys.push(simpleSlug(pid));
    }

    // Payless: paylesspower.com/files/83_1_eng.pdf (filename often starts with plan id)
    if (host.includes('paylesspower.com')) {
      const m = url.pathname.match(/\/files\/([a-z0-9_]+)/i);
      if (m) keys.push(simpleSlug(m[1]));
    }

    // Fallback: last path segment (often a code)
    const tail = url.pathname.split('/').filter(Boolean).pop();
    if (tail && /\w{3,}/.test(tail)) keys.push(simpleSlug(tail));
  } catch {
    // ignore
  }
  // Deduplicate
  return Array.from(new Set(keys.filter(Boolean)));
}

function guessSupplierFromLink(link?: string | null): string | null {
  if (!link) return null;
  const u = link.toLowerCase();
  if (u.includes('/gexa-') || u.includes('gexaenergy')) return 'gexa';
  if (u.includes('/frontier-') || u.includes('frontierutilities')) return 'frontier';
  if (u.includes('/chariot-') || u.includes('chariotenergy')) return 'chariot';
  if (u.includes('/champ-') || u.includes('championenergy')) return 'champion';
  if (u.includes('paylesspower')) return 'payless';
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
