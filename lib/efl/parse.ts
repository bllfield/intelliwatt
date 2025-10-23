// lib/efl/parse.ts
// Step 16: EFL parser — turn raw EFL text (from PDF or HTML) into a RateConfig-like object
// your calculator can use. This is heuristic-first and designed to be *resilient* across
// REP formats. You can refine extractors as you encounter new quirks.
//
// Usage:
//   import { parseEflText } from '@/lib/efl/parse';
//   const parsed = parseEflText(rawText, { tdspSlug: 'oncor', supplierSlug: 'gexa', eflUrl });
//   // Save `parsed.rate` into Prisma RateConfig; keep `parsed.meta` in EflRaw.meta for traceability.

export type ParsedEfl = {
  rate: {
    supplierSlug?: string | null;
    supplierName?: string | null;
    planId?: string | null;
    planName?: string | null;
    termMonths?: number | null;
    tdspSlug?: string | null;
    tdspName?: string | null;

    eflUrl?: string | null;
    tosUrl?: string | null;
    yracUrl?: string | null;

    // Core pricing structures the calculator understands:
    baseMonthlyFeeCents?: number | null;          // fixed monthly customer/base charge
    tduDeliveryCentsPerKwh?: number | null;       // optional pass-through per-kWh (if EFL cleanly exposes it)
    centsPerKwhJson?: Array<{ min: number; max: number | null; cents: number }>; // tier bands
    billCreditsJson?: Array<{ type: 'threshold_credit'; thresholdKwh: number; creditCents: number }>;
    touWindowsJson?: Array<{ start: string; end: string; cents: number }>;
    otherFeesJson?: any;

    // Helpful fallbacks (WattBuy already gives these; we mirror when EFL publishes):
    avgPrice500?: number | null;  // in ¢/kWh
    avgPrice1000?: number | null;
    avgPrice2000?: number | null;

    isGreen?: boolean | null;
    greenPct?: number | null;
    cancelFeeCents?: number | null;
    isFixed?: boolean | null;
    isVariable?: boolean | null;
  };
  meta: {
    detected: Record<string, any>;
    warnings: string[];
    notes: string[];
  };
};

type Hints = {
  tdspSlug?: string;         // e.g., 'oncor' | 'centerpoint' | 'aep_central' | ...
  supplierSlug?: string;     // e.g., 'gexa' | 'frontier' | 'champion'
  supplierName?: string;
  planName?: string;
  planId?: string;
  eflUrl?: string;
  tosUrl?: string;
  yracUrl?: string;
};

const TDSP_ALIASES: Record<string, string> = {
  oncor: 'Oncor',
  centerpoint: 'CenterPoint',
  aep_central: 'AEP Central',
  aep_north: 'AEP North',
  tnmnp: 'Texas New Mexico Power',
  tnm: 'Texas New Mexico Power',
  tnmp: 'Texas New Mexico Power',
};

const MONEY_RE = /(?:\$|USD\s*)?([0-9]+(?:\.[0-9]{1,2})?)/i;
const PCT_RE = /([1-9][0-9]?|100)\s*%/;
const TERM_RE = /(?:term|length|contract)\s*[:\-]?\s*(\d{1,3})\s*(?:months|month)\b/i;
const CANCEL_RE = /(?:early\s+termination|cancellation)\s+fee[^$]*\$?\s*([0-9]{1,4})/i;
const BASE_FEE_RE = /(base|minimum)\s*(?:charge|fee)[^$]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
const ENERGY_RATE_RE = /(?:energy\s*charge|rate)[^0-9%]*([0-9]+(?:\.[0-9]{1,4})?)\s*(?:¢|cents?)\s*\/?\s*kwh/i;
const AVG_500_RE = /(500)\s*kwh[^0-9%]*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:¢|cents?)\s*\/?\s*kwh/i;
const AVG_1000_RE = /(1000)\s*kwh[^0-9%]*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:¢|cents?)\s*\/?\s*kwh/i;
const AVG_2000_RE = /(2000)\s*kwh[^0-9%]*([0-9]+(?:\.[0-9]{1,3})?)\s*(?:¢|cents?)\s*\/?\s*kwh/i;
const GREEN_FULL_RE = /(100\s*%|100%)[^a-zA-Z0-9]{0,6}(renewable|green)/i;
const GREEN_PCT_RE = /([1-9][0-9]?|100)\s*%\s*(?:renewable|green)/i;

// Usage-credit patterns (e.g. "$125 bill credit when usage ≥ 1000 kWh")
const CREDIT_LINE_RE = /(?:bill|usage)\s*credit[^$]*\$?\s*([0-9]{1,4})(?:\.\d{1,2})?[^0-9]{1,20}(?:above|over|>=?|at\s+least)\s*([0-9]{2,5})\s*kwh/i;

// TOU windows: "On-Peak 2pm–7pm @ 23¢/kWh", "Off-Peak 7pm–2pm @ 12¢/kWh"
const TOU_ROW_RE = /(on[-\s]?peak|off[-\s]?peak|peak|shoulder|night|day)[^0-9]{0,20}(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?[^0-9]{0,20}([0-9]+(?:\.[0-9]{1,3})?)\s*(?:¢|cents?)\s*\/?\s*kwh/i;

export function parseEflText(textRaw: string, hints: Hints = {}): ParsedEfl {
  const text = normalize(textRaw);
  const notes: string[] = [];
  const warnings: string[] = [];
  const detected: Record<string, any> = {};

  // Supplier & TDSP
  const supplierSlug = hints.supplierSlug || null;
  const supplierName = hints.supplierName || (supplierSlug ? guessSupplierName(supplierSlug) : null);
  const tdspSlug = normalizeSlug(hints.tdspSlug);
  const tdspName = tdspSlug ? TDSP_ALIASES[tdspSlug] || title(tdspSlug) : null;

  // Term (months)
  const termMonths = pickInt(matchOne(text, TERM_RE));

  // Early termination fee (flat $ or $/month remaining)
  let cancelFeeCents: number | null = null;
  const cancelFlat = matchOne(text, CANCEL_RE);
  if (cancelFlat) cancelFeeCents = dollarsToCents(cancelFlat);

  // Base monthly fee (aka Base Charge)
  let baseMonthlyFeeCents: number | null = null;
  const baseFee = matchOne(text, BASE_FEE_RE);
  if (baseFee) baseMonthlyFeeCents = dollarsToCents(baseFee);

  // Avg price table (500 / 1000 / 2000 kWh)
  const avgPrice500 = pickFloat(matchSecond(text, AVG_500_RE));
  const avgPrice1000 = pickFloat(matchSecond(text, AVG_1000_RE));
  const avgPrice2000 = pickFloat(matchSecond(text, AVG_2000_RE));

  // Energy rate (simple, per kWh) — if present outside TOU/tiering
  const energyRate = pickFloat(matchOne(text, ENERGY_RATE_RE)); // in ¢/kWh

  // Usage credit(s)
  const credits: Array<{ type: 'threshold_credit'; thresholdKwh: number; creditCents: number }> = [];
  for (const m of matchAll(text, CREDIT_LINE_RE)) {
    const creditDollars = pickFloat(m[1]);
    const threshold = pickInt(m[2]);
    if (creditDollars && threshold) {
      credits.push({
        type: 'threshold_credit',
        thresholdKwh: threshold!,
        creditCents: dollarsToCents(String(creditDollars)),
      });
    }
  }

  // TOU windows
  const tou: Array<{ start: string; end: string; cents: number }> = [];
  for (const m of matchAll(text, TOU_ROW_RE)) {
    const start = hhmm(m[2], m[3], m[4]);
    const end = hhmm(m[5], m[6], m[7]);
    const cents = pickFloat(m[8]);
    if (start && end && typeof cents === 'number') {
      tou.push({ start, end, cents });
    }
  }

  // Green %
  let isGreen: boolean | null = null;
  let greenPct: number | null = null;
  if (GREEN_FULL_RE.test(text)) {
    isGreen = true;
    greenPct = 100;
  } else {
    const g = matchOne(text, GREEN_PCT_RE);
    if (g) {
      isGreen = true;
      greenPct = clampInt(Number(g), 0, 100);
    }
  }

  // Variable vs Fixed
  let isFixed: boolean | null = null;
  let isVariable: boolean | null = null;
  if (/\bfixed\b/i.test(text)) isFixed = true;
  if (/\bvariable\b/i.test(text)) isVariable = true;

  // Build centsPerKwh bands:
  // Heuristic: if TOU exists → leave bands empty; calculator will use TOU.
  // Else if simple energyRate exists → single open-ended band with that ¢/kWh.
  const centsPerKwhJson =
    tou.length > 0
      ? []
      : typeof energyRate === 'number'
      ? [{ min: 0, max: null, cents: energyRate }]
      : [];

  // Assemble result
  const result: ParsedEfl = {
    rate: {
      supplierSlug,
      supplierName: supplierName || null,
      planId: hints.planId || null,
      planName: hints.planName || null,
      termMonths: termMonths ?? null,
      tdspSlug: tdspSlug || null,
      tdspName: tdspName || null,

      eflUrl: hints.eflUrl || null,
      tosUrl: hints.tosUrl || null,
      yracUrl: hints.yracUrl || null,

      baseMonthlyFeeCents: baseMonthlyFeeCents ?? null,
      // tduDeliveryCentsPerKwh is intentionally *not* forced from EFL unless clearly stated.
      // Many REPs embed TDU into the advertised ¢/kWh; fill this only if you find a clean line-item.
      tduDeliveryCentsPerKwh: null,

      centsPerKwhJson,
      billCreditsJson: credits.length ? credits : undefined,
      touWindowsJson: tou.length ? tou : undefined,

      avgPrice500: avgPrice500 ?? null,
      avgPrice1000: avgPrice1000 ?? null,
      avgPrice2000: avgPrice2000 ?? null,

      isGreen: isGreen ?? null,
      greenPct: greenPct ?? null,
      cancelFeeCents: cancelFeeCents ?? null,
      isFixed: isFixed ?? null,
      isVariable: isVariable ?? null,
    },
    meta: { detected, warnings, notes },
  };

  // Detect missing essentials & add notes
  if (!result.rate.termMonths) warnings.push('Term months not detected.');
  if (!result.rate.centsPerKwhJson?.length && !result.rate.touWindowsJson?.length) {
    notes.push('No explicit per-kWh structure; rely on avg (500/1000/2000) until parsed deeper.');
  }
  if (result.rate.billCreditsJson?.length) notes.push('Threshold bill credit detected.');
  if (result.rate.touWindowsJson?.length) notes.push('TOU windows detected.');

  // Record detections (for debugging/telemetry)
  detected.termMonths = result.rate.termMonths;
  detected.baseMonthlyFeeCents = result.rate.baseMonthlyFeeCents;
  detected.avgPrice500 = result.rate.avgPrice500;
  detected.avgPrice1000 = result.rate.avgPrice1000;
  detected.avgPrice2000 = result.rate.avgPrice2000;
  detected.hasCredits = !!result.rate.billCreditsJson?.length;
  detected.touCount = result.rate.touWindowsJson?.length || 0;
  detected.isGreen = result.rate.isGreen;
  detected.cancelFeeCents = result.rate.cancelFeeCents;

  return result;
}

// ---------------- helpers ----------------

function normalize(text: string): string {
  // Normalize whitespace and common OCR artifacts
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .trim();
}

function title(s: string) {
  return s
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function normalizeSlug(s?: string | null) {
  if (!s) return undefined;
  return String(s).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function matchOne(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? (m[1] || m[0]) : null;
}
function matchSecond(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? (m[2] || null) : null;
}
function matchAll(text: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) out.push(m);
  return out;
}

function dollarsToCents(val: string): number {
  const n = Number(val.replace(/[^0-9.]/g, ''));
  return Math.round(n * 100);
}
function pickInt(s?: string | null): number | null {
  if (!s) return null;
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function pickFloat(s?: string | null): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function clampInt(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function guessSupplierName(slug: string) {
  const dict: Record<string, string> = {
    gexa: 'Gexa Energy',
    frontier: 'Frontier Utilities',
    champion: 'Champion Energy Services',
    chariot: 'Chariot Energy',
    payless: 'Payless Power',
  };
  return dict[slug] || title(slug);
}

// Format hh:mm (24h) from "h[:mm] am/pm" captures
function hhmm(hs?: string, ms?: string, ap?: string) {
  if (!hs) return null;
  let h = clampInt(Number(hs), 0, 12);
  let m = ms ? clampInt(Number(ms), 0, 59) : 0;
  const ampm = (ap || '').toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${hh}:${mm}`;
}
