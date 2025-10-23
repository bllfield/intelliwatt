// lib/rates/calc.ts
// Step 49: Core bill calculator for Retail Rate → monthly cost from usage
// ----------------------------------------------------------------------
// What this module does
//  - Takes a normalized RateConfig (from Steps 46–48) and a usage input
//    (hourly timeseries or a single monthly kWh) and returns an estimated bill.
//  - Supports components:
//      • fixed_monthly (flat $ per month)
//      • per_day (flat $ per service day)
//      • flat_per_kwh (¢/kWh), with optional:
//          - tier { start_kwh, end_kwh } applied on monthly total
//          - tou { start_hour, end_hour } applied on hour-of-day windows
//      • tdsp_passthrough (ignored for cost by default; included in notes)
//  - Returns a breakdown suitable for UI and for ranking/by-cost comparisons.
//
// Usage
//  import { estimateMonthlyBill } from '@/lib/rates/calc';
//  const res = estimateMonthlyBill({ config, usage });
//  -> res.total.usd, res.breakdown, res.meta
//
// Notes
//  - All energy rates expected in cents/kWh (per the normalizer).
//  - Money is accumulated in USD with 1e-6 precision and rounded at the end.
//  - TOU windows are applied to hours; tiers are applied on *monthly total*.
//  - If both TOU + tier exist on a component, we:
//      1) determine KWh inside the TOU window
//      2) apply tier boundaries against the month total, and proportionally
//         allocate the TOU window share into tier slices.
//  - If only a monthly_kwh is provided, TOU components are treated as flat
//    (i.e., they apply to the given kWh, because we cannot partition hours).
//
// Types are duplicated locally to avoid import cycles. Keep in sync with Step 47.

export type RateComponent =
  | {
      kind: 'flat_per_kwh';
      rate_cents_per_kwh: number;
      tier?: { start_kwh?: number | null; end_kwh?: number | null } | null;
      tou?: { label?: string | null; start_hour?: number | null; end_hour?: number | null } | null;
      notes?: string | null;
    }
  | {
      kind: 'fixed_monthly';
      amount_usd: number;
      notes?: string | null;
    }
  | {
      kind: 'per_day';
      amount_usd_per_day: number;
      notes?: string | null;
    }
  | {
      kind: 'tdsp_passthrough';
      label?: string | null;
      details?: any;
    };

export type RateConfig = {
  schema: 'intelliwatt.rate.v1';
  key: string;
  source: {
    provider: 'wattbuy.retail-rate-db';
    received_at: string;
    id?: string | number | null;
    name?: string | null;
    utilityID?: number | null;
    verified_at?: string | null;
    raw: any;
  };
  meta: {
    display_name: string;
    sector?: string | null;
    effective?: string | null;
    expiration?: string | null;
    state?: string | null;
    tdsp?: string | null;
    eia_utility_id?: number | null;
    source_url?: string | null;
  };
  pricing: {
    base_monthly_usd?: number | null;
    components: RateComponent[];
  };
};

export type HourlySample = {
  ts: string | number | Date; // timestamp
  kwh: number; // consumption for that hour
};

export type UsageInput =
  | {
      // Preferred: full hourly series for a billing month
      monthlyKwh?: undefined;
      hours: HourlySample[];
      // (Optional) service days override; otherwise derived from hours
      serviceDays?: number;
    }
  | {
    // Fallback: only monthly kWh is known
    monthlyKwh: number;
    hours?: undefined;
    // Must provide number of bill days if you want per_day components
    serviceDays?: number;
  };

export type EstimateOptions = {
  // Round money to cents at the component level as well?
  roundIntermediate?: boolean; // default false (round only at the end)
  // If true, ignore TOU windows when only monthlyKwh is provided (treat as 0)
  // Default: false => TOU treated as flat if no hours are given
  requireTimeseriesForTOU?: boolean;
};

export type EstimateBreakdownRow = {
  label: string;
  kind: RateComponent['kind'] | 'base_monthly';
  kwh?: number;
  usd: number;
  extra?: Record<string, any>;
};

export type EstimateResult = {
  configKey: string;
  planName: string;
  totals: {
    kwh: number;
    days: number;
    usd: number;
  };
  breakdown: EstimateBreakdownRow[];
  notes: string[];
  meta: {
    tdsp?: string | null;
    source_url?: string | null;
    verified_at?: string | null;
    effective?: string | null;
    expiration?: string | null;
  };
};

const EPS = 1e-6;

export function estimateMonthlyBill(
  args: { config: RateConfig; usage: UsageInput; tz?: string } & EstimateOptions
): EstimateResult {
  const { config, tz, roundIntermediate = false, requireTimeseriesForTOU = false } = args;

  const comp = config.pricing?.components || [];
  const notes: string[] = [];

  // Derive kWh and service days
  let monthlyKwh = 0;
  let serviceDays = 30;

  let hourBuckets: number[] | null = null; // length 24, total kWh per hour-of-day
  let hoursCount = 0;

  if ('hours' in args.usage && Array.isArray(args.usage.hours)) {
    // Hourly path
    const hours = args.usage.hours;
    hoursCount = hours.length;
    monthlyKwh = sum(hours.map((h) => clampKwh(h.kwh)));
    const daysSet = new Set<string>();
    hourBuckets = new Array(24).fill(0);
    for (const h of hours) {
      const d = new Date(h.ts);
      if (!isFinite(d.valueOf())) continue;
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; // day bucket (UTC); ok for count
      daysSet.add(key);
      const hr = getHourOfDay(d, tz);
      hourBuckets[hr] += clampKwh(h.kwh);
    }
    serviceDays = args.usage.serviceDays ?? Math.max(1, daysSet.size);
  } else {
    // Monthly-only path
    monthlyKwh = Math.max(0, Number(args.usage.monthlyKwh || 0));
    serviceDays = args.usage.serviceDays ?? 30;
    hourBuckets = null;
  }

  const breakdown: EstimateBreakdownRow[] = [];
  let totalUsd = 0;

  // Base monthly from config
  if (isFiniteNum(config.pricing?.base_monthly_usd)) {
    totalUsd += config.pricing!.base_monthly_usd!;
    pushRow(breakdown, {
      label: 'Base monthly',
      kind: 'base_monthly',
      usd: config.pricing!.base_monthly_usd!,
    }, roundIntermediate);
  }

  for (const c of comp) {
    switch (c.kind) {
      case 'fixed_monthly': {
        const amt = money(c.amount_usd);
        totalUsd += amt;
        pushRow(breakdown, { label: c.notes || 'Fixed monthly', kind: 'fixed_monthly', usd: amt }, roundIntermediate);
        break;
      }
      case 'per_day': {
        const per = money(c.amount_usd_per_day);
        const amt = per * serviceDays;
        totalUsd += amt;
        pushRow(
          breakdown,
          {
            label: c.notes || 'Per-day fee',
            kind: 'per_day',
            usd: amt,
            extra: { per_day_usd: per, days: serviceDays },
          },
          roundIntermediate
        );
        break;
      }
      case 'flat_per_kwh': {
        const rateCents = Number(c.rate_cents_per_kwh || 0);
        if (!(rateCents > 0)) {
          notes.push(`Skipped zero rate component (${c.notes || 'energy'}).`);
          break;
        }

        // Determine applicable kWh for TOU component
        let applicableKwh = monthlyKwh;
        let touWindowShare = 1;

        if (c.tou && (hourBuckets || requireTimeseriesForTOU)) {
          const { start_hour, end_hour } = sanitizeTOU(c.tou);
          if (start_hour != null && end_hour != null) {
            if (hourBuckets) {
              const inWindow = sum(hoursInWindow(hourBuckets, start_hour, end_hour));
              applicableKwh = inWindow;
              touWindowShare = monthlyKwh > EPS ? clamp01(inWindow / monthlyKwh) : 0;
            } else {
              // No timeseries but TOU present
              if (requireTimeseriesForTOU) {
                applicableKwh = 0;
                notes.push(`TOU component ignored due to missing timeseries (${c.tou.label || 'TOU'}).`);
              } else {
                // Assume it applies to given monthly kWh uniformly
                applicableKwh = monthlyKwh;
              }
            }
          }
        }

        // Apply tier if present—on monthly total. Allocate proportionally for TOU subset.
        const tier = sanitizeTier(c.tier);
        let usd = 0;
        let kwhAccounted = 0;

        if (tier) {
          // Compute kWh in tier band referencing total month
          const tierKwh = kwhInTier(monthlyKwh, tier.start_kwh, tier.end_kwh);
          if (tierKwh > EPS) {
            // If we're in a TOU window subset, allocate proportionally
            const applyKwh = hourBuckets ? tierKwh * touWindowShare : applicableKwh;
            const cents = rateCents * (applyKwh / 1); // ¢ * kWh
            usd += centsToUsd(cents);
            kwhAccounted += applyKwh;
          }
        } else {
          // No tier; apply to applicableKwh directly
          const cents = rateCents * applicableKwh;
          usd += centsToUsd(cents);
          kwhAccounted += applicableKwh;
        }

        totalUsd += usd;
        pushRow(
          breakdown,
          {
            label: c.notes || `Energy ${rateCents.toFixed(4)} ¢/kWh`,
            kind: 'flat_per_kwh',
            kwh: round4(kwhAccounted),
            usd,
            extra: {
              rate_cents_per_kwh: rateCents,
              tier: tier ?? undefined,
              tou: c.tou ?? undefined,
            },
          },
          roundIntermediate
        );
        break;
      }
      case 'tdsp_passthrough': {
        // Keep for transparency; no $ unless we can read a numeric amount out of details
        const inferredUsd = inferUsdFromUnknown(c.details);
        if (inferredUsd > 0) {
          totalUsd += inferredUsd;
          pushRow(
            breakdown,
            {
              label: c.label || 'TDSP component',
              kind: 'tdsp_passthrough',
              usd: inferredUsd,
            },
            roundIntermediate
          );
        } else {
          notes.push(`TDSP passthrough noted: ${c.label || 'component'}.`);
        }
        break;
      }
      default: {
        notes.push(`Unknown component ignored.`);
        break;
      }
    }
  }

  // Final rounding
  totalUsd = round2(totalUsd);

  return {
    configKey: config.key,
    planName: config.meta?.display_name || config.key,
    totals: {
      kwh: round4(monthlyKwh),
      days: serviceDays,
      usd: totalUsd,
    },
    breakdown,
    notes,
    meta: {
      tdsp: config.meta?.tdsp ?? null,
      source_url: config.meta?.source_url ?? null,
      verified_at: config.source?.verified_at ?? null,
      effective: config.meta?.effective ?? null,
      expiration: config.meta?.expiration ?? null,
    },
  };
}

// --------------------- helpers ---------------------

function pushRow(arr: EstimateBreakdownRow[], row: EstimateBreakdownRow, roundIntermediate: boolean) {
  arr.push({
    ...row,
    usd: roundIntermediate ? round2(row.usd) : row.usd,
  });
}

function isFiniteNum(n: any): n is number {
  return typeof n === 'number' && isFinite(n);
}

function money(n: any): number {
  const v = Number(n);
  return isFinite(v) ? v : 0;
}

function centsToUsd(cents: number): number {
  return cents / 100;
}

function clampKwh(k: any): number {
  const n = Number(k);
  return isFinite(n) && n > 0 ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + EPS) * 100) / 100;
}
function round4(n: number): number {
  return Math.round((n + EPS) * 10000) / 10000;
}

function sum(a: number[]): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i];
  return t;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function getHourOfDay(d: Date, tz?: string): number {
  // Use Intl to respect tz if provided
  try {
    if (tz) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        hour: '2-digit',
      }).formatToParts(d);
      const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
      return Math.max(0, Math.min(23, parseInt(hourStr, 10) || 0));
    }
  } catch {
    // fallthrough to local getUTCHours
  }
  return d.getUTCHours(); // default to UTC hour
}

function hoursInWindow(hourBuckets: number[], start: number, end: number): number[] {
  // Window [start, end), wrap allowed (e.g. 22→6)
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const inRange = isHourInWindow(h, start, end);
    out.push(inRange ? hourBuckets[h] : 0);
  }
  return out;
}

function isHourInWindow(h: number, start: number, end: number): boolean {
  if (start === end) return true; // full day
  if (start < end) return h >= start && h < end;
  // wrap
  return h >= start || h < end;
}

function sanitizeTOU(tou?: { start_hour?: number | null; end_hour?: number | null } | null) {
  let sh = tou?.start_hour;
  let eh = tou?.end_hour;
  sh = isFiniteNum(sh) ? clampHour(sh!) : null;
  eh = isFiniteNum(eh) ? clampHour(eh!) : null;
  if (sh == null || eh == null) return { start_hour: null, end_hour: null };
  return { start_hour: sh, end_hour: eh };
}

function clampHour(h: number): number {
  let x = Math.floor(h);
  if (x < 0) x = 0;
  if (x > 23) x = 23;
  return x;
}

function sanitizeTier(tier?: { start_kwh?: number | null; end_kwh?: number | null } | null) {
  if (!tier) return null;
  const start = isFiniteNum(tier.start_kwh) ? Math.max(0, tier.start_kwh!) : 0;
  const end = isFiniteNum(tier.end_kwh) ? Math.max(0, tier.end_kwh!) : null;
  if (end != null && end <= start) return null;
  if (start === 0 && end == null) return null; // no-op
  return { start_kwh: start, end_kwh: end };
}

function kwhInTier(totalMonthlyKwh: number, start?: number | null, end?: number | null): number {
  const s = Math.max(0, start ?? 0);
  const e = end ?? Infinity;
  if (e <= s) return 0;
  const inBand = Math.max(0, Math.min(totalMonthlyKwh, e) - s);
  return inBand;
}

/**
 * Try to infer a numeric USD from an unknown structure.
 * This is best-effort and conservative to avoid accidental double counting.
 */
function inferUsdFromUnknown(details: any): number {
  if (!details || typeof details !== 'object') return 0;

  // Common shapes: { monthly_fee: 7.95 }, { amount_usd: 3.5 }, etc.
  const keys = ['monthly_fee', 'amount_usd', 'fixed_charge', 'customer_charge'];
  for (const k of keys) {
    const v = Number(details[k]);
    if (isFinite(v) && v > 0) return v;
  }
  return 0;
}

// ---------------- Convenience: batch estimate across many configs ----------------

export function estimateAcrossConfigs(
  configs: RateConfig[],
  usage: UsageInput,
  opts?: EstimateOptions & { limit?: number }
): EstimateResult[] {
  const out: EstimateResult[] = [];
  for (const cfg of configs) {
    try {
      out.push(estimateMonthlyBill({ config: cfg, usage, ...opts }));
    } catch (e) {
      // swallow individual config errors to keep list moving
      // you can log them on the caller side
    }
  }
  out.sort((a, b) => a.totals.usd - b.totals.usd);
  if (opts?.limit && opts.limit > 0) return out.slice(0, opts.limit);
  return out;
}