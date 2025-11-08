// lib/calc/bill.ts
// Step 34: Bill calculator (kWh → cents) with support for tiers + bill credits + base fees + delivery
// - computeBill({ rate, usageKwh, hourlyKwh })
// - If structured tiers are missing, we fall back to avgPrice{500,1000,2000} to estimate.
//
// Assumptions/Simplifications:
// - centsPerKwhJson tiers are applied sequential up to "upToKwh" (null = infinity)
// - billCreditsJson credits apply if usage ≥ threshold (take the largest credit that qualifies)
// - tduDeliveryCentsPerKwh and baseMonthlyFeeCents are added if provided
// - If hourlyKwh is provided and touWindowsJson exists, we apply rateAdderCents to hours inside windows
//   (otherwise ignore TOU to keep things fast)

import type { RateLike, Tier, BillCredit } from '@/lib/rates/store';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export function computeBill(input: {
  rate: RateLike;
  usageKwh: number;
  hourlyKwh?: number[]; // optional
}) {
  const { rate, usageKwh } = input;
  const safeUsage = Math.max(0, Number(usageKwh) || 0);

  // Try structured first
  let energyCents = 0;

  if (Array.isArray(rate.centsPerKwhJson) && rate.centsPerKwhJson.length) {
    energyCents = applyPiecewise(rate.centsPerKwhJson, safeUsage);

    // Optional TOU adder using hourly series (only applies if both series and windows are present)
    if (Array.isArray(input.hourlyKwh) && Array.isArray(rate.touWindowsJson) && rate.touWindowsJson.length) {
      const touAdder = applyTouAdders(rate.touWindowsJson, input.hourlyKwh);
      energyCents += touAdder;
    }
  } else {
    // Fallback to averages: pick nearest of 500/1000/2000
    const near = nearestAvgRate(rate, safeUsage);
    energyCents = safeUsage * near;
  }

  // Delivery + base
  const tdu = toNum(rate.tduDeliveryCentsPerKwh) ?? 0;
  const base = toNum(rate.baseMonthlyFeeCents) ?? 0;
  let deliveryCents = tdu * safeUsage;
  let baseFeeCents = base;

  // Bill credits (use the single largest credit that qualifies)
  let creditsCents = 0;
  if (Array.isArray(rate.billCreditsJson) && rate.billCreditsJson.length) {
    creditsCents = bestCredit(rate.billCreditsJson, safeUsage);
  }

  // Total (guard against negative)
  let totalCents = energyCents + deliveryCents + baseFeeCents - creditsCents;
  if (totalCents < 0) totalCents = 0;

  const effCentsPerKwh = safeUsage > 0 ? totalCents / safeUsage : 0;

  return {
    totalCents,
    effCentsPerKwh,

    components: {
      energyCents,
      deliveryCents,
      baseFeeCents,
      creditsCents,
    },

    meta: {
      usedStructured: Array.isArray(rate.centsPerKwhJson) && rate.centsPerKwhJson.length > 0,
      usedTou: Array.isArray(input.hourlyKwh) && Array.isArray(rate.touWindowsJson) && rate.touWindowsJson.length > 0,
    },
  };
}

// -------- helpers --------

function applyPiecewise(tiers: Tier[], usageKwh: number): number {
  // Normalize tiers: ensure one with upToKwh=null at the end
  const norm = normalizeTiers(tiers);
  let remain = usageKwh;
  let cents = 0;

  for (const t of norm) {
    if (remain <= 0) break;
    const block = t.upToKwh == null ? remain : Math.min(remain, Math.max(0, t.upToKwh));
    cents += block * (toNum(t.rateCents) ?? 0);
    remain -= block;
  }
  return cents;
}

function normalizeTiers(tiers: Tier[]): Tier[] {
  const out: Tier[] = [];
  for (const t of tiers) {
    const rate = toNum(t.rateCents) ?? 0;
    const upTo = t.upToKwh == null ? null : Math.max(0, Math.floor(Number(t.upToKwh)));
    out.push({ rateCents: rate, upToKwh: upTo });
  }
  // Ensure last infinite tier
  if (!out.some((t) => t.upToKwh == null)) {
    out.push({ upToKwh: null, rateCents: out.length ? out[out.length - 1].rateCents : 0 });
  }
  return out;
}

function nearestAvgRate(rate: RateLike, usageKwh: number): number {
  const candidates: Array<{ k: number; v: number | null | undefined }> = [
    { k: 500, v: rate.avgPrice500 },
    { k: 1000, v: rate.avgPrice1000 },
    { k: 2000, v: rate.avgPrice2000 },
  ].filter((x) => isFiniteNum(x.v));

  if (!candidates.length) {
    // No averages; last fallback = 15¢/kWh generic
    return 15;
  }

  let best = candidates[0];
  let bestDist = Math.abs(usageKwh - best.k);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(usageKwh - c.k);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return Number(best.v);
}

function bestCredit(credits: BillCredit[], usageKwh: number): number {
  let best = 0;
  for (const c of credits) {
    const th = toNum(c.thresholdKwh) ?? Infinity;
    const v = toNum(c.creditCents) ?? 0;
    if (usageKwh >= th && v > best) best = v;
  }
  return best;
}

function applyTouAdders(
  windows: NonNullable<RateLike['touWindowsJson']>,
  hourly: number[]
): number {
  // Basic implementation: treat each hour equally and add `rateAdderCents * kWhInThatHour`
  // hours array can be any length; we just apply cyclic day-of-week every 24 hours starting on Sunday.
  let sum = 0;
  for (let i = 0; i < hourly.length; i++) {
    const kwh = Math.max(0, Number(hourly[i]) || 0);
    const hod = i % 24; // hour-of-day
    const dow = Math.floor(i / 24) % 7; // 0..6, Sunday start
    let adder = 0;
    for (const w of windows) {
      if (Array.isArray(w.days) && !w.days.includes(dow)) continue;
      if (inWindow(hod, w.startHour, w.endHour)) {
        adder += toNum(w.rateAdderCents) ?? 0;
      }
    }
    sum += kwh * adder;
  }
  return sum;
}

function inWindow(h: number, start: number, end: number): boolean {
  const s = ((start % 24) + 24) % 24;
  const e = ((end % 24) + 24) % 24;
  if (s === e) return true; // full-day
  if (s < e) return h >= s && h < e; // same-day window
  return h >= s || h < e; // crosses midnight
}

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isFiniteNum(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}