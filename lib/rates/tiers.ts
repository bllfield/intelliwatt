// lib/rates/tiers.ts
// Step 54: Standard tier estimates (500 / 1000 / 2000 kWh)
// --------------------------------------------------------
// Purpose
//  • Provide UI-friendly tier outputs alongside your detailed bill estimate
//  • Each tier includes:
//      - kWh level
//      - EFL-advertised ¢/kWh if available (from WattBuy offer_data.kwh500/1000/2000)
//      - IntelliWatt-estimated total $ for the tier using your rate engine
//      - Effective ¢/kWh derived from your estimate (total $ / kWh * 100)
//  • Designed to be optional: if you don't have EFL cents for a tier, we omit it
//
// Usage
//  import { buildStandardTiers } from '@/lib/rates/tiers';
//  const tiers = buildStandardTiers({ config, days: 30, eflCents: { 500: 16.2, 1000: 15.5, 2000: 15.1 } });
//
// Integration plan
//  • Step 55 will add these tiers to /api/recommendations (Step 51) output.
//  • Step 56 will render them in app/plans/page.tsx (Step 52).
//
// Notes
//  • We assume your calc (estimateMonthlyBill) accepts UsageInput of monthlyKwh + serviceDays
//  • Time-of-use configs will still compute using monthly approximation unless you
//    pass hourly series — which is fine for quick tier comparisons.

import { estimateMonthlyBill } from '@/lib/rates/calc';

export type EflCentsMap = Partial<Record<500 | 1000 | 2000, number>>;

export type TierRow = {
  kwh: 500 | 1000 | 2000;
  efl_cents_per_kwh?: number | null; // from EFL (if provided)
  calc_total_usd: number;            // IntelliWatt estimate for the tier
  calc_effective_cents_per_kwh: number; // (calc_total_usd / kWh) * 100
};

export type StandardTiers = {
  days: number;
  results: TierRow[];
};

type BuildArgs = {
  // Your normalized RateConfig from PlanMaster (Step 47 / Step 51 conversion)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  days?: number; // default 30
  eflCents?: EflCentsMap; // optional override from offer_data.{kwh500,kwh1000,kwh2000}
};

/**
 * Compute standard tier estimates (500, 1000, 2000 kWh).
 */
export function buildStandardTiers(args: BuildArgs): StandardTiers {
  const days = Number.isFinite(args.days) && (args.days as number) > 0 ? (args.days as number) : 30;
  const efl = args.eflCents || {};

  const levels: Array<500 | 1000 | 2000> = [500, 1000, 2000];

  const results: TierRow[] = levels.map((kwh) => {
    const est = estimateMonthlyBill({
      config: args.config,
      usage: { monthlyKwh: kwh, serviceDays: days },
      roundIntermediate: true,
      requireTimeseriesForTOU: false,
    });

    const total = safeMoney(est?.totals?.usd);
    const eff = total > 0 && kwh > 0 ? round2((total / kwh) * 100) : 0;

    const eflCents = efl[kwh];

    return {
      kwh,
      efl_cents_per_kwh: isFiniteNumber(eflCents) ? round2(eflCents!) : null,
      calc_total_usd: round2(total),
      calc_effective_cents_per_kwh: eff,
    };
  });

  return { days, results };
}

// --------------- helpers ----------------

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeMoney(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
