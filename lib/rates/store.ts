// lib/rates/store.ts
// Step 33: Local Rate Store — loads structured rate configs from /data/rates/**.json
// Exposes:
//  - matchOfferToRate(offer) → { key, rate, parts }  // best-effort match
//  - rateLikeFromOffer(offer) → RateLike             // safe fallback using WattBuy averages
//  - types for RateConfig / RateLike
//
// Notes
//  - File layout: /data/rates/<tdspSlug>/<supplier>-<planIdOrSlug>.json
//  - See earlier seeded examples under /data/rates/oncor/*
//  - Hot-reloads every 60s (simple TTL); you can bump via RATE_STORE_TTL_MS
//
// Rate schema (minimal):
// {
//   "key": "gexa:oncor:159872",
//   "supplierSlug": "gexa",
//   "supplierName": "Gexa Energy",
//   "planId": "159872",
//   "planName": "Gexa Eco Saver Plus 8",
//   "termMonths": 8,
//   "tdspSlug": "oncor",
//
//   // Fixed adders
//   "baseMonthlyFeeCents": 0,              // optional (REP base charge, not TDU)
//   "tduDeliveryCentsPerKwh": 0,           // optional (we often fold TDU into tiers)
//
//   // Piecewise energy pricing (most used)
//   "centsPerKwhJson": [
//     {"upToKwh": 500,  "rateCents": 12.5},
//     {"upToKwh": 1000, "rateCents": 10.9},
//     {"upToKwh": null, "rateCents": 14.2}
//   ],
//
//   // Usage bill credits (very common in TX)
//   "billCreditsJson": [
//     {"thresholdKwh": 1000, "creditCents": 12500}
//   ],
//
//   // Optional TOU windows (basic example)
//   // "touWindowsJson": [
//   //   {"label":"on-peak","startHour":14,"endHour":19,"days":[1,2,3,4,5],"rateAdderCents":0},
//   //   {"label":"off-peak","startHour":19,"endHour":14,"days":[0,1,2,3,4,5,6],"rateAdderCents":0}
//   // ],
//
//   // Convenience fallback (for display / cross-check)
//   "avgPrice500": 22.3,
//   "avgPrice1000": 9.3,
//   "avgPrice2000": 15.4,
//
//   "links": { "efl": "...", "tos": "...", "yrac": "..." },
//   "notes": ["free-form"]
// }

import fs from 'node:fs';
import path from 'node:path';
import { deriveRateKey, getRateKeyParts } from '@/lib/rates/key';

export type Tier = { upToKwh: number | null; rateCents: number };
export type BillCredit = { thresholdKwh: number; creditCents: number };

export type RateConfig = {
  key?: string | null;

  supplierSlug?: string | null;
  supplierName?: string | null;
  planId?: string | null;
  planName?: string | null;
  termMonths?: number | null;
  tdspSlug?: string | null;

  baseMonthlyFeeCents?: number | null;
  tduDeliveryCentsPerKwh?: number | null;

  centsPerKwhJson?: Tier[] | null;
  billCreditsJson?: BillCredit[] | null;

  // Optional, basic TOU structure support
  touWindowsJson?: Array<{
    label?: string;
    startHour: number; // 0-23
    endHour: number;   // 0-23 (wrap supported)
    days?: number[];   // 0=Sunday...6=Saturday
    rateAdderCents?: number; // added to base tier rate for hours in this window
  }> | null;

  // fallbacks (averages)
  avgPrice500?: number | null;
  avgPrice1000?: number | null;
  avgPrice2000?: number | null;

  links?: { efl?: string | null; tos?: string | null; yrac?: string | null } | null;
  notes?: string[] | null;
};

// This is the minimal shape needed by the bill calculator (merges RateConfig + offer fallbacks)
export type RateLike = {
  supplierSlug?: string | null;
  supplierName?: string | null;
  planId?: string | null;
  planName?: string | null;
  termMonths?: number | null;
  tdspSlug?: string | null;

  baseMonthlyFeeCents?: number | null;
  tduDeliveryCentsPerKwh?: number | null;

  centsPerKwhJson?: Tier[] | null;
  billCreditsJson?: BillCredit[] | null;
  touWindowsJson?: RateConfig['touWindowsJson'];

  avgPrice500?: number | null;
  avgPrice1000?: number | null;
  avgPrice2000?: number | null;

  links?: RateConfig['links'];
};

// ---------------- In-memory index ----------------

type Index = Map<string, RateConfig>;
let INDEX: Index | null = null;
let LAST_LOADED = 0;
const TTL_MS = Number(process.env.RATE_STORE_TTL_MS || 60_000);

function rateDataRoot(): string {
  // Allow override for tests; else project /data/rates
  const root = process.env.RATE_DATA_DIR || path.join(process.cwd(), 'data', 'rates');
  return root;
}

function shouldReload() {
  return !INDEX || Date.now() - LAST_LOADED > TTL_MS;
}

export async function loadRateIndex(): Promise<Index> {
  if (!shouldReload()) return INDEX!;
  const root = rateDataRoot();

  const idx: Index = new Map();

  if (!fs.existsSync(root)) {
    // Create empty dir to avoid repeated fs errors
    fs.mkdirSync(root, { recursive: true });
  }

  // Walk directory for .json files
  const files: string[] = [];
  walk(root, files);

  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      if (!raw.trim()) continue;
      const rc = JSON.parse(raw) as RateConfig;

      // Derive a key if not present
      const key =
        rc.key ||
        [
          rc.supplierSlug || rc.supplierName,
          rc.tdspSlug,
          rc.planId || slug(rc.planName || ''),
        ]
          .filter(Boolean)
          .join(':')
          .toLowerCase();

      if (!key) continue;

      // Normalize a bit
      rc.key = key;
      rc.supplierSlug = (rc.supplierSlug || slug(rc.supplierName || '') || null) as any;
      rc.tdspSlug = (rc.tdspSlug || null) as any;

      idx.set(key, rc);
    } catch (e) {
      console.warn(`[rates] Failed parsing ${f}:`, (e as Error).message);
    }
  }

  INDEX = idx;
  LAST_LOADED = Date.now();
  return INDEX!;
}

function walk(dir: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p, out);
    } else if (ent.isFile() && /\.json$/i.test(ent.name)) {
      out.push(p);
    }
  }
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .replace(/--+/g, '-');
}

// ---------------- Public API ----------------

export async function matchOfferToRate(offer: any): Promise<{ key: string | null; rate: RateConfig | null; parts: any }> {
  const parts = getRateKeyParts(offer);
  const derivedKey = deriveRateKey(offer);
  const idx = await loadRateIndex();

  // 1) Exact key
  if (derivedKey && idx.has(derivedKey)) {
    return { key: derivedKey, rate: idx.get(derivedKey)!, parts };
  }

  // 2) Try without tdsp if present (some files may be supplier:*:planId)
  if (parts.planIdent && parts.supplierSlug) {
    const relaxed = `${parts.supplierSlug}:${parts.planIdent}`;
    for (const k of idx.keys()) {
      if (k.endsWith(`:${parts.planIdent}`) && k.startsWith(`${parts.supplierSlug}:`)) {
        return { key: k, rate: idx.get(k)!, parts };
      }
      if (k === relaxed) {
        return { key: k, rate: idx.get(k)!, parts };
      }
    }
  }

  // 3) Search by planId only (last resort)
  if (parts.planIdent) {
    for (const [k, v] of idx.entries()) {
      if (v.planId && String(v.planId) === parts.planIdent) {
        return { key: k, rate: v, parts };
      }
    }
  }

  return { key: derivedKey, rate: null, parts };
}

// Build a minimal RateLike from a WattBuy offer (safe server-side)
export function rateLikeFromOffer(offer: any): RateLike {
  const od = offer?.offer_data || {};
  const supplierSlug = normalizeSupplier(od.supplier || od.supplier_name || offer?.supplier);
  const tdspSlug = normalizeTdsp(od.utility || od.utility_name || offer?.utility);

  // We intentionally DO NOT use od.cost here; prefer averages at 500/1000/2000
  const avg500 = toNum(od.kwh500);
  const avg1000 = toNum(od.kwh1000);
  const avg2000 = toNum(od.kwh2000);

  return {
    supplierSlug,
    supplierName: od.supplier_name || offer?.supplier_name || null,
    planId: od.plan_id != null ? String(od.plan_id) : null,
    planName: offer?.offer_name || null,
    termMonths: toNum(od.term),
    tdspSlug,

    baseMonthlyFeeCents: null,
    tduDeliveryCentsPerKwh: null,

    centsPerKwhJson: null,
    billCreditsJson: null,
    touWindowsJson: null,

    avgPrice500: isFiniteNum(avg500) ? avg500 : null,
    avgPrice1000: isFiniteNum(avg1000) ? avg1000 : null,
    avgPrice2000: isFiniteNum(avg2000) ? avg2000 : null,

    links: {
      efl: od.efl || null,
      tos: od.tos || null,
      yrac: od.yrac || null,
    },
  };
}

// ---------------- Small helpers ----------------

function normalizeSupplier(s: any): string | null {
  const x = String(s || '').trim().toLowerCase();
  if (!x) return null;
  if (x.includes('gexa')) return 'gexa';
  if (x.includes('frontier')) return 'frontier';
  if (x.includes('champion')) return 'champion';
  if (x.includes('chariot')) return 'chariot';
  if (x.includes('payless')) return 'payless';
  return x.replace(/[^a-z0-9]+/g, '-');
}

function normalizeTdsp(s: any): string | null {
  const x = String(s || '').trim().toLowerCase();
  if (!x) return null;
  if (x.includes('oncor')) return 'oncor';
  if (x.includes('centerpoint')) return 'centerpoint';
  if (x.includes('aep') && x.includes('north')) return 'aep_n';
  if (x.includes('aep') && (x.includes('central') || x.includes('south'))) return 'aep_c';
  if (x.includes('tnmp') || x.includes('texas new mexico')) return 'tnmp';
  return x.replace(/[^a-z0-9]+/g, '-');
}

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFiniteNum(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}