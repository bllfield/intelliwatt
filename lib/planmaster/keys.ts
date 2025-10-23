// lib/planmaster/keys.ts
// Step 61: Join-key generator to match WattBuy offers ➜ your Master Plan DB
// -------------------------------------------------------------------------
// Why:
//  • Your nightly EFL parser (or Retail Rates DB ingester) needs a stable way
//    to match a live WattBuy offer to a stored "master plan" row.
//  • Different REPs expose different identifiers (offer_id, plan_id, name_id,
//    EFL URL, etc.). This module produces an ordered set of robust join keys.
//  • Downstream, you'll try keys in priority order until you get a hit.
//
// Exposes:
//  • type JoinCandidates
//  • buildJoinCandidates(offer: OfferNormalized)
//  • normalizePlanName(str)
//  • hashDocURL(url)  // stable short SHA-256 for doc URLs (EFL/TOS/YRAC)
//
// Recommended DB indices (preview):
//  • UNIQUE (wb_offer_id, tdsp)
//  • UNIQUE (efl_url_hash)
//  • INDEX  (supplier_slug, plan_name_norm, term_months, tdsp)
//  • INDEX  (supplier_slug, name_id, tdsp)
//  • INDEX  (supplier_slug, plan_id, tdsp)

import crypto from 'crypto';
import type { OfferNormalized } from '@/lib/wattbuy/normalize';

export type JoinCandidates = {
  // Ordered list to try in sequence
  priority: Array<{ key: string; value: string }>;
  // Convenience map for debugging and analytics
  all: Record<string, string>;
};

/**
 * Create prioritized join keys for a WattBuy offer.
 * Try these in order until you match a master row.
 */
export function buildJoinCandidates(offer: OfferNormalized): JoinCandidates {
  const all: Record<string, string> = {};

  // 0) Safety
  const tdsp = offer.tdsp || '';
  const supplier = (offer.supplier_slug || '').toLowerCase();

  // 1) WattBuy Offer ID + TDSP (fast, deterministic within WB universe)
  if (offer.offer_id && tdsp) {
    all.wb_offer_id_tdsp = `${offer.offer_id}|${tdsp}`;
  }

  // 2) Document hashes (EFL first)
  const eflHash = hashDocURL(offer.docs.efl);
  if (eflHash) all.efl_url_hash = eflHash;

  const tosHash = hashDocURL(offer.docs.tos);
  if (tosHash) all.tos_url_hash = tosHash;

  const yracHash = hashDocURL(offer.docs.yrac);
  if (yracHash) all.yrac_url_hash = yracHash;

  // 3) REP-native identifiers (if present inside raw payload)
  const raw = offer.raw || {};
  const name_id = safeStr(raw?.offer_data?.name_id);
  const plan_id = safeStr(raw?.offer_data?.plan_id); // may be number or string
  if (supplier && name_id && tdsp) {
    all.supplier_name_id_tdsp = `${supplier}|${name_id}|${tdsp}`;
  }
  if (supplier && plan_id && tdsp) {
    all.supplier_plan_id_tdsp = `${supplier}|${plan_id}|${tdsp}`;
  }

  // 4) Normalized plan name + term + supplier + tdsp (works well for Frontier/Gexa variants)
  const planNorm = normalizePlanName(offer.plan_name);
  const term = offer.term_months ?? '';
  if (supplier && planNorm && term && tdsp) {
    all.supplier_plan_term_tdsp = `${supplier}|${planNorm}|${term}|${tdsp}`;
  }

  // 5) Name_id without TDSP (some master rows are geography-agnostic; TDSP filter applied in SQL)
  if (supplier && name_id) {
    all.supplier_name_id = `${supplier}|${name_id}`;
  }
  if (supplier && plan_id) {
    all.supplier_plan_id = `${supplier}|${plan_id}`;
  }

  // 6) Fallbacks: doc URL full strings (in case you prefer not to hash)
  if (offer.docs.efl) all.efl_url = offer.docs.efl!;
  if (offer.docs.tos) all.tos_url = offer.docs.tos!;
  if (offer.docs.yrac) all.yrac_url = offer.docs.yrac!;

  // Build priority list (strongest to weakest)
  const priorityOrder: Array<keyof typeof all> = [
    'wb_offer_id_tdsp',
    'efl_url_hash',
    'supplier_name_id_tdsp',
    'supplier_plan_id_tdsp',
    'supplier_plan_term_tdsp',
    'supplier_name_id',
    'supplier_plan_id',
    'efl_url',
    'tos_url_hash',
    'yrac_url_hash',
  ];

  const priority = priorityOrder
    .filter((k) => k in all)
    .map((k) => ({ key: k, value: all[k]! }));

  return { priority, all };
}

/**
 * Normalize plan names into a stable, fuzzy-join-friendly token.
 * Examples:
 *  • "Frontier Saver Plus 12" -> "frontier-saver-plus-12"
 *  • "Gexa Eco Saver Value 12" -> "gexa-eco-saver-value-12"
 */
export function normalizePlanName(input: string | null | undefined): string {
  const s = (input || '').toLowerCase();
  return s
    .normalize('NFKD')
    .replace(/[^\w\s\-]+/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-') // spaces ➜ dashes
    .replace(/-+/g, '-');
}

/**
 * Produce a short, stable hash for document URLs.
 * Returns first 16 hex chars of SHA-256 (sufficient for indexing).
 */
export function hashDocURL(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const canon = `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
    const h = crypto.createHash('sha256').update(canon).digest('hex').slice(0, 16);
    return h;
  } catch {
    return null;
  }
}

function safeStr(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// ---------------------- Sample SQL (for your reference) ----------------------
// Suggested table for master plans (from EFL parse or Retail Rates DB ingest):
//
// CREATE TABLE master_plans (
//   id BIGSERIAL PRIMARY KEY,
//   wb_offer_id TEXT,                 -- optional cache of WB id (nullable)
//   tdsp TEXT NOT NULL,               -- 'oncor' | 'centerpoint' | 'tnmp' | 'aep_n' | 'aep_c'
//   supplier_slug TEXT NOT NULL,      -- 'gexa', 'frontier', ...
//   plan_name TEXT NOT NULL,          -- raw name
//   plan_name_norm TEXT NOT NULL,     -- normalizePlanName(plan_name)
//   term_months INT,
//   name_id TEXT,                     -- REP-provided
//   plan_id TEXT,                     -- REP-provided
//   efl_url TEXT,
//   efl_url_hash CHAR(16),            -- hashDocURL(efl_url)
//   tos_url TEXT,
//   yrac_url TEXT,
//   rate_model JSONB NOT NULL,        -- your parsed structure for billing calc
//   meta JSONB NOT NULL DEFAULT '{}', -- any extra dims (green %, credits, etc.)
//   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
// );
//
// CREATE UNIQUE INDEX uniq_master_offer_tdsp ON master_plans (wb_offer_id, tdsp) WHERE wb_offer_id IS NOT NULL;
// CREATE UNIQUE INDEX uniq_master_efl_hash    ON master_plans (efl_url_hash) WHERE efl_url_hash IS NOT NULL;
// CREATE INDEX       idx_master_supplier_plan ON master_plans (supplier_slug, plan_name_norm, term_months, tdsp);
// CREATE INDEX       idx_master_supplier_nameid ON master_plans (supplier_slug, name_id, tdsp);
// CREATE INDEX       idx_master_supplier_planid ON master_plans (supplier_slug, plan_id, tdsp);
